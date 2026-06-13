// STAGE 22 -- prefer the signed-in user's JWT (from Supabase auth) for PostgREST
// requests, falling back to the anon key for unauthenticated reads.
import { getValidAccessToken } from '../lib/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// STAGE 35: pull a *valid* (auto-refreshed) token per request so a JWT that
// expired while the tab was idle is refreshed BEFORE the call, instead of
// sending a stale token and getting a 401.
// Bug-fix #10: exported so page-level components (Orders/BotConfig/ShopManagement)
// can attach the same auth headers to their inline fetch() calls.
export async function authHeaders() {
  const token = (await getValidAccessToken()) || SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

export async function fetchOrders(shopId, status) {
  let query = `?select=*,products(name,price,stock)&shop_id=eq.${shopId}`;
  if (status) query += `&status=eq.${status}`;
  query += '&order=created_at.desc';

  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders${query}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch orders');
  return res.json();
}

// Routes through the server so stock is automatically restored on rejection
export async function updateOrderStatus(orderId, status, shopId) {
  // Bug-fix #8 (client/RBAC): the server now requires shopId on this route
  // (Bug #7 scoped the status PATCH to a single shop) and gates it behind
  // authenticateUser + requireShopRole. This call previously sent neither, so
  // after the server fix the approve/reject button returned 400, and once
  // RBAC_ENFORCED=true it would also 401. Send shopId + the auth headers.
  const res = await fetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ status, shopId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update order status');
  }
  return res.json();
}

