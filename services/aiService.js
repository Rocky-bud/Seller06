/**
 * aiService.js — Hybrid Button-Driven Telegram bot state machine
 *
 * Flow overview:
 *   IDLE  →  menu buttons (products / cart / tracking)
 *         →  inline button "➕ افزودن به سبد"  (processCallback)
 *         →  inline button "💳 تسویه حساب"     (processCallback → GETTING_NAME)
 *   GETTING_NAME    → text input → GETTING_ADDRESS
 *   GETTING_ADDRESS → text input → GETTING_PHONE
 *   GETTING_PHONE   → contact/text → AWAITING_RECEIPT
 *   AWAITING_RECEIPT→ photo → IDLE (order confirmed)
 *
 *   Any state + "❌ لغو سفارش" → cancel order → IDLE
 *   Any state (IDLE) + unrecognised text → FAQ AI (max 15 words)
 */

import OpenAI from 'openai';
import { MAIN_MENU, PHONE_KEYBOARD, CANCEL_KEYBOARD } from './botManager.js';
import { persistReceiptImage } from './storageService.js';
import { recordOptOut, clearOptOut } from './marketingConsent.js';
import { validateCoupon as validateCouponCode, incrementCouponUsage, findCoupon as findCouponByCode } from './couponService.js';
import { getBalance as getLoyaltyBalance, getLoyaltyConfig, redeemPoints } from './loyaltyService.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const DEFAULT_SHOP_ID = process.env.DEFAULT_SHOP_ID || 'SHOP-LKGU6U';

// ─── OpenAI / OpenRouter client ───────────────────────────────────────────────
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
});

// ─── State constants ──────────────────────────────────────────────────────────
export const STATES = {
  IDLE: 'IDLE',
  GETTING_NAME: 'GETTING_NAME',
  GETTING_ADDRESS: 'GETTING_ADDRESS',
  GETTING_PHONE: 'GETTING_PHONE',
  AWAITING_RECEIPT: 'AWAITING_RECEIPT',
};

// Markup to attach based on newState
const STATE_MARKUP = {
  [STATES.IDLE]: MAIN_MENU,
  [STATES.GETTING_NAME]: CANCEL_KEYBOARD,
  [STATES.GETTING_ADDRESS]: CANCEL_KEYBOARD,
  [STATES.GETTING_PHONE]: PHONE_KEYBOARD,
  [STATES.AWAITING_RECEIPT]: MAIN_MENU,
};

// ─── FAQ system prompt ────────────────────────────────────────────────────────
const FAQ_SYSTEM = `شما دستیار FAQ حرفه‌ای یک فروشگاه آنلاین هستید.
فقط درباره محصولات، قیمت، حمل‌ونقل و فرایند خرید پاسخ دهید.
پاسخ‌ها را در حداکثر ۱۵ کلمه فارسی بنویسید.
برای سؤالات غیرمرتبط فقط بنویسید: «لطفاً از دکمه‌های منو استفاده کنید»
هرگز از شخصیت خارج نشوید.`;

// ─── In-Memory Cart ───────────────────────────────────────────────────────────
// key: `${userId}:${shopId}` → { items: [{product, quantity}], expiresAt }
const cartStore = new Map();
const CART_TTL = 2 * 60 * 60 * 1000; // 2 h

function cartKey(userId, shopId) { return `${userId}:${shopId}`; }

function getCartInternal(userId, shopId) {
  const k = cartKey(userId, shopId);
  const c = cartStore.get(k);
  if (!c) return null;
  if (Date.now() > c.expiresAt) { cartStore.delete(k); return null; }
  return c;
}

function addToCartInternal(userId, shopId, product, qty = 1) {
  const k = cartKey(userId, shopId);
  const existing = cartStore.get(k);
  if (existing && existing.items[0]?.product.id === product.id) {
    const newQty = Math.min(existing.items[0].quantity + qty, product.stock);
    existing.items[0].quantity = newQty;
    existing.expiresAt = Date.now() + CART_TTL;
  } else {
    cartStore.set(k, {
      items: [{ product, quantity: Math.min(qty, product.stock) }],
      expiresAt: Date.now() + CART_TTL,
    });
  }
}

function clearCartInternal(userId, shopId) { cartStore.delete(cartKey(userId, shopId)); }

// ─── Supabase helper ──────────────────────────────────────────────────────────
async function supabaseFetch(table, method = 'GET', body = null, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(method === 'POST' ? { Prefer: 'return=representation' } : {}),
    ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
  };
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${table}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatPrice(n) {
  return Number(n || 0).toLocaleString('fa-IR');
}

// STAGE 36: validate + pretty-print a bank card number. Iranian debit cards are
// exactly 16 digits. Returns { valid, display } so the bot never shows a broken
// or fake card (e.g. "—" or "1234") to a paying customer.
function formatCardForDisplay(card) {
  const digits = String(card || '').replace(/\D/g, '');
  if (digits.length !== 16) return { valid: false, display: '' };
  const groups = digits.match(/.{1,4}/g) || [];
  return { valid: true, display: groups.join('-') };
}

function validatePhone(p) { return /^09\d{9}$/.test(p); }
function cleanPhone(p) {
  let s = (p || '').replace(/\D/g, '');
  if (s.startsWith('98')) s = '0' + s.slice(2);
  if (s.startsWith('9') && s.length === 10) s = '0' + s;
  return s;
}

async function getShopInfo(shopId) {
  try {
    const rows = await supabaseFetch('shops', 'GET', null,
      `?select=id,name,card_number,system_prompt&id=eq.${encodeURIComponent(shopId)}&limit=1`);
    return rows?.[0] || null;
  } catch { return null; }
}

/**
 * STAGE 37: strip Telegram *legacy* Markdown control chars from user-supplied
 * text. Legacy Markdown (parse_mode: 'Markdown') has NO escape syntax, so a
 * customer name/address containing * _ backtick or [ would break entity
 * parsing and force the bot's degraded no-format retry. Removing them keeps
 * invoices clean and reliable.
 */
