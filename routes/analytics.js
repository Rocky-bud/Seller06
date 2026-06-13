import { Router } from 'express';
import dotenv from 'dotenv';
import { requireShopRole, requireSuperAdmin } from '../middleware/auth.js';

dotenv.config();

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
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

// Build oldest -> newest day buckets keyed by an ISO yyyy-mm-dd string (UTC).
// The client formats labels in fa-IR; the server only returns raw keys/values.
function buildDayBuckets(days) {
  const buckets = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    buckets.push({ date: d.toISOString().slice(0, 10), revenue: 0, count: 0 });
  }
  return buckets;
}

function dayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Month key (UTC) as 'YYYY-MM' for cohort grouping.
function monthKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

// Build oldest -> newest month buckets as 'YYYY-MM' keys (UTC).
function buildMonthBuckets(months) {
  const buckets = [];
  const today = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    buckets.push(d.toISOString().slice(0, 7));
  }
  return buckets;
}

// Whole-month distance between two 'YYYY-MM' keys (toKey - fromKey).
function monthDiff(fromKey, toKey) {
  const fromParts = fromKey.split('-').map(Number);
  const toParts = toKey.split('-').map(Number);
  return (toParts[0] - fromParts[0]) * 12 + (toParts[1] - fromParts[1]);
}

