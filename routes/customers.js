/**
 * Customer directory API
 *
 * GET /api/customers?shopId=SHOP-XXX
 *
 * Server-side replacement for the old client-side direct-PostgREST read that
 * threw "Failed to fetch customers" in the browser. Everyone who messaged the
 * shop (chats) is deduped by user_id and enriched with order stats. Uses the
 * service-role key, so it never depends on the browser JWT / RLS policies.
 */

import { Router } from 'express';
import dotenv from 'dotenv';
import { requireShopRole } from '../middleware/auth.js';
dotenv.config();

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: BASE_HEADERS });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : [];
}

router.get('/', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    const sid = encodeURIComponent(shopId);
    const [chats, orders] = await Promise.all([
      supaFetch(`chats?shop_id=eq.${sid}&select=user_id,platform,created_at&order=created_at.desc`),
      supaFetch(`orders?shop_id=eq.${sid}&select=user_id,customer_name,phone,status,created_at&order=created_at.desc`).catch(() => []),
    ]);

    // Aggregate order stats + best-known name/phone per user_id.
    const orderAgg = {};
    for (const o of orders || []) {
      if (!o.user_id) continue;
      const a = orderAgg[o.user_id] || (orderAgg[o.user_id] = {
        orderCount: 0, approvedCount: 0, name: null, phone: null,
      });
      a.orderCount += 1;
      if (o.status === 'approved') a.approvedCount += 1;
      if (!a.name && o.customer_name) a.name = o.customer_name;
      if (!a.phone && o.phone) a.phone = o.phone;
    }

    // Dedupe chats by user_id (rows arrive newest-first).
    const map = {};
    for (const c of chats || []) {
      if (!c.user_id) continue;
      let cust = map[c.user_id];
      if (!cust) {
        cust = map[c.user_id] = {
          userId: c.user_id,
          platform: c.platform || 'telegram',
          lastMessageAt: c.created_at,
          messageCount: 0,
        };
      }
      cust.messageCount += 1;
      if (new Date(c.created_at) > new Date(cust.lastMessageAt)) {
        cust.lastMessageAt = c.created_at;
        cust.platform = c.platform || cust.platform;
      }
    }

    const customers = Object.values(map)
      .map((c) => {
        const agg = orderAgg[c.userId] || {};
        return {
          ...c,
          name: agg.name || null,
          phone: agg.phone || null,
          orderCount: agg.orderCount || 0,
          approvedCount: agg.approvedCount || 0,
        };
      })
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    res.json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