function escMd(s) {
  return String(s == null ? '' : s).replace(/[*_`\[]/g, '');
}

// ─── Phase 6 · Step 2: coupon-aware invoice rendering ─────────────────────────
// Shared finalize/cancel inline keyboard for the checkout invoice.
function invoiceMarkup(pendingOrderId) {
  return {
    inline_keyboard: [
      [{ text: '✅ تایید نهایی و پرداخت', callback_data: `finalize_order:${pendingOrderId}` }],
      [{ text: '❌ لغو و ویرایش', callback_data: 'cancel_checkout' }],
    ],
  };
}

// Render the checkout invoice, showing the coupon discount + payable total when
// a discount has been applied. `lines` is [{ name, quantity, total }].
function renderCheckoutInvoice({ customerName, phone, address, lines, subtotal, couponCode = null, couponDiscount = 0, pointsRedeemed = 0, pointsValue = 0 }) {
  const itemLines = (lines || []).map((l, i) =>
    `${i + 1}. 📦 ${escMd(l.name || 'محصول')}  ×${l.quantity}  ➜  ${formatPrice(l.total)} تومان`
  ).join('\n');
  const sub = Number(subtotal) || 0;
  const cDisc = Math.max(0, Number(couponDiscount) || 0);
  const pVal = Math.max(0, Number(pointsValue) || 0);
  const pPts = Math.max(0, Number(pointsRedeemed) || 0);
  const finalTotal = Math.max(0, sub - cDisc - pVal);
  let totals;
  if (cDisc > 0 || pVal > 0) {
    const couponTag = couponCode ? ` (${escMd(couponCode)})` : '';
    totals = `🧾 جمع کل: ${formatPrice(sub)} تومان`;
    if (cDisc > 0) totals += `\n🎟 تخفیف کوپن${couponTag}: ${formatPrice(cDisc)} تومان`;
    if (pVal > 0) totals += `\n🎁 امتیاز وفاداری (${formatPrice(pPts)} امتیاز): ${formatPrice(pVal)} تومان`;
    totals += `\n💵 *مبلغ قابل پرداخت: ${formatPrice(finalTotal)} تومان*`;
  } else {
    totals = `💵 *جمع کل قابل پرداخت: ${formatPrice(sub)} تومان*`;
  }
  return (
    `📜 *فاکتور نهایی سفارش شما:*\n` +
    `──────────────────\n` +
    `👤 تحویل‌گیرنده: ${escMd(customerName)}\n` +
    `📞 شماره تماس: ${escMd(phone)}\n` +
    `📍 آدرس پستی: ${escMd(address)}\n` +
    `──────────────────\n` +
    `🛒 اقلام سفارش:\n${itemLines}\n` +
    `──────────────────\n` +
    totals
  );
}

// Attempt to apply a coupon code typed during AWAITING_RECEIPT. Returns a
// response object (re-issued invoice or an error notice) or null when the text
// is not a plausible coupon attempt (so the caller falls back to the receipt
// prompt). Works for both Telegram and Instagram (text routes here).
async function buildCheckoutInvoiceFromOrders(userId, shopId) {
  const where = `&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info&order=created_at.asc`;
  const baseSel = 'id,quantity,total_price,coupon_code,discount_amount,customer_name,phone,shipping_address,products(name)';
  let rows;
  try {
    rows = await supabaseFetch('orders', 'GET', null, `?select=${baseSel},points_redeemed,points_value${where}`);
  } catch (e) {
    rows = await supabaseFetch('orders', 'GET', null, `?select=${baseSel}${where}`);
  }
  if (!rows?.length) return null;
  const subtotal = rows.reduce((s, o) => s + Number(o.total_price || 0), 0);
  const couponDiscount = rows.reduce((s, o) => s + Number(o.discount_amount || 0), 0);
  const pointsValue = rows.reduce((s, o) => s + Number(o.points_value || 0), 0);
  const pointsRedeemed = rows.reduce((s, o) => s + Number(o.points_redeemed || 0), 0);
  const couponCode = rows.find((o) => o.coupon_code)?.coupon_code || null;
  const lines = rows.map((o) => ({ name: o.products?.name, quantity: o.quantity, total: Number(o.total_price || 0) }));
  const text = renderCheckoutInvoice({
    customerName: rows[0].customer_name || '—',
    phone: rows[0].phone || '—',
    address: rows[0].shipping_address || '—',
    lines, subtotal, couponCode, couponDiscount, pointsRedeemed, pointsValue,
  });
  return { text, subtotal, couponDiscount, pointsValue, pointsRedeemed };
}

async function buildLoyaltyHint(shopId, userId) {
  try {
    const config = await getLoyaltyConfig(shopId);
    if (!config.loyalty_enabled) return '';
    const balance = await getLoyaltyBalance(shopId, userId);
    if (!balance || balance <= 0) return '';
    return `\n──────────────────\n🎁 موجودی امتیاز شما: ${formatPrice(balance)} امتیاز (هر امتیاز ${formatPrice(config.loyalty_redeem_value)} تومان).\nبرای استفاده، کلمهٔ «امتیاز» را ارسال کنید.`;
  } catch {
    return '';
  }
}

async function reserveLoyaltyRedemption(userId, shopId, pendingOrderId) {
  const config = await getLoyaltyConfig(shopId);
  if (!config.loyalty_enabled) {
    return { response: 'ℹ️ برنامهٔ امتیاز وفاداری در این فروشگاه فعال نیست.', newState: STATES.AWAITING_RECEIPT };
  }
  const balance = await getLoyaltyBalance(shopId, userId);
  if (!balance || balance <= 0) {
    return {
      response: '🎁 شما هنوز امتیازی برای استفاده ندارید.\n\n📸 برای ادامه، تصویر رسید پرداخت را ارسال کنید.',
      newState: STATES.AWAITING_RECEIPT,
    };
  }
  const inv = await buildCheckoutInvoiceFromOrders(userId, shopId);
  if (!inv) return null;
  const remaining = Math.max(0, inv.subtotal - inv.couponDiscount);
  const redeemValue = Math.max(1, Number(config.loyalty_redeem_value) || 1);
  const maxPoints = Math.floor(remaining / redeemValue);
  const pointsToUse = Math.min(balance, maxPoints);
  if (pointsToUse <= 0) {
    return {
      response: '🎁 مبلغ این سفارش برای استفاده از امتیاز کافی نیست.\n\n📸 برای ادامه، تصویر رسید پرداخت را ارسال کنید.',
      newState: STATES.AWAITING_RECEIPT,
    };
  }
  const pointsValue = pointsToUse * redeemValue;
  try {
    await supabaseFetch('orders', 'PATCH',
      { points_redeemed: pointsToUse, points_value: pointsValue },
      `?id=eq.${encodeURIComponent(pendingOrderId)}`);
  } catch (e) {
    console.warn('[reserveLoyaltyRedemption] persist failed:', e.message);
    return {
      response: '⚠️ ثبت امتیاز با خطا مواجه شد. لطفاً دوباره تلاش کنید یا تصویر رسید را بفرستید.',
      newState: STATES.AWAITING_RECEIPT,
    };
  }
  const updated = await buildCheckoutInvoiceFromOrders(userId, shopId);
  return {
    response: `🎁 *${formatPrice(pointsToUse)} امتیاز اعمال شد!*\n\n${updated ? updated.text : ''}`,
    newState: STATES.AWAITING_RECEIPT,
    markup: invoiceMarkup(pendingOrderId),
  };
}

async function applyCouponAtCheckout(userId, shopId, pendingOrderId, rawText) {
  const code = String(rawText || '').trim();
  // Only treat compact single-token text as a coupon attempt.
  if (!code || /\s/.test(code) || code.length < 2 || code.length > 40) return null;

  let rows;
  try {
    rows = await supabaseFetch('orders', 'GET', null,
      `?select=id,quantity,total_price,customer_name,phone,shipping_address,products(name)&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info&order=created_at.asc`);
  } catch (e) {
    console.warn('[applyCouponAtCheckout] order read failed (non-fatal):', e.message);
    return null;
  }
  if (!rows?.length) return null;

  const subtotal = rows.reduce((s, o) => s + Number(o.total_price || 0), 0);
  const lines = rows.map((o) => ({ name: o.products?.name, quantity: o.quantity, total: Number(o.total_price || 0) }));
  const customerName = rows[0].customer_name || '—';
  const phone = rows[0].phone || '—';
  const address = rows[0].shipping_address || '—';

  let result;
  try {
    result = await validateCouponCode(shopId, code, subtotal);
  } catch (e) {
    console.warn('[applyCouponAtCheckout] validate failed (non-fatal):', e.message);
    return null; // unknown/transient → fall back to receipt prompt
  }

  if (!result || !result.valid) {
    const reason = result?.reason || 'کد تخفیف معتبر نیست';
    return {
      response: `⚠️ ${reason}\n\n📸 برای ادامه، تصویر رسید پرداخت را بفرستید یا کد دیگری ارسال کنید.`,
      newState: STATES.AWAITING_RECEIPT,
    };
  }

  try {
    await supabaseFetch('orders', 'PATCH',
      { coupon_code: code, discount_amount: result.discount },
      `?id=eq.${encodeURIComponent(pendingOrderId)}`);
  } catch (e) {
    console.warn('[applyCouponAtCheckout] persist failed:', e.message);
    return {
      response: '⚠️ ثبت کد تخفیف با خطا مواجه شد. لطفاً دوباره تلاش کنید یا تصویر رسید را بفرستید.',
      newState: STATES.AWAITING_RECEIPT,
    };
  }

  const inv = await buildCheckoutInvoiceFromOrders(userId, shopId);
  return {
    response: `✅ *کد تخفیف اعمال شد!*\n\n${inv ? inv.text : ''}`,
    newState: STATES.AWAITING_RECEIPT,
    markup: invoiceMarkup(pendingOrderId),
  };
}

async function getLatestState(userId, shopId) {
  try {
    const rows = await supabaseFetch('chats', 'GET', null,
      `?select=state,pending_order_id,reservation_expires_at&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.desc&limit=1`);
    const row = rows?.[0];
    return {
      state: row?.state || STATES.IDLE,
      pendingOrderId: row?.pending_order_id || null,
      reservationExpiresAt: row?.reservation_expires_at || null,
    };
  } catch { return { state: STATES.IDLE, pendingOrderId: null, reservationExpiresAt: null }; }
}

async function saveChat(userId, platform, message, response, intent, shopId, state, expiresAt = null, pendingOrderId = null) {
  try {
    await supabaseFetch('chats', 'POST', {
      user_id: userId,
      platform,
      message: message?.slice(0, 2000) || '',
      response: response?.slice(0, 2000) || '',
      intent: intent || 'general',
      shop_id: shopId,
      state,
      ...(expiresAt ? { reservation_expires_at: expiresAt } : {}),
      ...(pendingOrderId ? { pending_order_id: pendingOrderId } : {}),
    });
  } catch (err) {
    console.error('[saveChat] Error:', err.message);
  }
}

async function cancelOrder(orderId) {
  if (!orderId) return;
  try {
    await supabaseFetch('orders', 'PATCH', { status: 'cancelled' }, `?id=eq.${orderId}`);
  } catch (err) {
    console.error('[cancelOrder] Error:', err.message);
  }
}

// ─── Vision (receipt OCR) ─────────────────────────────────────────────────────
async function analyzeReceiptVision(imageUrl) {
  try {
    const res = await openai.chat.completions.create({
      model: 'google/gemini-flash-1.5',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the tracking/transaction ID from this payment receipt image. Reply ONLY with the number, nothing else. If not found reply: NONE',
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    });
    const code = res.choices?.[0]?.message?.content?.trim();
    return (!code || code === 'NONE') ? null : code;
  } catch (err) {
    console.error('[analyzeReceiptVision] Error:', err.message);
    return null;
  }
}

// ─── AI Helpers ───────────────────────────────────────────────────────────────

/** Strict FAQ reply — max 15 words, shop-related only */
async function faqReply(userMsg, shopId) {
  try {
    let productContext = '';
    try {
      const prods = await supabaseFetch('products', 'GET', null,
        `?select=name,price,stock&shop_id=eq.${encodeURIComponent(shopId)}&limit=20`);
      if (prods?.length) {
        productContext = '\n\nمحصولات موجود:\n' +
          prods.map(p => `• ${p.name}: ${formatPrice(p.price)} تومان (موجودی: ${p.stock})`).join('\n');
      }
    } catch {}

    const res = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      max_tokens: 60,
      messages: [
        { role: 'system', content: FAQ_SYSTEM + productContext },
        { role: 'user', content: userMsg },
      ],
    });
    const reply = res.choices?.[0]?.message?.content?.trim();
    return reply || 'لطفاً از دکمه‌های منو استفاده کنید';
  } catch (err) {
    console.error('[faqReply] Error:', err.message);
    return 'لطفاً از دکمه‌های منو استفاده کنید 🙏';
  }
}

/**
 * Classify user input during an active checkout state.
 * Returns: PROVIDE | CANCEL | QUESTION
 */
async function classifyCheckoutInput(userMsg) {
  // STAGE 37: deterministic guards FIRST so cancel/question detection never
  // depends on the LLM being reachable. A classifier outage previously
  // defaulted everything to PROVIDE, which could ignore a cancel request or
  // silently store a question as the customer's name/address.
  const msg = (userMsg || '').trim();
  const lower = msg.toLowerCase();
  if (['\u0644\u063A\u0648', '\u0627\u0646\u0635\u0631\u0627\u0641', '\u06A9\u0646\u0633\u0644', 'cancel'].some((w) => lower.includes(w))) return 'CANCEL';
  if (/[?\u061F]$/.test(msg)) return 'QUESTION';
  try {
    const res = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      max_tokens: 10,
      messages: [
        {
          role: 'system',
          content: `Classify the user message intent. Return ONLY one word:
PROVIDE   — user is providing the requested info (name, address, phone number)
CANCEL    — user wants to cancel the order
QUESTION  — user is asking a question
Default to PROVIDE if unsure.`,
        },
        { role: 'user', content: userMsg },
      ],
    });
    const raw = res.choices?.[0]?.message?.content?.trim().toUpperCase();
    if (['PROVIDE', 'CANCEL', 'QUESTION'].includes(raw)) return raw;
    return 'PROVIDE';
  } catch {
    return 'PROVIDE';
  }
}

// ─── Product Catalog Builder ──────────────────────────────────────────────────
// Sends a photo card if image_url is set; otherwise a rich text card.
async function buildProductCatalog(shopId) {
  const products = await supabaseFetch('products', 'GET', null,
    `?select=*&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.asc`);

  if (!products?.length) {
    return {
      messages: [{
        text: '🏪 در حال حاضر محصولی در فروشگاه ثبت نشده است.\nاما می‌توانید از دکمه زیر برای تست منوی جس��جوی شناور استفاده کنید:',
        markup: {
          inline_keyboard: [[
            { text: '🔍 جستجوی سریع محصولات', switch_inline_query_current_chat: '' },
          ]],
        },
        parseMode: '',
      }],
    };
  }

  const messages = [
    // First message: refresh the persistent bottom keyboard
    {
      text: '🛍️ <b>محصولات فروشگاه</b>\n━━━━━━━━━━━━━━━━━━',
      markup: MAIN_MENU,
      parseMode: 'HTML',
    },
    // Second message: inline search button (switch_inline_query_current_chat)
    {
      text: '🔍 برای جستجوی سریع محصول، دکمه زیر را بزنید:',
      markup: {
        inline_keyboard: [[
          { text: '🔍 جستجوی سریع محصولات', switch_inline_query_current_chat: '' },
        ]],
      },
      parseMode: '',
    },
  ];

  for (const p of products) {
    const inStock = Number(p.stock) > 0;
    const stockLine = inStock ? `✅ موجود · ${p.stock} عدد` : '⛔ ناموجود';
    const descLine = p.description?.trim() ? `\n📝 ${escHtml(p.description.trim())}` : '';

    const card =
      `📦 <b>${escHtml(p.name)}</b>\n` +
      `💰 قیمت: <b>${formatPrice(p.price)}</b> تومان\n` +
      `📊 ${stockLine}${descLine}\n` +
      `━━━━━━━━━━━━━━━━━━`;

    const btn = inStock
      ? { text: '➕ افزودن به سبد خرید', callback_data: `add_cart:${p.id}` }
      : { text: '⛔ ناموجود', callback_data: 'out_of_stock' };

    if (p.image_url?.trim()) {
      messages.push({
        photo: p.image_url.trim(),
        caption: card,
        markup: { inline_keyboard: [[btn]] },
        parseMode: 'HTML',
      });
    } else {
      messages.push({
        text: card,
        markup: { inline_keyboard: [[btn]] },
        parseMode: 'HTML',
      });
    }
  }

  return { messages };
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Cart View Builder ────────────────────────────────────────────────────────
function buildCartMessage(userId, shopId) {
  const cart = getCartInternal(userId, shopId);

  if (!cart?.items?.length) {
    return {
      text: '🛒 سبد خرید شما در حال حاضر خالی است!',
      markup: MAIN_MENU,
    };
  }

  const lines = cart.items.map((item, i) => {
    const subtotal = Number(item.product.price) * item.quantity;
    return `${i + 1}. 📦 *${item.product.name}*  ×${item.quantity}  ➜  ${formatPrice(subtotal)} تومان`;
  });

  const total = cart.items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);

  const text =
    `🛒 *سبد خرید شما*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    lines.join('\n') +
    `\n━━━━━━━━━━━━━━━━━━\n` +
    `💵 *جمع کل:  ${formatPrice(total)} تومان*`;

  const itemRows = cart.items.map(item => [
    { text: '➖', callback_data: `decrease_qty:${item.product.id}` },
    { text: `${item.quantity} عدد`, callback_data: 'noop' },
    { text: '➕', callback_data: `increase_qty:${item.product.id}` },
  ]);

  return {
    text,
    markup: {
      inline_keyboard: [
        ...itemRows,
        [
          { text: '❌ خالی کردن کامل سبد', callback_data: 'clear_cart' },
          { text: '💳 تایید و ثبت سفارش', callback_data: 'checkout_cart' },
        ],
        [
          { text: '🛍️ بازگشت به فروشگاه (مشاهده محصولات)', switch_inline_query_current_chat: '' },
        ],
      ],
    },
  };
}

// ─── Order Tracking Builder ───────────────────────────────────────────────────
async function buildTrackingMessage(userId, shopId) {
  try {
    const orders = await supabaseFetch('orders', 'GET', null,
      `?select=id,quantity,status,tracking_code,created_at,products(name)&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.desc&limit=5`);

    if (!orders?.length) {
      return '📭 هیچ سفارش ثبت‌شده‌ای برای شما یافت ��شد.\n\nبرای خرید، محصولات را از منو مشاهده کنید 🛍️';
    }

    const statusMap = {
      pending_info: '⏳ در انتظار تکمیل اطلاعات',
      pending_receipt: '💳 در انتظار رسید پرداخت',
      awaiting_approval: '🔍 در حال بررسی توسط مدیریت',
      approved: '✅ تأیید و در حال ارسال',
      rejected: '❌ رد شد',
      cancelled: '🚫 لغو شد',
    };

    const lines = orders.map((o, i) => {
      const name = o.products?.name || 'محصول';
      const status = statusMap[o.status] || o.status;
      const tracking = o.tracking_code ? `\n     🔖 کد پیگیری: \`${o.tracking_code}\`` : '';
      return `${i + 1}\\. 📦 *${name}* × ${o.quantity}\n     ${status}${tracking}`;
    });

    return `🔍 *آخرین سفارشات شما*\n──────────────────\n${lines.join('\n\n')}`;
  } catch (err) {
    console.error('[buildTrackingMessage] Error:', err.message);
    return '⚠️ خطا در بازیابی سفارشات. لطفاً مجدداً تلاش کنید.';
  }
}

// ─── Checkout State Handlers ──────────────────────────────────────────────────

async function handleGETTING_NAME(userId, platform, message, shopId, pendingOrderId, reservationExpiresAt) {
  const action = await classifyCheckoutInput(message);

  if (action === 'CANCEL') {
    await cancelOrder(pendingOrderId);
    clearCartInternal(userId, shopId);
    return { response: '🚫 سفارش لغو شد.\n\nهر زمان که خواستید می‌توانید دوباره خرید نمایید 🙏', newState: STATES.IDLE, pendingOrderId: null };
  }

  if (action === 'QUESTION') {
    const ans = await faqReply(message, shopId);
    return {
      response: `${ans}\n\n👤 لطفاً نام و نام خانوادگی خود را وارد نمایید:`,
      newState: STATES.GETTING_NAME, pendingOrderId, reservationExpiresAt,
    };
  }

  const name = message.trim();
  if (name.length < 3) {
    return {
      response: '⚠️ نام وارد شده خیلی کوتاه است. لطفاً نام کامل خود را وارد نمایید:',
      newState: STATES.GETTING_NAME, pendingOrderId, reservationExpiresAt,
    };
  }

  await supabaseFetch('orders', 'PATCH', { customer_name: name },
    `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);
  return {
    response: `✅ نام ثبت شد: *${name}*\n\n📱 لطفاً شماره موبایل خود را از طریق دکمه زیر ارسال کنید یا مستقیماً تایپ نمایید:`,
    newState: STATES.GETTING_PHONE, pendingOrderId, reservationExpiresAt,
  };
}

async function handleGETTING_ADDRESS(userId, platform, message, shopId, pendingOrderId, reservationExpiresAt) {
  const action = await classifyCheckoutInput(message);

  if (action === 'CANCEL') {
    await supabaseFetch('orders', 'PATCH', { status: 'cancelled' },
      `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);
    clearCartInternal(userId, shopId);
    return { response: '🚫 سفارش لغو شد.\n\nهر زمان که خواستید می‌توانید دوباره خرید نمایید 🙏', newState: STATES.IDLE, pendingOrderId: null };
  }

  if (action === 'QUESTION') {
    const ans = await faqReply(message, shopId);
    return {
      response: `${ans}\n\n📍 لطفاً آدرس پستی کامل خود را وارد نمایید:`,
      newState: STATES.GETTING_ADDRESS, pendingOrderId, reservationExpiresAt,
    };
  }

  const address = message.trim();
  if (address.length < 10) {
    return {
      response: '⚠️ آدرس وارد شده خیلی کوتاه است. لطفاً آدرس کامل‌تری وارد نمایید:',
      newState: STATES.GETTING_ADDRESS, pendingOrderId, reservationExpiresAt,
    };
  }

  // Save address to ALL pending_info orders for this user+shop
  await supabaseFetch('orders', 'PATCH', { shipping_address: address },
    `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);

  // Fetch all pending orders WITH live product fields so we can re-validate the
  // price / availability at the very moment the final invoice is issued.
  const orderRows = await supabaseFetch('orders', 'GET', null,
    `?select=id,quantity,total_price,product_id,customer_name,phone,products(name,price,stock)&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info&order=created_at.asc`);

  const customerName = orderRows?.[0]?.customer_name || '—';
  const phone       = orderRows?.[0]?.phone         || '—';

  // STAGE 36: reconcile each line against the LIVE product before issuing the
  // invoice. While the customer was typing their details, the admin may have
  // changed the price, renamed, deleted, or sold out the product. We re-read,
  // snapshot the CURRENT price onto the order, drop vanished products, and warn.
  const liveLines = [];      // surviving, price-synced lines
  const priceChanges = [];   // human-readable "old -> new" notes
  const removed = [];        // products that no longer exist
  for (const o of (orderRows || [])) {
    if (!o.products) {
      // Product was deleted mid-checkout -> drop this line + cancel its order.
      removed.push('یک محصول');
      try {
        await supabaseFetch('orders', 'PATCH', { status: 'cancelled' }, `?id=eq.${encodeURIComponent(o.id)}`);
      } catch (e) { console.warn('[GETTING_ADDRESS] cancel removed-product order failed:', e.message); }
      continue;
    }
    const livePrice = Number(o.products.price);
    const liveTotal = livePrice * Number(o.quantity);
    if (Number.isFinite(liveTotal) && liveTotal !== Number(o.total_price)) {
      // Price changed -> sync the current price onto the order so stock,
      // accounting, and the invoice all agree, then tell the customer.
      priceChanges.push(`«${escMd(o.products.name)}»: ${formatPrice(o.total_price)} ➜ ${formatPrice(liveTotal)} تومان`);
      try {
        await supabaseFetch('orders', 'PATCH', { total_price: liveTotal }, `?id=eq.${encodeURIComponent(o.id)}`);
      } catch (e) { console.warn('[GETTING_ADDRESS] price sync failed:', e.message); }
    }
    liveLines.push({ name: o.products.name, quantity: o.quantity, total: liveTotal });
  }

  // If every product vanished, abort cleanly instead of issuing a 0-toman invoice.
  if (liveLines.length === 0) {
    clearCartInternal(userId, shopId);
    return {
      response: '⚠️ متأسفانه محصولات سبد خرید شما دیگر در دسترس نیستند و سفارش لغو شد.\n\nلطفاً دوباره از فروشگاه دیدن نمایید 🙏',
      newState: STATES.IDLE,
      pendingOrderId: null,
    };
  }

  const grandTotal = liveLines.reduce((s, l) => s + Number(l.total || 0), 0);
  const itemLines = liveLines.map((l, i) =>
    `${i + 1}. 📦 ${escMd(l.name || 'محصول')}  ×${l.quantity}  ➜  ${formatPrice(l.total)} تومان`
  ).join('\n');

  let noticeBlock = '';
  if (priceChanges.length) {
    noticeBlock += `⚠️ قیمت برخی اقلام به‌روزرسانی شد:\n${priceChanges.map(c => `• ${c}`).join('\n')}\n──────────────────\n`;
  }
  if (removed.length) {
    noticeBlock += `⚠️ این محصولات دیگر موجود نیستند و از سفارش حذف شدند:\n${removed.map(n => `• ${n}`).join('\n')}\n──────────────────\n`;
  }

  const invoiceText =
    noticeBlock +
    `📜 *فاکتور نهایی سفارش شما:*\n` +
    `──────────────────\n` +
    `👤 تحویل‌گیرنده: ${escMd(customerName)}\n` +
    `📞 شماره تماس: ${escMd(phone)}\n` +
    `📍 آدرس پستی: ${escMd(address)}\n` +
    `──────────────────\n` +
    `🛒 اقلام سفارش:\n${itemLines}\n` +
    `──────────────────\n` +
    `💵 *جمع کل قابل پرداخت: ${formatPrice(grandTotal)} تومان*` +
    `\n──────────────────\n🎟 اگر کد تخفیف دارید، آن را همین‌جا ارسال کنید.`;

  const loyaltyHint = await buildLoyaltyHint(shopId, userId);

  return {
    response: invoiceText + loyaltyHint,
    newState: STATES.AWAITING_RECEIPT,
    pendingOrderId,
    reservationExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    markup: {
      inline_keyboard: [
        [{ text: '✅ تایید نهایی و پرداخت', callback_data: `finalize_order:${pendingOrderId}` }],
        [{ text: '❌ لغو و ویرایش', callback_data: 'cancel_checkout' }],
      ],
    },
  };
}

async function handleGETTING_PHONE(userId, platform, message, shopId, pendingOrderId, reservationExpiresAt) {
  const action = await classifyCheckoutInput(message);

  if (action === 'CANCEL') {
    await cancelOrder(pendingOrderId);
    clearCartInternal(userId, shopId);
    return { response: '🚫 سفارش لغو شد. 🙏', newState: STATES.IDLE, pendingOrderId: null };
  }

  const phone = cleanPhone(message);
  if (!validatePhone(phone)) {
    return {
      response: '⚠️ شماره وارد شده معتبر نیست. لطفاً یک شماره ایرانی (مثلاً 09121234567) وارد نمایید:',
      newState: STATES.GETTING_PHONE, pendingOrderId, reservationExpiresAt,
    };
  }

  // Save phone to ALL pending_info orders for this user+shop
  await supabaseFetch('orders', 'PATCH', { phone },
    `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);

  return {
    response: `✅ شماره تماس ثبت شد: *${phone}*\n\n��� لطفاً آدرس پستی کامل خود را وارد نمایید:`,
    newState: STATES.GETTING_ADDRESS,
    pendingOrderId,
    reservationExpiresAt,
  };
}

async function handleAWAITING_RECEIPT(userId, platform, message, shopId, pendingOrderId, reservationExpiresAt, imagePayload) {
  if (!imagePayload) {
    // Phase 6 · Step 2: text in AWAITING_RECEIPT may be a coupon code. If it
    // applies, re-issue the discounted invoice; otherwise fall through to the
    // receipt prompt.
    // Phase 6 · Step 3b: a loyalty keyword redeems points before we treat the
    // text as a coupon code. Works on Telegram + Instagram (text routes here).
    const loyaltyKw = String(message || '').trim().toLowerCase();
    if (['امتیاز', 'امتياز', 'points', 'point', 'امتیازم', '🎁'].includes(loyaltyKw)) {
      const redeemResult = await reserveLoyaltyRedemption(userId, shopId, pendingOrderId);
      if (redeemResult) {
        return { ...redeemResult, pendingOrderId, reservationExpiresAt };
      }
    }
    const couponResult = await applyCouponAtCheckout(userId, shopId, pendingOrderId, message);
    if (couponResult) {
      return { ...couponResult, pendingOrderId, reservationExpiresAt };
    }
    return {
      response: '📸 لطفاً تصویر رسید پرداخت خود را ارسال نمایید.\n\n(اگر کد تخفیف دارید، همان را ارسال کنید)\n(برای استفاده از امتیاز وفاداری، کلمهٔ «امتیاز» را بفرستید)\n(برای لغو سفارش: ❌ لغو سفارش)',
      newState: STATES.AWAITING_RECEIPT, pendingOrderId, reservationExpiresAt,
    };
  }

  let receiptUrl = imagePayload.url || `file_id:${imagePayload.file_id}`;

  // STAGE 35: receipt vision analysis + duplicate guard are BEST-EFFORT. A
  // failure of the vision API or the duplicate lookup must never block saving
  // the receipt, otherwise a transient outage would lose the customer's proof
  // of payment and force them to re-send.
  let trackingCode = null;
  if (imagePayload.url) {
    try {
      trackingCode = await analyzeReceiptVision(imagePayload.url);
    } catch (visionErr) {
      console.warn('[handleAWAITING_RECEIPT] vision analysis failed (non-fatal):', visionErr.message);
      trackingCode = null;
    }
  }

  if (trackingCode) {
    try {
      const existing = await supabaseFetch('orders', 'GET', null,
        `?select=id&tracking_code=eq.${encodeURIComponent(trackingCode)}&shop_id=eq.${encodeURIComponent(shopId)}&limit=1`);
      if (existing?.length && existing[0].id !== pendingOrderId) {
        return {
          response: '⚠️ این رسید قبلاً ثبت شده است. لطفاً رسید واقعی خو�� را ارسال نمایید.',
          newState: STATES.AWAITING_RECEIPT, pendingOrderId, reservationExpiresAt,
        };
      }
    } catch (dupErr) {
      console.warn('[handleAWAITING_RECEIPT] duplicate check failed (non-fatal):', dupErr.message);
    }
  }

  // STAGE 31: re-host the receipt so it never expires (IG/Telegram links do).
  // persistReceiptImage is already best-effort (returns the original URL on any
  // storage/network failure), so a Supabase Storage outage cannot crash this
  // flow -- the order still gets a usable receipt_url either way.
  if (imagePayload.url) {
    receiptUrl = await persistReceiptImage(receiptUrl, shopId);
  }

  try {
    const updateBody = { receipt_url: receiptUrl, status: 'awaiting_approval' };
    if (trackingCode) updateBody.tracking_code = trackingCode;
    await supabaseFetch('orders', 'PATCH', updateBody, `?id=eq.${pendingOrderId}`);

    // Bug-fix #5: a multi-item checkout creates ONE pending_info row per cart
    // item, but only the primary row above was advanced — so the customer paid
    // once yet every item except the first stayed stuck in pending_info and the
    // merchant never saw them. Advance the SIBLING rows too. tracking_code is
    // UNIQUE, so it stays on the primary row only; siblings just inherit the
    // receipt_url + awaiting_approval status. The status=pending_info filter
    // already excludes the primary (just advanced above), so there is no
    // double-patch and no unique-constraint clash. Best-effort / non-fatal.
    try {
      await supabaseFetch('orders', 'PATCH',
        { receipt_url: receiptUrl, status: 'awaiting_approval' },
        `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);
    } catch (siblingErr) {
      console.warn('[handleAWAITING_RECEIPT] sibling order advance failed (non-fatal):', siblingErr.message);
    }

    // Phase 6 · Step 2: the customer has committed (receipt uploaded), so count
    // the coupon usage now. Best-effort: a failure must never block the order.
    try {
      const ordRows = await supabaseFetch('orders', 'GET', null,
        `?select=coupon_code&id=eq.${encodeURIComponent(pendingOrderId)}&limit=1`);
      const usedCode = ordRows?.[0]?.coupon_code;
      if (usedCode) {
        const coupon = await findCouponByCode(shopId, usedCode);
        if (coupon?.id) await incrementCouponUsage(coupon.id);
      }
    } catch (usageErr) {
      console.warn('[handleAWAITING_RECEIPT] coupon usage increment failed (non-fatal):', usageErr.message);
    }

    // Phase 6 · Step 3b: the customer committed, so actually DEBIT any loyalty
    // points reserved at checkout (via «امتیاز»). Fail-open: a problem here
    // must never block the order from being saved.
    try {
      const ptRows = await supabaseFetch('orders', 'GET', null,
        `?select=points_redeemed&id=eq.${encodeURIComponent(pendingOrderId)}&limit=1`);
      const reserved = Number(ptRows?.[0]?.points_redeemed || 0);
      if (reserved > 0) {
        const r = await redeemPoints({ shopId, userId, points: reserved, orderId: pendingOrderId });
        if (r && r.redeemed !== reserved) {
          await supabaseFetch('orders', 'PATCH',
            { points_redeemed: r.redeemed, points_value: r.value },
            `?id=eq.${encodeURIComponent(pendingOrderId)}`);
        }
      }
    } catch (ptErr) {
      console.warn('[handleAWAITING_RECEIPT] loyalty redemption debit failed (non-fatal):', ptErr.message);
    }

    clearCartInternal(userId, shopId);

    return {
      response:
        `✅ *رسید پرداخت دریافت شد!*\n\n` +
        `سفارش شما در صف بررسی نهایی مدیریت قرار گرفت.\n` +
        (trackingCode ? `🔖 کد پیگیری: \`${trackingCode}\`\n` : '') +
        `\nاز خرید شما سپاسگزاریم 🙏`,
      newState: STATES.IDLE, pendingOrderId: null,
    };
  } catch (err) {
    console.error('[handleAWAITING_RECEIPT] Error:', err.message);
    return {
      response: '⚠️ خطا در ثبت رسید. لطفاً مجدداً تلاش فرمایید.',
      newState: STATES.AWAITING_RECEIPT, pendingOrderId, reservationExpiresAt,
    };
  }
}

// ─── processInlineQuery ───────────────────────────────────────────────────────
/**
 * Handle Telegram inline_query updates.
 * Returns an array of InlineQueryResultArticle objects ready for answerInlineQuery.
 *
 * @param {string} shopId
 * @param {string} queryText  — the raw text the user typed after @BotName
 */
export async function processInlineQuery(shopId, queryText) {
  const sid = shopId || DEFAULT_SHOP_ID;
  const q = (queryText || '').trim();

  try {
    // If query non-empty use ilike filter, otherwise return first 10 products
    const filter = q
      ? `?select=*&shop_id=eq.${encodeURIComponent(sid)}&name=ilike.*${encodeURIComponent(q)}*&limit=10&order=created_at.asc`
      : `?select=*&shop_id=eq.${encodeURIComponent(sid)}&limit=10&order=created_at.asc`;

    const products = await supabaseFetch('products', 'GET', null, filter);

    if (!products?.length) {
      return [{
        type: 'article',
        id: 'no_result',
        title: '📭 محصولی یافت نشد',
        description: q ? `جستجو برای «${q}» نت��جه‌ای نداشت` : 'فروشگاه فعلاً محصولی ندارد',
        input_message_content: {
          message_text: q
            ? `📭 محصولی با نام «${q}» یافت نشد.\n\nیک کلمه دیگر امتحان کنید یا بدون متن جستجو را باز کنید تا همه محصولات نمایش داده شوند.`
            : '📭 در حال حاضر هیچ محصولی در فروشگاه موجود نیست.',
        },
      }];
    }

    return products.map(p => {
      const inStock = Number(p.stock) > 0;
      const stockLine = inStock ? `✅ موجود · ${p.stock} عدد` : '⛔ ناموجود';
      const descLine = p.description?.trim() ? `\n📝 ${escHtml(p.description.trim())}` : '';

      const messageText =
        `📦 <b>${escHtml(p.name)}</b>\n` +
        `💰 قیمت: <b>${formatPrice(p.price)}</b> تومان\n` +
        `📊 ${stockLine}${descLine}\n` +
        `━━━━━━━━━━━━━━━━━━`;

      const btn = inStock
        ? { text: '➕ افزودن به سبد خرید', callback_data: `add_cart:${p.id}` }
        : { text: '⛔ ناموجود', callback_data: 'out_of_stock' };

      // Description shown in the floating list row
      const listDesc = `💰 ${formatPrice(p.price)} تومان · ${inStock ? `✅ ${p.stock} عدد` : '⛔ ناموجود'}`;

      return {
        type: 'article',
        id: String(p.id),
        title: p.name,
        description: listDesc,
        thumbnail_url: p.image_url?.trim() || undefined,
        input_message_content: {
          message_text: messageText,
          parse_mode: 'HTML',
        },
        reply_markup: {
          inline_keyboard: [[btn]],
        },
      };
    });
  } catch (err) {
    console.error('[processInlineQuery] Error:', err.message);
    return [];
  }
}

// ─── processCallback ──���───────────────────────────────────────────────────────
/**
 * Handle Telegram InlineKeyboard callback queries.
 * Called from webhook.js when update.callback_query arrives.
 *
 * Returns: { alertText, showAlert, messages? }
 *   messages: array of { text?, photo?, caption?, markup?, parseMode? }
 */
export async function processCallback(userId, shopId, callbackData, chatId, messageId) {
  const [action, ...args] = (callbackData || '').split(':');

  switch (action) {

    case 'add_cart': {
      const productId = args[0];
      if (!productId) return { alertText: '❌ محصول نامعتبر', showAlert: true };
      try {
        const rows = await supabaseFetch('products', 'GET', null,
          `?select=*&id=eq.${productId}&shop_id=eq.${encodeURIComponent(shopId)}&limit=1`);
        const product = rows?.[0];
        if (!product) return { alertText: '❌ محصول یافت نشد', showAlert: true };
        if (Number(product.stock) <= 0) return { alertText: '⛔ این محصول نا��وجود است', showAlert: true };
        addToCartInternal(userId, shopId, product, 1);
        return { alertText: `✅ ${product.name} به سبد اضافه شد!`, showAlert: true };
      } catch (err) {
        console.error('[processCallback add_cart]', err.message);
        return { alertText: '⚠️ خطا رخ داد. لطفاً مجدداً تلاش کنید', showAlert: true };
      }
    }

    case 'checkout_cart': {
      const cart = getCartInternal(userId, shopId);
      if (!cart?.items?.length) {
        return { alertText: '🛒 سبد خرید شما خالی است', showAlert: true };
      }
      // STAGE 37: drop corrupt lines (null/NaN price, non-positive quantity) so a
      // bad catalog row can never create a poisoned order with NaN total_price.
      const validItems = cart.items.filter((i) => {
        const price = Number(i.product?.price);
        const q = Number(i.quantity);
        return Number.isFinite(price) && price > 0 && Number.isInteger(q) && q > 0;
      });
      if (!validItems.length) {
        return { alertText: '\u26A0\uFE0F \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0642\u06CC\u0645\u062A \u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F', showAlert: true };
      }
      // STAGE 37: a fresh checkout supersedes any abandoned one. Cancel existing
      // pending_info orders for this user+shop first, otherwise the final invoice
      // (which sums ALL pending_info rows) would double-count overlapping sessions.
      try {
        await supabaseFetch('orders', 'PATCH', { status: 'cancelled' },
          `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);
      } catch (e) { console.warn('[checkout_cart] stale pending_info cleanup failed:', e.message); }
      const totalPrice = validItems.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
      try {
        // Create one order row per cart item (multi-item support)
        const orderInserts = await Promise.all(
          validItems.map(item =>
            supabaseFetch('orders', 'POST', {
              user_id: userId,
              product_id: item.product.id,
              quantity: item.quantity,
              total_price: Number(item.product.price) * item.quantity,
              status: 'pending_info',
              shop_id: shopId,
              platform: 'telegram',
            })
          )
        );
        // Use the first order's ID as the primary reference for the checkout state machine
        const orderId = orderInserts?.[0]?.[0]?.id;
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        await saveChat(userId, 'telegram', '__checkout_start__', 'شروع تسویه',
          'checkout_cart', shopId, STATES.GETTING_NAME, expiresAt, orderId);
        return {
          alertText: '',
          showAlert: false,
          messages: [{
            text: '✅ *سفارش آغاز شد!*\n\n👤 لطفاً نام و نام خ��نوادگی خود را وارد نمایید:',
            markup: CANCEL_KEYBOARD,
            parseMode: 'Markdown',
          }],
        };
      } catch (err) {
        console.error('[processCallback checkout_cart]', err.message);
        return { alertText: '⚠️ خطا در ایجاد سفارش', showAlert: true };
      }
    }

    case 'clear_cart': {
      clearCartInternal(userId, shopId);
      return {
        alertText: '',
        showAlert: false,
        messages: [{
          text: '🗑️ سبد خرید پاک شد.\n\nمی‌توانید محصولات جدیدی انتخاب نمایید 🛍️',
          markup: MAIN_MENU,
          parseMode: '',
        }],
      };
    }

    case 'increase_qty': {
      const productId = args[0];
      const cart = getCartInternal(userId, shopId);
      if (!cart?.items?.length) return { alertText: '🛒 سبد خرید خالی است', showAlert: true };
      const item = cart.items.find(i => String(i.product.id) === String(productId));
      if (!item) return { alertText: '❌ محصول یافت نشد', showAlert: true };
      const maxQty = Number(item.product.stock);
      if (item.quantity >= maxQty) {
        return { alertText: `⚠️ حداکثر موجودی: ${maxQty} عدد`, showAlert: true };
      }
      item.quantity += 1;
      const updatedInc = buildCartMessage(userId, shopId);
      return {
        alertText: '',
        showAlert: false,
        editMessage: { text: updatedInc.text, markup: updatedInc.markup, parseMode: 'Markdown' },
      };
    }

    case 'decrease_qty': {
      const productId = args[0];
      const cart = getCartInternal(userId, shopId);
      if (!cart?.items?.length) return { alertText: '🛒 سبد خرید خالی است', showAlert: true };
      const itemIndex = cart.items.findIndex(i => String(i.product.id) === String(productId));
      if (itemIndex === -1) return { alertText: '❌ محصول یافت نشد', showAlert: true };
      cart.items[itemIndex].quantity -= 1;
      if (cart.items[itemIndex].quantity <= 0) {
        cart.items.splice(itemIndex, 1);
        // Cart is now empty — send a fresh message (can't use an InlineKeyboard-less edit)
        return {
          alertText: '',
          showAlert: false,
          messages: [{
            text: '🛒 سبد خرید شما در حال حاضر خالی است!',
            markup: MAIN_MENU,
            parseMode: '',
          }],
        };
      }
      const updatedDec = buildCartMessage(userId, shopId);
      return {
        alertText: '',
        showAlert: false,
        editMessage: { text: updatedDec.text, markup: updatedDec.markup, parseMode: 'Markdown' },
      };
    }

    case 'finalize_order': {
      const shop = await getShopInfo(shopId);
      const card = formatCardForDisplay(shop?.card_number);
      if (!card.valid) {
        // STAGE 36: never show a customer a broken/empty card. Guard + warn.
        console.error(`[finalize_order] shop "${shopId}" has a missing/invalid card_number — payment blocked`);
        return {
          alertText: '',
          showAlert: false,
          messages: [{
            text:
              `⚠️ *پرداخت موقتاً در دسترس نیست*\n` +
              `──────────────────\n` +
              `شماره کارت فروشگاه هنوز به‌درستی تنظیم نشده است.\n` +
              `سفارش شما ثبت شده و محفوظ است؛ لطفاً کمی بعد دوباره تلاش کنید یا با پشتیبانی فروشگاه تماس بگیرید 🙏`,
            markup: MAIN_MENU,
            parseMode: 'Markdown',
          }],
        };
      }
      return {
        alertText: '',
        showAlert: false,
        messages: [{
          text:
            `💳 *پرداخت سفارش*\n` +
            `──────────────────\n` +
            `لطفاً مبلغ را به کارت زیر واریز نمایید:\n` +
            `\`${card.display}\`\n` +
            `──────────────────\n` +
            `📸 پس از پرداخت، تصویر رسید خود را در همین چت ارسال کنید.`,
          markup: null,
          parseMode: 'Markdown',
        }],
      };
    }

    case 'cancel_checkout': {
      // Cancel ALL pending_info orders for this user+shop
      try {
        await supabaseFetch('orders', 'PATCH', { status: 'cancelled' },
          `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&status=eq.pending_info`);
      } catch (err) {
        console.error('[processCallback cancel_checkout]', err.message);
      }
      clearCartInternal(userId, shopId);
      await saveChat(userId, 'telegram', '__cancel_checkout__', 'لغو سفارش',
        'cancel', shopId, STATES.IDLE, null, null);
      return {
        alertText: '',
        showAlert: false,
        messages: [{
          text: '🚫 سفارش لغو شد.\n\nهر زمان که خواستید می‌توانید دوباره خرید نمایید 🙏',
          markup: MAIN_MENU,
          parseMode: '',
        }],
      };
    }

    case 'noop':
      return { alertText: '', showAlert: false };

    case 'out_of_stock':
      return { alertText: '⛔ این محصول ناموجود است', showAlert: true };

    default:
      return { alertText: '', showAlert: false };
  }
}