// STAGE 31 -- persist/update a receipt image URL on an order. The server side
// re-hosts external (expiring) links into the permanent merchant-files bucket.
export async function updateOrderReceipt(orderId, shopId, receiptUrl) {
  const res = await fetch(`/api/orders/${orderId}/receipt`, {
    method: 'PATCH',
    headers: await authHeaders(), // Bug-fix #10: 401 under RBAC enforcement without auth
    body: JSON.stringify({ shopId, receipt_url: receiptUrl }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to update receipt');
  }
  return json;
}

// Phase 5 Step 1 -- update an order's shipment status (packed/shipped/
// delivered) + optional postal tracking code. Routes through the server so the
// customer is notified automatically on their original channel.
export async function updateOrderShipment(orderId, shopId, shipmentStatus, trackingCode = null) {
  const res = await fetch(`/api/orders/${orderId}/shipment`, {
    method: 'PATCH',
    headers: await authHeaders(), // Bug-fix #10: 401 under RBAC enforcement without auth
    body: JSON.stringify({ shopId, shipment_status: shipmentStatus, tracking_code: trackingCode }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to update shipment');
  }
  return json;
}

// STAGE 33 -- customer directory. Everyone who interacted with the shop is read
// from the chats table (deduped by user_id), then enriched with name + order
// counts joined from the orders table.
// STAGE 33 (refactor) -- the customer directory now goes through the Express
// API (service-role key) instead of a direct browser PostgREST read. The old
// client-side version threw "Failed to fetch customers" whenever the browser
// JWT/RLS context could not read the chats table. Aggregation now lives in
// routes/customers.js.
export async function fetchCustomers(shopId) {
  const res = await fetch(`/api/customers?shopId=${encodeURIComponent(shopId)}`, {
    headers: await authHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch customers');
  }
  return json.data || [];
}

export async function fetchProducts(shopId) {
  const query = `?select=*&shop_id=eq.${shopId}&order=created_at.asc`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products${query}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

// STAGE 29 -- count Telegram/Instagram conversations for a shop using a cheap
// PostgREST exact-count request (no row payload) so the dashboard stays live.
export async function fetchChatCount(shopId, platform) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/chats?shop_id=eq.${encodeURIComponent(shopId)}&platform=eq.${encodeURIComponent(platform)}&select=id`,
    { headers: { ...(await authHeaders()), Prefer: 'count=exact', Range: '0-0' } }
  );
  if (!res.ok) throw new Error('Failed to count chats');
  const range = res.headers.get('content-range') || '';
  const slash = range.lastIndexOf('/');
  const total = slash >= 0 ? Number(range.slice(slash + 1)) : 0;
  return Number.isFinite(total) ? total : 0;
}

// STAGE 32 -- sales analytics. The `orders` table historically had no channel
// column, so each order's platform is resolved from the new orders.platform
// value when present, otherwise from a user_id -> platform map built from chats.
function localDayKey(value) {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build a { [user_id]: platform } lookup from the chats table (one cheap read).
export async function fetchPlatformMap(shopId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/chats?shop_id=eq.${encodeURIComponent(shopId)}&select=user_id,platform`,
    { headers: await authHeaders() }
  );
  if (!res.ok) return {};
  const rows = await res.json();
  const map = {};
  for (const r of rows) {
    if (r && r.user_id && r.platform && !map[r.user_id]) {
      map[r.user_id] = r.platform;
    }
  }
  return map;
}

function resolveOrderPlatform(order, platformMap) {
  if (order.platform === 'telegram' || order.platform === 'instagram') {
    return order.platform;
  }
  const fromChats = platformMap[order.user_id];
  return fromChats === 'instagram' ? 'instagram' : 'telegram';
}

// Pure: turn a list of approved orders into a `days`-day trend + platform split.
export function computeSalesAnalytics(approvedOrders, platformMap = {}, days = 7) {
  const orders = Array.isArray(approvedOrders) ? approvedOrders : [];

  // daily trend buckets (oldest -> newest)
  const today = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push({
      key: localDayKey(d),
      label: d.toLocaleDateString('fa-IR', { weekday: 'short' }),
      dateLabel: d.toLocaleDateString('fa-IR', { day: 'numeric', month: 'short' }),
      revenue: 0,
      count: 0,
    });
  }
  const byKey = {};
  for (const b of buckets) byKey[b.key] = b;
  for (const o of orders) {
    const b = byKey[localDayKey(o.created_at)];
    if (b) {
      b.revenue += Number(o.total_price || 0);
      b.count += 1;
    }
  }

  // platform split across ALL approved orders
  const platforms = {
    telegram: { count: 0, revenue: 0 },
    instagram: { count: 0, revenue: 0 },
  };
  for (const o of orders) {
    const p = resolveOrderPlatform(o, platformMap);
    platforms[p].count += 1;
    platforms[p].revenue += Number(o.total_price || 0);
  }
  const platformTotalRevenue = platforms.telegram.revenue + platforms.instagram.revenue;
  const platformTotalCount = platforms.telegram.count + platforms.instagram.count;

  return {
    dailyTrend: buckets,
    weekRevenue: buckets.reduce((s, b) => s + b.revenue, 0),
    weekCount: buckets.reduce((s, b) => s + b.count, 0),
    platforms,
    platformTotalRevenue,
    platformTotalCount,
  };
}

// Standalone analytics fetch (approved orders + chat platform map).
export async function fetchSalesAnalytics(shopId, days = 7) {
  const [approved, platformMap] = await Promise.all([
    fetchOrders(shopId, 'approved'),
    fetchPlatformMap(shopId).catch(() => ({})),
  ]);
  return computeSalesAnalytics(approved, platformMap, days);
}

// PHASE 7 · STEP 1 — server-side analytics (funnel + per-product + revenue trend).
export async function fetchAnalyticsSummary(shopId, days = 30) {
  const res = await fetch(
    `/api/analytics/summary?shopId=${encodeURIComponent(shopId)}&days=${encodeURIComponent(days)}`,
    { headers: await authHeaders() },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch analytics summary');
  }
  return json.data;
}

// PHASE 7 · STEP 2 — cohort retention (repeat-purchase behaviour by first-buy month).
export async function fetchRetention(shopId, months = 6) {
  const res = await fetch(
    `/api/analytics/retention?shopId=${encodeURIComponent(shopId)}&months=${encodeURIComponent(months)}`,
    { headers: await authHeaders() },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch retention analytics');
  }
  return json.data;
}

// PHASE 7 · STEP 3 — broadcast ROI (orders/revenue attributed to each campaign).
export async function fetchBroadcastRoi(shopId, windowDays = 3) {
  const res = await fetch(
    `/api/analytics/broadcast-roi?shopId=${encodeURIComponent(shopId)}&windowDays=${encodeURIComponent(windowDays)}`,
    { headers: await authHeaders() },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch broadcast ROI');
  }
  return json.data;
}

// Super-admin only: aggregated snapshot across EVERY shop (revenue/orders/
// products/chats) plus a per-shop breakdown. Backed by the server so the heavy
// roll-up happens with the service-role key, not in the browser.
export async function fetchAdminOverview(days = 7) {
  const res = await fetch(
    `/api/analytics/admin-overview?days=${encodeURIComponent(days)}`,
    { headers: await authHeaders() },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch admin overview');
  }
  return json.data;
}

export async function fetchDashboardStats(shopId) {
  const [allOrders, pendingOrders, products, telegramChats, instagramChats, platformMap] = await Promise.all([
    fetchOrders(shopId),
    fetchOrders(shopId, 'awaiting_approval'),
    fetchProducts(shopId),
    fetchChatCount(shopId, 'telegram').catch(() => 0),
    fetchChatCount(shopId, 'instagram').catch(() => 0),
    fetchPlatformMap(shopId).catch(() => ({}))
  ]);

  const approvedOrders = allOrders.filter(o => o.status === 'approved');
  const totalRevenue = approvedOrders.reduce((sum, o) => sum + Number(o.total_price || 0), 0);
  const lowStockProducts = products.filter(p => p.stock <= 3 && p.stock > 0);
  const outOfStockProducts = products.filter(p => p.stock === 0);
  const stockAlertCount = lowStockProducts.length + outOfStockProducts.length;
  const recentOrders = [...allOrders]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  return {
    totalRevenue,
    pendingCount: pendingOrders.length,
    lowStockAlerts: lowStockProducts,
    outOfStockAlerts: outOfStockProducts,
    stockAlertCount,
    totalOrders: allOrders.length,
    approvedOrders: approvedOrders.length,
    totalProducts: products.length,
    telegramChats,
    instagramChats,
    totalChats: telegramChats + instagramChats,
    recentOrders,
    analytics: computeSalesAnalytics(approvedOrders, platformMap, 7)
  };
}

// STAGE 25 -- product mutations routed through the Express API (service-role key;
// strict shop_id ownership checks live in routes/products.js).
export async function createProduct(shopId, payload) {
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: await authHeaders(), // Bug-fix #10: 401 under RBAC enforcement without auth
    body: JSON.stringify({ shopId, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to create product');
  }
  return json.data;
}

export async function updateProduct(id, shopId, updates) {
  const res = await fetch(`/api/products/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(), // Bug-fix #10: 401 under RBAC enforcement without auth
    body: JSON.stringify({ shopId, ...updates }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to update product');
  }
  return json.data;
}

export async function deleteProduct(id, shopId) {
  const res = await fetch(`/api/products/${id}?shopId=${encodeURIComponent(shopId)}`, {
    method: 'DELETE',
    headers: await authHeaders(), // Bug-fix #10: owner-only route 401s without auth
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to delete product');
  }
  return true;
}

// STAGE 26 -- confirm a paid order (final approval) through the Express API.
// The server sets status=approved AND decrements product stock atomically.
export async function confirmOrder(orderId, shopId) {
  const res = await fetch(`/api/orders/${orderId}/confirm`, {
    method: 'PATCH',
    headers: await authHeaders(), // Bug-fix #10: 401 under RBAC enforcement without auth
    body: JSON.stringify({ shopId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to confirm order');
  }
  return json.data;
}

// STAGE 27 -- shop settings: fetch + update through the Express API so the
// service-role key handles reads/writes and the Telegram token stays masked.
export async function fetchShop(shopId) {
  const res = await fetch(`/api/shops/${encodeURIComponent(shopId)}`, { headers: await authHeaders() }); // Bug-fix #11: viewer-guarded read 401s without auth
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch shop');
  }
  return json.data;
}

export async function updateShop(shopId, updates) {
  const res = await fetch(`/api/shops/${encodeURIComponent(shopId)}`, {
    method: 'PATCH',
    headers: await authHeaders(), // Bug-fix #10: owner-only route 401s without auth
    body: JSON.stringify(updates),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to update shop');
  }
  return json.data;
}

// PHASE 3 · STEP 1 — abandoned-cart recovery widget stats (enabled flag + totals).
export async function fetchCartRecoveryStats(shopId) {
  const res = await fetch(`/api/shops/${encodeURIComponent(shopId)}/cart-recovery/stats`, { headers: await authHeaders() }); // Bug-fix #11: viewer-guarded read 401s without auth
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch cart recovery stats');
  }
  return json.data;
}

// PHASE 4 · STEP 1 — broadcast / marketing tools
export async function fetchBroadcastAudienceCount(shopId, audience = 'all', productId = null) {
  const qs =
    `audience=${encodeURIComponent(audience)}` +
    (productId ? `&productId=${encodeURIComponent(productId)}` : '');
  const res = await fetch(
    `/api/broadcasts/${encodeURIComponent(shopId)}/audience?${qs}`,
    { headers: await authHeaders() },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch audience count');
  }
  return json.data;
}

export async function fetchBroadcasts(shopId) {
  const res = await fetch(`/api/broadcasts/${encodeURIComponent(shopId)}`, {
    headers: await authHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to fetch broadcasts');
  }
  return json.data;
}

export async function sendBroadcast(shopId, payload) {
  const res = await fetch(`/api/broadcasts/${encodeURIComponent(shopId)}/send`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to send broadcast');
  }
  return json.data;
}

// Telegram webhook registration triggered from the merchant Settings UI.
// The bot token is saved first via PATCH /api/shops/:shopId (telegram_token);
// this call then asks the server to register the Telegram webhook for the shop,
// passing the public origin so it works on Render (no REPLIT_DEV_DOMAIN needed).
export async function registerTelegramWebhook(shopId) {
  const res = await fetch(`/api/shops/${encodeURIComponent(shopId)}/webhook`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ baseUrl: window.location.origin }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Failed to register webhook');
  }
  return json.data;
}