// ── GET /api/analytics/summary?shopId=SHOP-XXX&days=30 ───────────────────────
// One consolidated, server-computed analytics payload for the merchant
// dashboard: a conversion funnel (conversations -> orders -> paid), per-product
// performance, and a configurable revenue trend. Heavy aggregation runs here so
// the client stays lean and the merchant never touches raw data.
router.get('/summary', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const sid = encodeURIComponent(shopId);

  try {
    // Top of funnel: distinct conversation users (Telegram + Instagram).
    const chatRows = (await supaFetch(`chats?shop_id=eq.${sid}&select=user_id`)) || [];
    const conversationUsers = new Set();
    for (const c of chatRows) {
      if (c && c.user_id) conversationUsers.add(c.user_id);
    }
    const conversations = conversationUsers.size;

    // All orders for the shop (every status) with product names for per-product rollups.
    const orders = (await supaFetch(
      `orders?shop_id=eq.${sid}&select=status,total_price,quantity,product_id,created_at,products(name)`
    )) || [];

    let paidCount = 0;
    let awaitingCount = 0;
    let rejectedCount = 0;
    let totalRevenue = 0;

    const buckets = buildDayBuckets(days);
    const byDay = {};
    for (const b of buckets) byDay[b.date] = b;

    const productMap = {};

    for (const o of orders) {
      const status = o.status || '';
      if (status === 'approved') {
        paidCount += 1;
        const revenue = Number(o.total_price || 0);
        totalRevenue += revenue;

        const key = dayKey(o.created_at);
        if (key && byDay[key]) {
          byDay[key].revenue += revenue;
          byDay[key].count += 1;
        }

        const pid = o.product_id || 'unknown';
        if (!productMap[pid]) {
          productMap[pid] = {
            productId: pid,
            name: (o.products && o.products.name) || 'محصول حذف‌شده',
            units: 0,
            revenue: 0,
            orders: 0,
          };
        }
        productMap[pid].units += Number(o.quantity || 0);
        productMap[pid].revenue += revenue;
        productMap[pid].orders += 1;
      } else if (status === 'awaiting_approval') {
        awaitingCount += 1;
      } else {
        rejectedCount += 1;
      }
    }

    const ordersStarted = orders.length;
    const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    const funnel = [
      { stage: 'conversations', label: 'مکالمه‌ها', value: conversations },
      { stage: 'orders', label: 'سفارش ثبت‌شده', value: ordersStarted, ofPrev: pct(ordersStarted, conversations) },
      { stage: 'awaiting', label: 'در انتظار پرداخت', value: awaitingCount, ofPrev: pct(awaitingCount, ordersStarted) },
      { stage: 'paid', label: 'پرداخت‌شده', value: paidCount, ofPrev: pct(paidCount, ordersStarted) },
    ];

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const averageOrderValue = paidCount > 0 ? Math.round(totalRevenue / paidCount) : 0;

    res.json({
      success: true,
      data: {
        days,
        funnel,
        conversionRate: pct(paidCount, conversations),
        totals: {
          conversations,
          ordersStarted,
          awaitingCount,
          paidCount,
          rejectedCount,
          totalRevenue,
          averageOrderValue,
        },
        revenueTrend: buckets,
        topProducts,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/analytics/retention?shopId=SHOP-XXX&months=6 ──────────────────
// Cohort retention: group customers by their FIRST paid-order month, then show
// how many of each cohort came back to buy in later months. Also returns
// overall repeat-customer metrics. Report-only; touches no write paths.
router.get('/retention', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  const months = Math.min(12, Math.max(2, Number(req.query.months) || 6));
  const sid = encodeURIComponent(shopId);

  try {
    // Only approved (paid) orders count as real purchases for retention.
    const orders = (await supaFetch(
      `orders?shop_id=eq.${sid}&status=eq.approved&select=user_id,created_at`
    )) || [];

    // Collect the distinct purchase months and order count per customer.
    const byUser = {};
    for (const o of orders) {
      const uid = o && o.user_id;
      if (!uid) continue;
      const mk = monthKey(o.created_at);
      if (!mk) continue;
      if (!byUser[uid]) byUser[uid] = { months: new Set(), orders: 0 };
      byUser[uid].months.add(mk);
      byUser[uid].orders += 1;
    }

    const windowMonths = buildMonthBuckets(months); // oldest -> newest
    const windowSet = new Set(windowMonths);
    const maxOffset = months - 1;

    // cohort keyed by first-purchase month; only cohorts inside the window show.
    const cohortMap = {};
    for (const m of windowMonths) {
      cohortMap[m] = { cohort: m, size: 0, active: {} };
    }

    let totalCustomers = 0;
    let repeatCustomers = 0;
    let totalOrders = 0;

    for (const uid of Object.keys(byUser)) {
      const info = byUser[uid];
      const sorted = Array.from(info.months).sort();
      const firstMonth = sorted[0];
      totalCustomers += 1;
      totalOrders += info.orders;
      if (info.orders > 1) repeatCustomers += 1;

      if (!windowSet.has(firstMonth)) continue; // first purchase before window
      const cohort = cohortMap[firstMonth];
      cohort.size += 1;
      for (const m of sorted) {
        const off = monthDiff(firstMonth, m);
        if (off < 0 || off > maxOffset) continue;
        cohort.active[off] = (cohort.active[off] || 0) + 1;
      }
    }

    // Triangular table: newer cohorts have fewer elapsed months to report.
    const cohorts = windowMonths.map((m) => {
      const c = cohortMap[m];
      const span = maxOffset - monthDiff(windowMonths[0], m);
      const retention = [];
      for (let off = 0; off <= span; off++) {
        const count = c.active[off] || 0;
        const pct = c.size > 0 ? Math.round((count / c.size) * 1000) / 10 : 0;
        retention.push({ offset: off, count, pct });
      }
      return { cohort: m, size: c.size, retention };
    });

    const repeatRate = totalCustomers > 0
      ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10
      : 0;
    const avgOrdersPerCustomer = totalCustomers > 0
      ? Math.round((totalOrders / totalCustomers) * 100) / 100
      : 0;

    res.json({
      success: true,
      data: {
        months,
        cohorts,
        totals: {
          totalCustomers,
          repeatCustomers,
          oneTimeCustomers: totalCustomers - repeatCustomers,
          repeatRate,
          avgOrdersPerCustomer,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/analytics/broadcast-roi?shopId=SHOP-XXX&windowDays=3 ────────────
// Broadcast ROI: attribute paid orders back to the campaign that likely drove
// them. Recipient lists are not persisted, so we use last-touch attribution
// within a window — each approved order is credited to the most recent
// broadcast sent within `windowDays` before the order. Report-only.
router.get('/broadcast-roi', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  const windowDays = Math.min(30, Math.max(1, Number(req.query.windowDays) || 3));
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const sid = encodeURIComponent(shopId);

  try {
    const campaigns = (await supaFetch(
      `broadcasts?shop_id=eq.${sid}&select=id,message,audience,created_at,total_recipients,sent_count&order=created_at.asc`
    )) || [];

    const orders = (await supaFetch(
      `orders?shop_id=eq.${sid}&status=eq.approved&select=total_price,created_at`
    )) || [];

    // Per-campaign accumulators + parsed send timestamps.
    const stats = {};
    const prepared = [];
    for (const c of campaigns) {
      stats[c.id] = { attributedOrders: 0, attributedRevenue: 0 };
      const sentAt = c.created_at ? Date.parse(c.created_at) : NaN;
      if (!Number.isNaN(sentAt)) prepared.push({ id: c.id, sentAt });
    }

    // Credit each order to the most recent campaign within the window.
    for (const o of orders) {
      const ts = o.created_at ? Date.parse(o.created_at) : NaN;
      if (Number.isNaN(ts)) continue;
      let best = null;
      for (const c of prepared) {
        if (c.sentAt <= ts && ts - c.sentAt <= windowMs) {
          if (!best || c.sentAt > best.sentAt) best = c;
        }
      }
      if (best) {
        stats[best.id].attributedOrders += 1;
        stats[best.id].attributedRevenue += Number(o.total_price || 0);
      }
    }

    const round1 = (n) => Math.round(n * 10) / 10;

    // Newest campaign first for display.
    const result = campaigns.slice().reverse().map((c) => {
      const s = stats[c.id] || { attributedOrders: 0, attributedRevenue: 0 };
      const sent = Number(c.sent_count || 0);
      const recipients = Number(c.total_recipients || 0);
      return {
        id: c.id,
        message: (c.message || '').slice(0, 80),
        audience: c.audience || 'all',
        createdAt: c.created_at,
        sentCount: sent,
        totalRecipients: recipients,
        attributedOrders: s.attributedOrders,
        attributedRevenue: s.attributedRevenue,
        revenuePerRecipient: sent > 0 ? Math.round(s.attributedRevenue / sent) : 0,
        conversionRate: sent > 0 ? round1((s.attributedOrders / sent) * 100) : 0,
      };
    });

    const totalAttributedOrders = result.reduce((a, c) => a + c.attributedOrders, 0);
    const totalAttributedRevenue = result.reduce((a, c) => a + c.attributedRevenue, 0);

    res.json({
      success: true,
      data: {
        windowDays,
        totals: {
          campaigns: campaigns.length,
          totalAttributedOrders,
          totalAttributedRevenue,
        },
        campaigns: result,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/analytics/admin-overview ────────────────────────────────────
// Aggregated, multi-shop snapshot for the super-admin dashboard. Rolls up
// revenue / orders / products / chats across EVERY shop and returns a per-shop
// breakdown plus a 7-day revenue trend and platform split. Super-admin only.
router.get('/admin-overview', requireSuperAdmin, async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  try {
    const shops = (await supaFetch('shops?select=id,name&order=created_at.asc')) || [];
    const shopName = {};
    for (const s of shops) shopName[s.id] = s.name || s.id;

    // Pull all orders + chats + products in a few broad reads (service-role key).
    const orders = (await supaFetch(
      'orders?select=shop_id,status,total_price,quantity,product_id,platform,created_at,products(name)&order=created_at.desc'
    )) || [];
    const chats = (await supaFetch('chats?select=shop_id,platform,user_id')) || [];
    const products = (await supaFetch('products?select=id,shop_id')) || [];

    // Per-shop accumulators.
    const perShop = {};
    const ensure = (sid) => {
      if (!perShop[sid]) {
        perShop[sid] = {
          shopId: sid,
          name: shopName[sid] || sid,
          revenue: 0,
          approvedOrders: 0,
          pendingCount: 0,
          totalOrders: 0,
          products: 0,
          chats: 0,
        };
      }
      return perShop[sid];
    };
    for (const s of shops) ensure(s.id);

    const buckets = buildDayBuckets(days);
    const byDay = {};
    for (const b of buckets) byDay[b.date] = b;

    const platforms = {
      telegram: { count: 0, revenue: 0 },
      instagram: { count: 0, revenue: 0 },
    };
    const productMap = {};

    let totalRevenue = 0;
    let pendingCount = 0;
    let approvedCount = 0;

    for (const o of orders) {
      const sid = o.shop_id || 'unknown';
      const row = ensure(sid);
      row.totalOrders += 1;
      const status = o.status || '';
      if (status === 'approved') {
        const revenue = Number(o.total_price || 0);
        totalRevenue += revenue;
        approvedCount += 1;
        row.revenue += revenue;
        row.approvedOrders += 1;

        const key = dayKey(o.created_at);
        if (key && byDay[key]) {
          byDay[key].revenue += revenue;
          byDay[key].count += 1;
        }

        const plat = (o.platform === 'instagram') ? 'instagram' : 'telegram';
        platforms[plat].count += 1;
        platforms[plat].revenue += revenue;

        const pid = o.product_id || 'unknown';
        if (!productMap[pid]) {
          productMap[pid] = {
            productId: pid,
            name: (o.products && o.products.name) || '\u0645\u062D\u0635\u0648\u0644 \u062D\u0630\u0641\u200C\u0634\u062F\u0647',
            units: 0,
            revenue: 0,
            orders: 0,
          };
        }
        productMap[pid].units += Number(o.quantity || 0);
        productMap[pid].revenue += revenue;
        productMap[pid].orders += 1;
      } else if (status === 'awaiting_approval') {
        pendingCount += 1;
        row.pendingCount += 1;
      }
    }

    for (const p of products) {
      const row = ensure(p.shop_id || 'unknown');
      row.products += 1;
    }

    const chatUsersByShop = {};
    let telegramChats = 0;
    let instagramChats = 0;
    for (const c of chats) {
      const sid = c.shop_id || 'unknown';
      if (!chatUsersByShop[sid]) chatUsersByShop[sid] = new Set();
      if (c.user_id) chatUsersByShop[sid].add(c.user_id);
      if (c.platform === 'instagram') instagramChats += 1; else telegramChats += 1;
    }
    for (const sid of Object.keys(chatUsersByShop)) {
      ensure(sid).chats = chatUsersByShop[sid].size;
    }
    const totalChats = telegramChats + instagramChats;

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const shopRows = Object.values(perShop).sort((a, b) => b.revenue - a.revenue);

    res.json({
      success: true,
      data: {
        days,
        shopCount: shops.length,
        totals: {
          totalRevenue,
          pendingCount,
          approvedOrders: approvedCount,
          totalProducts: products.length,
          totalChats,
          telegramChats,
          instagramChats,
        },
        revenueTrend: buckets,
        platforms,
        platformTotalRevenue: platforms.telegram.revenue + platforms.instagram.revenue,
        topProducts,
        shops: shopRows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