// ─── Main processMessage ──────────────────────────────────────────────────────
/**
 * Main entry point for text / photo / contact messages.
 *
 * @param {string}      userId
 * @param {string}      platform
 * @param {string}      message     — text or caption
 * @param {string}      shopId
 * @param {object|null} imagePayload — { file_id, url? }
 * @param {object|null} contact      — Telegram contact object (has phone_number)
 *
 * @returns {{ success, response?, markup?, multiMessages?, intent, parseMode? }}
 */
export async function processMessage(userId, platform, message, shopId, imagePayload = null, contact = null) {
  const textMsg = message || '';
  const sid = shopId || DEFAULT_SHOP_ID;

  const { state, pendingOrderId, reservationExpiresAt } = await getLatestState(userId, sid);

  // ── 0. Reservation TTL enforcement (STAGE 37) ───────────────────────────────
  // The 2h reservation expiry was always stored but NEVER checked, so a customer
  // could resume a checkout (and its stock reservation) hours or days later on
  // top of stale pending_info orders. If the window elapsed, cancel the orphaned
  // orders, clear the cart, and hard-reset to IDLE before doing anything else.
  if (state !== STATES.IDLE && reservationExpiresAt && Date.parse(reservationExpiresAt) < Date.now()) {
    try {
      await supabaseFetch('orders', 'PATCH', { status: 'cancelled' },
        `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(sid)}&status=eq.pending_info`);
    } catch (e) { console.warn('[processMessage] expired reservation cleanup failed:', e.message); }
    clearCartInternal(userId, sid);
    const expMsg = '\u23F3 \u0645\u0647\u0644\u062A \u062A\u06A9\u0645\u06CC\u0644 \u0633\u0641\u0627\u0631\u0634 \u0642\u0628\u0644\u06CC \u0628\u0647 \u067E\u0627\u06CC\u0627\u0646 \u0631\u0633\u06CC\u062F \u0648 \u0633\u0641\u0627\u0631\u0634 \u0644\u063A\u0648 \u0634\u062F.\n\n\u0628\u0631\u0627\u06CC \u0634\u0631\u0648\u0639 \u062E\u0631\u06CC\u062F \u062C\u062F\u06CC\u062F \u0627\u0632 \u0645\u0646\u0648\u06CC \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F \uD83D\uDED5';
    await saveChat(userId, platform, textMsg || '__expired__', expMsg, 'expired', sid, STATES.IDLE, null, null);
    return { success: true, response: expMsg, markup: MAIN_MENU, intent: 'expired' };
  }

  // ── 1. Contact message (phone from request_contact button) ──────────────────
  if (contact) {
    let phone = cleanPhone(contact.phone_number || '');
    if (state === STATES.GETTING_PHONE) {
      if (validatePhone(phone)) {
        const result = await handleGETTING_PHONE(userId, platform, phone, sid, pendingOrderId, reservationExpiresAt);
        const markup = STATE_MARKUP[result.newState] ?? MAIN_MENU;
        const expiresAt = result.reservationExpiresAt || reservationExpiresAt;
        await saveChat(userId, platform, `contact:${phone}`, result.response, 'contact', sid, result.newState, expiresAt, result.pendingOrderId ?? pendingOrderId);
        return { success: true, response: result.response, markup, intent: 'contact' };
      } else {
        const response = '📵 شماره ارسالی پشتیبانی نمی‌شود. لطفاً شماره موبایل ایرانی خود را دستی تایپ نمایید:';
        await saveChat(userId, platform, 'contact:invalid', response, 'contact', sid, STATES.GETTING_PHONE, reservationExpiresAt, pendingOrderId);
        return { success: true, response, markup: PHONE_KEYBOARD, intent: 'contact' };
      }
    }
    return { success: true, response: '', markup: MAIN_MENU, intent: 'contact' };
  }

  // ── 2. Cancel order button — works from any checkout state ──────────────────
  if (textMsg === '❌ لغو سفارش') {
    if (state !== STATES.IDLE) {
      await cancelOrder(pendingOrderId);
      clearCartInternal(userId, sid);
    }
    const response = '🚫 سفارش لغو ��د.\n\nهر زمان که خواستید می‌توانید دوباره خرید نمایید 🙏';
    await saveChat(userId, platform, textMsg, response, 'cancel', sid, STATES.IDLE, null, null);
    return { success: true, response, markup: MAIN_MENU, intent: 'cancel' };
  }

  // ── 3. Main menu buttons — always handled regardless of state ───────────────

  // "���️ مشاهده محصولات" is no longer in the reply keyboard ��� silently ignore
  // if an old client sends it (graceful fallback to FAQ AI below).

  if (textMsg === '🛒 سبد خرید') {
    const cartMsg = buildCartMessage(userId, sid);
    await saveChat(userId, platform, textMsg, cartMsg.text, 'cart', sid, state, reservationExpiresAt, pendingOrderId);
    return { success: true, response: cartMsg.text, markup: cartMsg.markup, intent: 'cart' };
  }

  if (textMsg === '🔍 پیگیری سفارش') {
    const trackMsg = await buildTrackingMessage(userId, sid);
    await saveChat(userId, platform, textMsg, trackMsg, 'tracking', sid, state, reservationExpiresAt, pendingOrderId);
    return { success: true, response: trackMsg, markup: MAIN_MENU, intent: 'tracking' };
  }

  // ── 4a. /menu and /shop shortcuts — same glass button, no keyboard wipe ──────
  if (textMsg === '/menu' || textMsg === '/shop') {
    const shortcutText =
      `🛍️ فروشگاه ما\n\n` +
      `👇 برای مشاهده و جستجوی محصولات، دکمه زیر را لمس کنید:`;
    return {
      success: true,
      response: shortcutText,
      markup: {
        inline_keyboard: [[
          { text: '🔍 مشاهده و جستجوی محصولات', switch_inline_query_current_chat: '' },
        ]],
      },
      parseMode: '',
      intent: 'menu',
    };
  }

  // ── 4. Welcome / /start command ─────────────────────────────────────────────
  // Opt-out / opt-in for marketing broadcasts (Phase 4)
  if (textMsg === '/stop' || (textMsg || '').trim().toLowerCase() === 'stop' || textMsg === 'لغو' || textMsg === 'انصراف') {
    await recordOptOut(sid, userId, platform);
    const offMsg =
      '✅ از این پس پیام تبلیغاتی برای شما ارسال نخواهد شد.\n\nهر زمان خواستید دوباره عضو شوید، کافی است /start را بفرستید.';
    await saveChat(userId, platform, textMsg, offMsg, 'opt_out', sid, STATES.IDLE, null, null);
    return { success: true, response: offMsg, parseMode: '', intent: 'opt_out' };
  }

  if (textMsg === '/start' || textMsg === 'شروع') {
    await clearOptOut(sid, userId);
    const welcome =
      `👋 سلام! به فروشگاه ما خوش آمدید.\n\n` +
      `👇 برای مشاهده محصولات، اسکرول و جستجو، دکمه شیشه‌ای زیر ر�� لمس کنید:`;
    await saveChat(userId, platform, textMsg, welcome, 'start', sid, STATES.IDLE, null, null);
    return {
      success: true,
      // Two-message sequence:
      // 1) Force-remove the old reply keyboard (ReplyKeyboardRemove)
      // 2) Send welcome with the inline search button
      multiMessages: [
        {
          text: '👋 سلام!',
          markup: { remove_keyboard: true },
          parseMode: '',
        },
        {
          text: welcome,
          markup: {
            inline_keyboard: [[
              { text: '🔍 مشاهده و جستجوی محصولات', switch_inline_query_current_chat: '' },
            ]],
          },
          parseMode: '',
        },
      ],
      intent: 'start',
    };
  }

  // ── 5. Checkout state machine ────────────────────────────────────────────────
  let result;

  switch (state) {
    case STATES.GETTING_NAME:
      result = await handleGETTING_NAME(userId, platform, textMsg, sid, pendingOrderId, reservationExpiresAt);
      break;

    case STATES.GETTING_ADDRESS:
      result = await handleGETTING_ADDRESS(userId, platform, textMsg, sid, pendingOrderId, reservationExpiresAt);
      break;

    case STATES.GETTING_PHONE:
      result = await handleGETTING_PHONE(userId, platform, textMsg, sid, pendingOrderId, reservationExpiresAt);
      break;

    case STATES.AWAITING_RECEIPT:
      result = await handleAWAITING_RECEIPT(userId, platform, textMsg, sid, pendingOrderId, reservationExpiresAt, imagePayload);
      break;

    case STATES.IDLE:
    default: {
      // Photo in IDLE — graceful ignore
      if (imagePayload && !textMsg) {
        return { success: true, response: 'برای خرید از دکمه‌های منو استفاده کنید 🛍️', markup: MAIN_MENU, intent: 'idle' };
      }
      // FAQ AI
      const faqResponse = await faqReply(textMsg, sid);
      result = { response: faqResponse, newState: STATES.IDLE };
      break;
    }
  }

  // result.markup takes priority (e.g. final invoice inline buttons); fallback to state default
  const markup = result.markup ?? STATE_MARKUP[result.newState] ?? MAIN_MENU;
  const expiresAt = result.reservationExpiresAt || reservationExpiresAt;
  await saveChat(userId, platform, textMsg || '__image__', result.response, 'general', sid,
    result.newState, expiresAt, result.pendingOrderId ?? pendingOrderId);

  return { success: true, response: result.response, markup, intent: 'general' };
}

