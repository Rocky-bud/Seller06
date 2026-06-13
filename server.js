import express from 'express';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { chatLimiter, webhookLimiter, adminWriteLimiter, memberLimiter } from './middleware/rateLimiters.js';
import { processMessage, getChatHistory } from './services/aiService.js';
import webhookRouter from './routes/webhook.js';
import instagramWebhookRouter from './routes/instagramWebhook.js';
import customersRouter from './routes/customers.js';
import ordersRouter from './routes/orders.js';
import shopsRouter from './routes/shops.js';
import productsRouter from './routes/products.js';
import membersRouter from './routes/members.js';
import broadcastsRouter from './routes/broadcasts.js';
import analyticsRouter from './routes/analytics.js';
import meRouter from './routes/me.js';
import { authenticateUser } from './middleware/auth.js';
import { loadShops } from './services/botManager.js';
import requestLogger from './middleware/requestLogger.js';
import healthRouter from './routes/health.js';
import { startAbandonedCartScheduler } from './services/abandonedCart.js';
import { ensureSuperAdminCodeUser } from './services/accessCodes.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ESM so we can locate the built client bundle (Vite outputs to ../dist).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIST = path.join(__dirname, 'dist');

dotenv.config();

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Replit's reverse proxy)
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials in environment variables');
  process.exit(1);
}

// Global rate limiter: 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید.'
  }
});

// Middleware
// Capture the raw request body so routes that need HMAC signature
// verification (e.g. Instagram's X-Hub-Signature-256) can hash the exact
// bytes Meta sent. JSON parsing still happens as usual into req.body.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Structured request logging + request-id propagation (Phase 2.3)
app.use(requestLogger);

// Health / readiness probes — mounted BEFORE the global limiter so monitoring
// probes are never rate-limited or counted against API budgets (Phase 2.3).
app.use('/api', healthRouter);

// Apply global rate limiter to all API routes
app.use('/api/', globalLimiter);

// Health check route with database connection test
app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const data = await response.json();

    if (!response.ok) {
      return res.json({
        status: 'ok',
        database: { connected: false, error: data.message || 'Query failed' },
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      status: 'ok',
      database: { connected: true, table: 'products', rowsReturned: data?.length || 0 },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.json({
      status: 'ok',
      database: { connected: false, error: err.message },
      timestamp: new Date().toISOString()
    });
  }
});

// AI Chat endpoint (strict rate limit)
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { userId, platform, message, shopId, imagePayload } = req.body;

    if (!userId || !platform || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, platform, message'
      });
    }

    const result = await processMessage(userId, platform, message, shopId, imagePayload);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to process message'
    });
  }
});

// Chat history endpoint
app.get('/api/chat/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const shopId = req.query.shopId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter'
      });
    }

    const history = await getChatHistory(userId, shopId);

    res.json({
      success: true,
      data: history
    });
  } catch (err) {
    console.error('Error in /api/chat/history:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch chat history'
    });
  }
});

// Mount route files
app.use('/api/webhook', webhookLimiter, webhookRouter);
app.use('/api/webhooks/instagram', webhookLimiter, instagramWebhookRouter);
app.use('/api/orders', authenticateUser, adminWriteLimiter, ordersRouter);
app.use('/api/shops', authenticateUser, adminWriteLimiter, shopsRouter);
app.use('/api/products', authenticateUser, adminWriteLimiter, productsRouter);
app.use('/api/customers', authenticateUser, customersRouter);
app.use('/api/members', authenticateUser, memberLimiter, membersRouter);
app.use('/api/broadcasts', authenticateUser, broadcastsRouter);
app.use('/api/analytics', authenticateUser, analyticsRouter);
app.use('/api/me', authenticateUser, meRouter);

// ----- SPA fallback (MUST stay after every API & webhook route above) -----
// Serve the built front-end and let client-side routes such as /dashboard or
// /products resolve to index.html on refresh, instead of returning 404.
// Telegram, Instagram and API routes are mounted earlier, so they keep priority.
app.use(express.static(CLIENT_DIST));

app.get('*', (req, res, next) => {
  // Safety net: never hijack API/webhook paths. Any unmatched /api/* request
  // returns a JSON 404 instead of the HTML shell.
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  // Everything else is a front-end route: hand back the SPA entry point.
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// Start server then load bot registry + auto-register Telegram webhooks
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API status endpoint: http://localhost:${PORT}/api/status`);

  // Load all shop tokens into BotManager so webhook routing is ready immediately
  await loadShops();

  // Ensure the main-admin access code (SUPER_ADMIN_CODE) has a backing auth user
  // so the admin can sign in with just a code. Idempotent + best-effort.
  await ensureSuperAdminCodeUser();

  // PHASE 3 · STEP 1 — start the background abandoned-cart recovery sweep.
  // Timing is fully internal; merchants only toggle it on/off in Settings.
  startAbandonedCartScheduler();

  // Re-register Telegram webhook URLs every startup (Replit dev domain changes on restart)
  const DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  if (DEV_DOMAIN) {
    const baseUrl = `https://${DEV_DOMAIN}`;
    const { registerWebhooksOnStartup } = await import('./routes/webhook.js');
    await registerWebhooksOnStartup(baseUrl);
  } else {
    console.warn('[Server] REPLIT_DEV_DOMAIN not set — skipping webhook auto-registration');
  }
});
