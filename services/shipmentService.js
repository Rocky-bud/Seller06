// services/shipmentService.js
// Phase 5 · Step 1 — Delivery / courier tracking.
// Moves an order through its shipment lifecycle (packed -> shipped ->
// delivered), stores an optional postal tracking code, and notifies the
// customer on their original channel (Telegram / Instagram). Designed to be
// extended later with real courier-provider APIs behind the same interface.

import dotenv from 'dotenv';
import { sendTelegramMessage, MAIN_MENU } from './botManager.js';
import { sendInstagramMessage } from './instagramService.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

export const SHIPMENT_STATES = ['packed', 'shipped', 'delivered'];

// Persian customer-facing messages. "packed" is intentionally silent so the
// shopper is not pinged for a purely internal step.
function buildCustomerMessage(status, trackingCode) {
  if (status === 'shipped') {
    let msg =
      '\u{1F69A} \u0633\u0641\u0627\u0631\u0634 \u0634\u0645\u0627 \u0627\u0631\u0633\u0627\u0644 \u0634\u062F!\n\n\u0628\u0633\u062A\u0647\u200C\u06CC \u0634\u0645\u0627 \u062A\u062D\u0648\u06CC\u0644 \u067E\u0633\u062A/\u067E\u06CC\u06A9 \u0634\u062F \u0648 \u0628\u0647\u200C\u0632\u0648\u062F\u06CC \u0628\u0647 \u062F\u0633\u062A\u062A\u0627\u0646 \u0645\u06CC\u200C\u0631\u0633\u062F.';
    if (trackingCode) {
      msg +=
        `\n\n\u06A9\u062F \u0631\u0647\u06AF\u06CC\u0631\u06CC \u0645\u0631\u0633\u0648\u0644\u0647:\n${trackingCode}`;
    }
    msg += '\n\n\u0627\u0632 \u062E\u0631\u06CC\u062F \u0634\u0645\u0627 \u0633\u067E\u0627\u0633\u06AF\u0632\u0627\u0631\u06CC\u0645 \u{1F64F}';
    return msg;
  }
  if (status === 'delivered') {
    return '\u2705 \u0633\u0641\u0627\u0631\u0634 \u0634\u0645\u0627 \u062A\u062D\u0648\u06CC\u0644 \u062F\u0627\u062F\u0647 \u0634\u062F.\n\n\u0627\u0645\u06CC\u062F\u0648\u0627\u0631\u06CC\u0645 \u0627\u0632 \u062E\u0631\u06CC\u062F\u062A\u0627\u0646 \u0631\u0627\u0636\u06CC \u0628\u0627\u0634\u06CC\u062F. \u0645\u0646\u062A\u0638\u0631 \u062F\u06CC\u062F\u0646 \u062F\u0648\u0628\u0627\u0631\u0647\u200C\u06CC \u0634\u0645\u0627 \u0647\u0633\u062A\u06CC\u0645 \u{1F64F}';
  }
  return null; // packed -> silent
}

async function notifyCustomer(shop, order, status, trackingCode) {
  const text = buildCustomerMessage(status, trackingCode);
  if (!text) return false;
  try {
    if ((order.platform || 'telegram') === 'instagram') {
      if (!shop || !shop.instagram_access_token) return false;
      const r = await sendInstagramMessage(
        shop.instagram_access_token,
        order.user_id,
        text,
        order.shop_id,
      );
      return !!(r && r.success !== false);
    }
    const r = await sendTelegramMessage(order.shop_id, order.user_id, text, MAIN_MENU);
    return !!(r && r.ok !== false);
  } catch (err) {
    console.warn(`[shipment] notifyCustomer failed (${order.platform}):`, err.message);
    return false;
  }
}

// Update shipment status (+ optional tracking code) for one order, then notify
// the customer. Returns { order, notified }.
export async function updateShipment(shopId, orderId, status, trackingCode = null) {
  if (!SHIPMENT_STATES.includes(status)) {
    throw new Error(
      `\u0648\u0636\u0639\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0628\u0627\u06CC\u062F \u06CC\u06A9\u06CC \u0627\u0632 \u0627\u06CC\u0646 \u0645\u0648\u0627\u0631\u062F \u0628\u0627\u0634\u062F: ${SHIPMENT_STATES.join(', ')}`,
    );
  }

  const rows = await supaFetch(
    `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}` +
      '&select=id,user_id,platform,shop_id,status,shipment_status,postal_tracking_code&limit=1',
  );
  const order = rows && rows[0];
  if (!order) {
    const e = new Error('\u0633\u0641\u0627\u0631\u0634 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F \u06CC\u0627 \u0645\u062A\u0639\u0644\u0642 \u0628\u0647 \u0627\u06CC\u0646 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0646\u06CC\u0633\u062A');
    e.code = 'not_found';
    throw e;
  }

  const normalizedCode = typeof trackingCode === 'string' ? trackingCode.trim() : '';
  const patch = { shipment_status: status };
  if (normalizedCode) patch.postal_tracking_code = normalizedCode;
  if (status === 'shipped') patch.shipped_at = new Date().toISOString();
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();

  const updated = await supaFetch(
    `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  const row = (updated && updated[0]) || { ...order, ...patch };

  // Only need the shop's Instagram token when notifying an IG customer.
  let shop = null;
  if ((order.platform || 'telegram') === 'instagram') {
    try {
      const shops = await supaFetch(
        `shops?id=eq.${encodeURIComponent(shopId)}&select=id,instagram_access_token&limit=1`,
      );
      shop = shops && shops[0];
    } catch (err) {
      console.warn('[shipment] shop token lookup failed:', err.message);
    }
  }

  const notified = await notifyCustomer(
    { ...(shop || {}), id: shopId },
    { ...order, ...patch },
    status,
    normalizedCode || order.postal_tracking_code,
  );
  return { order: row, notified };
}

export default { updateShipment, SHIPMENT_STATES };