// ─── Chat history (used by admin dashboard) ────────────����─────────────────────
export async function getChatHistory(userId, shopId, limit = 20) {
  try {
    const rows = await supabaseFetch('chats', 'GET', null,
      `?select=*&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.desc&limit=${limit}`);
    return rows || [];
  } catch { return []; }
}

export async function restoreStock(orderId) {
  if (!orderId) return;
  try {
    const orders = await supabaseFetch('orders', 'GET', null,
      `?select=product_id,quantity&id=eq.${orderId}&limit=1`);
    const order = orders?.[0];
    if (!order) return;
    const products = await supabaseFetch('products', 'GET', null,
      `?select=stock&id=eq.${order.product_id}&limit=1`);
    const product = products?.[0];
    if (product) {
      await supabaseFetch('products', 'PATCH',
        { stock: Number(product.stock) + Number(order.quantity) },
        `?id=eq.${order.product_id}`);
    }
  } catch (err) {
    console.error('[restoreStock] Error:', err.message);
  }
}

// ============================================================================
// STAGE 17 — Instagram DM -> AI engine bridge
// ============================================================================
//
// Instagram's Messaging API only supports PLAIN TEXT replies — none of the
// Telegram reply/inline keyboards, multiMessages, or HTML parseMode that
// processMessage() returns can be rendered inside a DM. So rather than routing
// Instagram traffic through the full Telegram state machine, we expose a
// dedicated, text-only analysis path here.
//
// analyzeInstagramMessage():
//   1. Classify the customer's intent with the LLM.
//   2. Produce a concise, shop-aware plain-text reply (product/price context
//      pulled live from Supabase; honours each shop's custom system_prompt).
//   3. Persist the exchange to the chats table (platform = 'instagram').
//
// Reuses the OpenRouter client, Supabase helpers, formatPrice(), getShopInfo(),
// buildTrackingMessage(), saveChat(), STATES and DEFAULT_SHOP_ID defined above.

