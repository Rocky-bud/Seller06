/**
 * routes/broadcasts — admin endpoints for marketing broadcasts.
 *
 * PHASE 4 · STEP 1 (Broadcast core)
 *
 *   GET  /api/broadcasts/:shopId/audience?audience=all|buyers|leads  -> recipient count
 *   GET  /api/broadcasts/:shopId                                     -> recent campaigns
 *   POST /api/broadcasts/:shopId/send                                -> send a broadcast
 *
 * Mounted behind authenticateUser; each route is gated by requireShopRole.
 * Sending requires staff or owner; reads require viewer.
 */
import express from 'express';
import { requireShopRole } from '../middleware/auth.js';
import { sendBroadcast, getBroadcasts, getAudienceCount } from '../services/broadcastService.js';

const router = express.Router();

// Recipient-count preview for the composer.
router.get('/:shopId/audience', requireShopRole('viewer'), async (req, res) => {
  try {
    const audience = req.query.audience || 'all';
    const productId = req.query.productId || null;
    const count = await getAudienceCount(req.params.shopId, audience, { productId });
    res.json({ success: true, data: { audience, count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Recent campaign history.
router.get('/:shopId', requireShopRole('viewer'), async (req, res) => {
  try {
    const rows = await getBroadcasts(req.params.shopId);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send a broadcast to the selected audience.
router.post('/:shopId/send', requireShopRole('staff'), async (req, res) => {
  try {
    const { message, imageUrl, buttonLabel, buttonUrl, audience, productId } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: 'پیام نمی‌تواند خالی باشد' });
    }
    if (buttonUrl && !/^https?:\/\//i.test(buttonUrl)) {
      return res
        .status(400)
        .json({ success: false, error: 'آدرس دکمه باید با http یا https شروع شود' });
    }
    const result = await sendBroadcast({
      shopId: req.params.shopId,
      message,
      imageUrl: imageUrl || null,
      buttonLabel: buttonLabel || null,
      buttonUrl: buttonUrl || null,
      audience: audience || 'all',
      productId: productId || null,
      sentBy: (req.user && req.user.id) || null,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