const IG_INTENT_SYSTEM = `You are an intent classifier for an online shop's Instagram DMs.
Read the customer's message (usually Persian) and reply with ONE word only:
GREETING     - hello / thanks / small talk
PRODUCT_INFO - asking what is sold, product details, description
PRICE        - asking about price or discounts
AVAILABILITY - asking whether an item is in stock
TRACKING     - asking about an existing order / shipping status
BUY_INTENT   - wants to order / checkout / pay now
OTHER        - anything else
Reply with the single label, nothing else.`;

const IG_REPLY_SYSTEM = `شما دستیار فروش حرفه‌ای و خوش‌برخورد یک فروشگاه آنلاین در دایرکت اینستاگرام هستید.
- فقط درباره محصولات، قیمت، موجودی، حمل‌ونقل و فرایند خرید پاسخ دهید.
- پاسخ‌ها کوتاه، دوستانه و حداکثر ۴۰ کلمه فا��سی باشند.
- چون دایرکت اینستاگرام دکمه ندارد، اگر مشتری قصد خرید داشت او را مودبانه برای ادامه‌ی خرید در ربات تلگرام یا سایت راهنمایی کنید.
- اگر سؤال نامرتبط بود مودبانه بگویید فقط ��رباره‌ی فروشگاه پاسخ می‌دهید.
- هرگز قیمت یا موجودی را از خودت نساز؛ فقط از داده‌های زیر استفاده کن.`;

/** LLM intent label for an Instagram DM. Returns one of the IG_INTENT_SYSTEM labels. */
async function classifyInstagramIntent(userMsg) {
  if (!userMsg) return 'OTHER';
  try {
    const res = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      max_tokens: 6,
      messages: [
        { role: 'system', content: IG_INTENT_SYSTEM },
        { role: 'user', content: userMsg },
      ],
    });
    const raw = res.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
    const allowed = ['GREETING', 'PRODUCT_INFO', 'PRICE', 'AVAILABILITY', 'TRACKING', 'BUY_INTENT', 'OTHER'];
    return allowed.find((label) => raw.includes(label)) || 'OTHER';
  } catch (err) {
    console.error('[classifyInstagramIntent] Error:', err.message);
    return 'OTHER';
  }
}

/** Build a compact live product-context string used to ground the IG reply. */
async function igProductContext(shopId) {
  try {
    const prods = await supabaseFetch('products', 'GET', null,
      `?select=name,price,stock,description&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.asc&limit=30`);
    if (!prods?.length) return '\n\n(در حال حاضر محصولی ثبت نشده است.)';
    return '\n\nلیست محصولات فروشگاه:\n' + prods.map((p) =>
      `• ${p.name} — ${formatPrice(p.price)} تومان — ${Number(p.stock) > 0 ? `موجود (${p.stock})` : 'ناموجود'}` +
      (p.description?.trim() ? ` — ${p.description.trim()}` : '')
    ).join('\n');
  } catch { return ''; }
}

/** Shop-aware, plain-text sales reply for Instagram (honours shop.system_prompt). */
async function igSmartReply(userMsg, shopId, systemPromptBase = null) {
  try {
    // Stage 18: prefer a pre-resolved shop system_prompt (fetched once by the
    // caller). Fall back to fetching it here for backward compatibility.
    let base = systemPromptBase;
    if (!base) {
      const shop = await getShopInfo(shopId);
      base = shop?.system_prompt?.trim() || IG_REPLY_SYSTEM;
    }
    const productCtx = await igProductContext(shopId);
    const systemPrompt = base + productCtx;

    const res = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      max_tokens: 160,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    });
    return res.choices?.[0]?.message?.content?.trim()
      || 'سلام! ممنون از پیام شما 🙏 چطور می‌تونم کمکتون کنم؟';
  } catch (err) {
    console.error('[igSmartReply] Error:', err.message);
    return 'سلام! پیام شما دریافت شد 🙏 لطفاً چند لحظه دیگر دوباره تلاش کنید.';
  }
}

/**
 * STAGE 17 entry point — analyze an incoming Instagram DM and return a
 * plain-text reply. Called by services/instagramService.js -> handleInstagramDM().
 *
 * @param {string} userId  Instagram-scoped sender id (IGSID)
 * @param {string} message The DM text to analyze
 * @param {string} shopId  The resolved shop id
 * @returns {Promise<{success: boolean, response: string, intent: string}>}
 */
export async function analyzeInstagramMessage(userId, message, shopId, imagePayload = null) {
  const textMsg = (message || '').trim();
  const sid = shopId || DEFAULT_SHOP_ID;
  const t0 = Date.now();
  // STAGE 21: an image (e.g. a payment receipt) can arrive with no caption text.
  const hasImage = !!(imagePayload && imagePayload.url);

  if (!textMsg && !hasImage) {
    return { success: true, response: 'سلام! لطفاً سؤال خود را به صورت متنی بنویسید 🙏', intent: 'empty' };
  }

  // Bug-fix #6 (consent): the Instagram path never honored marketing opt-out.
  // Broadcasts append a footer telling IG users to send "stop" to unsubscribe,
  // but only the Telegram handler (processMessage) ever acted on it — so an IG
  // "stop" was treated as a normal AI message and the customer could NEVER opt
  // out (a false promise + a real consent-compliance hole). Mirror Telegram
  // here, BEFORE the checkout state machine, so an opt-out always wins.
  const igConsentCmd = textMsg.toLowerCase();
  if (textMsg === '/stop' || igConsentCmd === 'stop' || textMsg === 'لغو' || textMsg === 'انصراف') {
    await recordOptOut(sid, userId, 'instagram');
    const offMsg = '✅ از این پس پیام تبلیغاتی برای شما ارسال نخواهد شد.\n\nهر زمان خواستید دوباره عضو شوید، کلمه‌ی start را بفرستید.';
    await saveChat(userId, 'instagram', textMsg, offMsg, 'opt_out', sid, STATES.IDLE);
    return { success: true, response: offMsg, intent: 'opt_out', state: STATES.IDLE };
  }
  if (textMsg === '/start' || igConsentCmd === 'start') {
    await clearOptOut(sid, userId);
    const onMsg = '✅ دوباره عضو شدید؛ از این پس پیام‌های ما را دریافت خواهید کرد. 🌸';
    await saveChat(userId, 'instagram', textMsg, onMsg, 'opt_in', sid, STATES.IDLE);
    return { success: true, response: onMsg, intent: 'opt_in', state: STATES.IDLE };
  }

  // -- STAGE 18: resolve this shop's custom system_prompt from Supabase BEFORE
  //    any OpenRouter call, so every AI reply is injected with the shop's tone.
  const shop = await getShopInfo(sid);
  if (!shop) {
    console.warn('[aiService] Instagram: unknown shop_id "' + sid + '" -- falling back to default persona');
  }
  const shopSystemPrompt = shop?.system_prompt?.trim() || IG_REPLY_SYSTEM;
  console.log('[aiService] Instagram: shop:' + sid + ' -- system_prompt source: ' + (shop?.system_prompt?.trim() ? 'custom (DB)' : 'default'));

  // -- STAGE 20: honour the active checkout state machine (chats.state) for IG.
  //    Mirrors the Telegram flow (GETTING_NAME -> PHONE -> ADDRESS -> RECEIPT)
  //    but text-only, since Instagram DMs have no buttons.
  const { state: igState, pendingOrderId: igPendingOrderId, reservationExpiresAt: igResExpiresAt } = await getLatestState(userId, sid);
  if (igState && igState !== STATES.IDLE) {
    let r;
    switch (igState) {
      case STATES.GETTING_NAME:     r = await handleGETTING_NAME(userId, 'instagram', textMsg, sid, igPendingOrderId, igResExpiresAt); break;
      case STATES.GETTING_PHONE:    r = await handleGETTING_PHONE(userId, 'instagram', textMsg, sid, igPendingOrderId, igResExpiresAt); break;
      case STATES.GETTING_ADDRESS:  r = await handleGETTING_ADDRESS(userId, 'instagram', textMsg, sid, igPendingOrderId, igResExpiresAt); break;
      case STATES.AWAITING_RECEIPT: r = await handleAWAITING_RECEIPT(userId, 'instagram', textMsg, sid, igPendingOrderId, igResExpiresAt, imagePayload); break;
      default: r = null;
    }
    if (r) {
      // Instagram has no inline finalize button -> surface the card number with the invoice.
      if (r.newState === STATES.AWAITING_RECEIPT) {
        const shopInfo = await getShopInfo(sid);
        const card = formatCardForDisplay(shopInfo?.card_number);
        if (card.valid) {
          r.response += `\n\n💳 لطفاً مبلغ را به کارت زیر واریز کنید:\n${card.display}\n📸 سپس تصویر رسید را همینجا ارسال نمایید.`;
        } else {
          // STAGE 36: missing/invalid card -> withhold broken instructions, warn.
          console.error(`[instagram] shop "${sid}" has a missing/invalid card_number — payment instructions withheld`);
          r.response += `\n\n⚠️ پرداخت موقتاً در دسترس نیست؛ شماره کارت فروشگاه هنوز تنظیم نشده است. سفارش شما محفوظ است؛ لطفاً کمی بعد دوباره تلاش کنید یا با پشتیبانی تماس بگیرید 🙏`;
        }
      }
      // When checkout returns to IDLE (completed or cancelled), close the DB cart.
      if (r.newState === STATES.IDLE) { await checkoutDbCart(userId, sid, 'instagram'); }
      const exp = r.reservationExpiresAt || igResExpiresAt;
      await saveChat(userId, 'instagram', textMsg, r.response, 'checkout', sid, r.newState, exp, r.pendingOrderId ?? igPendingOrderId);
      console.log(`[aiService] Instagram checkout step: ${igState} -> ${r.newState}`);
      return { success: true, response: r.response, intent: 'checkout', state: r.newState };
    }
  }

  // STAGE 21: an image with no active checkout (state IDLE) -- acknowledge politely.
  if (!textMsg && hasImage) {
    const reply = '📷 تصویر شما دریافت شد! اگر این رسید پرداخت است، لطفاً ابتدا سفارش خود را ثبت کنید و سپس رسید را ارسال نمایید. برای شروع خرید کا��یست نام محصول را بنویسید 🙏';
    await saveChat(userId, 'instagram', '[image]', reply, 'image_no_order', sid, STATES.IDLE);
    return { success: true, response: reply, intent: 'image_no_order', state: STATES.IDLE };
  }

  // 1. Classify intent
  const intent = await classifyInstagramIntent(textMsg);

  // 2. Branch to the right responder (every branch returns PLAIN TEXT)
  let response;
  switch (intent) {
    case 'TRACKING':
      // buildTrackingMessage() already returns Instagram-safe plain text
      response = await buildTrackingMessage(userId, sid);
      break;

    case 'GREETING':
      response = 'سلام و وقت بخیر! 🌸 به فروشگاه ما خوش اومدید. چطور می‌تونم کمکتون کنم؟ می‌تونید درباره‌ی محصولات، قیمت یا موجودی بپرسید.';
      break;

    case 'BUY_INTENT':
      return await startInstagramCheckout(userId, sid, textMsg, shopSystemPrompt);

    default: // PRODUCT_INFO | PRICE | AVAILABILITY | OTHER
      response = await igSmartReply(textMsg, sid, shopSystemPrompt);
      break;
  }

  // 3. Persist the exchange (state stays IDLE — IG has no checkout state machine)
  await saveChat(userId, 'instagram', textMsg, response, intent.toLowerCase(), sid, STATES.IDLE);

  console.log(`[aiService] Instagram analysis done in ${Date.now() - t0}ms — intent:${intent}`);
  return { success: true, response, intent };
}

// ============================================================================
// STAGE 20 -- Instagram DB-backed cart + checkout state machine
// ============================================================================
//
// Telegram keeps its cart in memory (cartStore Map). Instagram has no inline
// buttons, so the cart is persisted in the `carts` table (migration
// 015_create_carts_table.sql) and the checkout is driven entirely by
// chats.state via the SAME handlers Telegram uses.

/** Active DB cart rows (with product info) for an Instagram user. */
async function getDbCart(userId, shopId, platform = 'instagram') {
  try {
    return await supabaseFetch('carts', 'GET', null,
      `?select=id,quantity,product_id,products(name,price,stock)&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&platform=eq.${platform}&status=eq.active&order=created_at.asc`) || [];
  } catch (err) {
    console.error('[getDbCart] Error:', err.message);
    return [];
  }
}

/** Create or update the customer's cart row in `carts` (add product / bump qty). */
async function addToDbCart(userId, shopId, platform, product, qty = 1) {
  const cap = Number(product.stock) > 0 ? Number(product.stock) : qty;
  const existing = await supabaseFetch('carts', 'GET', null,
    `?select=id,quantity&user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&platform=eq.${platform}&product_id=eq.${product.id}&status=eq.active&limit=1`);
  if (existing?.length) {
    const newQty = Math.min(Number(existing[0].quantity) + qty, cap);
    await supabaseFetch('carts', 'PATCH',
      { quantity: newQty, updated_at: new Date().toISOString() },
      `?id=eq.${existing[0].id}`);
    return newQty;
  }
  const insertQty = Math.min(qty, cap);
  await supabaseFetch('carts', 'POST', {
    user_id: userId,
    shop_id: shopId,
    platform,
    product_id: product.id,
    quantity: insertQty,
    status: 'active',
  });
  return insertQty;
}

/** Mark every active cart row as checked_out (called when checkout ends). */
async function checkoutDbCart(userId, shopId, platform = 'instagram') {
  try {
    await supabaseFetch('carts', 'PATCH',
      { status: 'checked_out', updated_at: new Date().toISOString() },
      `?user_id=eq.${encodeURIComponent(userId)}&shop_id=eq.${encodeURIComponent(shopId)}&platform=eq.${platform}&status=eq.active`);
  } catch (err) {
    console.error('[checkoutDbCart] Error:', err.message);
  }
}

/** Best-effort match of a product the customer named in free-form DM text. */
async function resolveProductFromText(shopId, text) {
  let products = [];
  try {
    products = await supabaseFetch('products', 'GET', null,
      `?select=id,name,price,stock&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.asc&limit=50`) || [];
  } catch (err) {
    console.error('[resolveProductFromText] Error:', err.message);
  }
  if (!products.length) return { product: null, products: [] };

  const norm = (x) => (x || '').toString().toLowerCase().replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
  const t = norm(text);

  // 1) full product-name substring match
  let match = products.find((p) => p.name && t.includes(norm(p.name)));
  // 2) token match: any meaningful word of the product name appears in the text
  if (!match) {
    match = products.find((p) =>
      norm(p.name).split(' ').some((tok) => tok.length >= 3 && t.includes(tok)));
  }
  return { product: match || null, products };
}

/**
 * STAGE 20 entry -- handle an Instagram BUY_INTENT message.
 *   1) resolve the product from the DM text
 *   2) add it to the DB cart (create/update `carts`)
 *   3) open an order row (pending_info)
 *   4) advance chats.state to GETTING_NAME so the button-less checkout begins
 */
async function startInstagramCheckout(userId, shopId, textMsg, systemPromptBase) {
  const { product, products } = await resolveProductFromText(shopId, textMsg);

  if (!products.length) {
    const reply = 'در حال حاضر محصولی برای سفارش ثبت نشده است. به‌زودی فهرست محصولات اضافه می‌شود 🙏';
    await saveChat(userId, 'instagram', textMsg, reply, 'buy_intent', shopId, STATES.IDLE);
    return { success: true, response: reply, intent: 'buy_intent', state: STATES.IDLE };
  }

  if (!product) {
    const list = products.slice(0, 10)
      .map((p) => `• ${p.name} — ${formatPrice(p.price)} تومان${Number(p.stock) > 0 ? '' : ' (ناموجود)'}`)
      .join('\n');
    const reply = `خوشحالیم که قصد خرید دارید! 😍\nلطفاً نام دقیق محصولی که می‌خواهید را بنویسید:\n\n${list}`;
    await saveChat(userId, 'instagram', textMsg, reply, 'buy_intent', shopId, STATES.IDLE);
    return { success: true, response: reply, intent: 'buy_intent', state: STATES.IDLE };
  }

  if (Number(product.stock) <= 0) {
    const reply = `متأسفانه «${product.name}» در حال حاضر ناموجود است 🙏\nمایلید مح��ول دیگری را بررسی کنید؟`;
    await saveChat(userId, 'instagram', textMsg, reply, 'buy_intent', shopId, STATES.IDLE);
    return { success: true, response: reply, intent: 'buy_intent', state: STATES.IDLE };
  }

  // 1) add to DB cart (create/update `carts`)
  const qty = await addToDbCart(userId, shopId, 'instagram', product, 1);

  // STAGE 37: numeric integrity guard — never open an order on corrupt pricing.
  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) {
    const reply = `\u0645\u062A\u0623\u0633\u0641\u0627\u0646\u0647 \u0642\u06CC\u0645\u062A «${product.name}» \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A \u0648 \u0627\u0645\u06A9\u0627\u0646 \u062B\u0628\u062A \u0633\u0641\u0627\u0631\u0634 \u0646\u06CC\u0633\u062A \uD83D\uDE4F`;
    await saveChat(userId, 'instagram', textMsg, reply, 'buy_intent', shopId, STATES.IDLE);
    return { success: true, response: reply, intent: 'buy_intent', state: STATES.IDLE };
  }

  // 2) open an order row (pending_info) -- mirrors Telegram checkout_cart
  let pendingOrderId = null;
  try {
    const inserted = await supabaseFetch('orders', 'POST', {
      user_id: userId,
      product_id: product.id,
      quantity: qty,
      total_price: Number(product.price) * qty,
      status: 'pending_info',
      shop_id: shopId,
      platform: 'instagram',
    });
    pendingOrderId = inserted?.[0]?.id || null;
  } catch (err) {
    console.error('[startInstagramCheckout] order insert error:', err.message);
  }

  // 3) advance chats.state to GETTING_NAME (button-less checkout begins)
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const reply =
    `🛒 «${product.name}» به سبد خرید شما اضافه شد (${qty} عدد).\n` +
    `💵 مبلغ: ${formatPrice(Number(product.price) * qty)} تومان\n\n` +
    `برای ثبت سفارش، لطفاً نام و نام خانوادگی خود را بنویسید:`;
  await saveChat(userId, 'instagram', textMsg, reply, 'checkout_start', shopId, STATES.GETTING_NAME, expiresAt, pendingOrderId);
  console.log(`[aiService] Instagram BUY_INTENT -> cart+order opened, state=GETTING_NAME, order:${pendingOrderId}`);
  return { success: true, response: reply, intent: 'checkout_start', state: STATES.GETTING_NAME };
}
