# Operations Runbook

Everything an operator needs to deploy, configure, and troubleshoot the
platform. For architecture see **[README.md](./README.md)**; for the database
see **[MIGRATIONS.md](./MIGRATIONS.md)**.

---

## 1. Environment variables

Two Supabase projects are in play:
- **AUTH project** (`VITE_*`): issues the admin user JWTs the server verifies.
- **DATA project** (`SUPABASE_*`): stores shops / orders / members / etc.

| Variable | Scope | Required | Purpose |
|----------|-------|----------|---------|
| `PORT` | server | no (default 5000) | HTTP listen port |
| `SUPABASE_URL` | server | yes | DATA project URL |
| `SUPABASE_KEY` | server | yes* | DATA anon key (fallback only) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes (with RLS) | Service-role key; bypasses RLS. **Server-side only.** |
| `VITE_SUPABASE_URL` | client | yes | AUTH project URL (admin login) |
| `VITE_SUPABASE_ANON_KEY` | client | yes | AUTH anon key (browser-safe) |
| `OPENROUTER_API_KEY` | server | yes | LLM access for `aiService` |
| `TELEGRAM_WEBHOOK_SECRET` | server | recommended | Shared secret echoed by Telegram; enables strict 401 rejection |
| `META_APP_SECRET` | server | yes (IG) | Instagram webhook HMAC verification |
| `RBAC_ENFORCED` | server | recommended | `true` = fail-closed roles; unset = legacy warn-only |
| `SUPER_ADMIN_EMAILS` | server | no | Comma-separated emails treated as owner of every shop |

\* Once RLS is enabled (migration 021) the server **must** use
`SUPABASE_SERVICE_ROLE_KEY`; the anon key alone would be locked out.

> **Never** expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENROUTER_API_KEY` to the
> browser or any `VITE_*` variable.

## 2. First-time setup

1. Create the two Supabase projects (or one if you do not split auth/data).
2. Fill `.env` per the table above.
3. Apply **all** migrations in ascending order in the Supabase SQL Editor — see
   [MIGRATIONS.md](./MIGRATIONS.md). Run `020 → 021` (RBAC → RLS) before later
   tables.
4. Set `SUPABASE_SERVICE_ROLE_KEY` and restart **before** enabling RLS (021).
5. Create admin login users in the AUTH project (email/password).
6. Populate `shop_members` so owners/staff/viewers map to shops, then set
   `RBAC_ENFORCED=true`.
7. `npm ci && npm run ci` to validate, then `npm start`.

## 3. Per-shop onboarding (merchant-facing, non-technical)

In the admin panel the merchant only:
- pastes their **Telegram bot token** (from BotFather),
- sets the **store card number** and **AI system prompt**,
- optionally flips **loyalty** on and sets earn/redeem values.

Everything below (webhooks, secrets) is wired automatically by the server.

## 4. Webhook setup

### Telegram
- `botManager` registers the webhook via `setWebhook`, passing `secret_token`.
- Telegram echoes it back in the `X-Telegram-Bot-Api-Secret-Token` header on
  every update; `routes/webhook.js` rejects mismatches with **401** before any
  parsing or DB work.
- **Strict mode:** set `TELEGRAM_WEBHOOK_SECRET`. **Legacy mode:** if unset, a
  deterministic per-shop secret is derived from each bot token and missing
  headers are processed with a warning until `setWebhook` is re-run.
- After changing the secret, **re-run `setWebhook`** (restart the server or
  re-save the bot token in settings).

### Instagram
- `routes/instagramWebhook.js` verifies the raw-body **HMAC** using
  `META_APP_SECRET`. Do not add JSON body parsing before it — HMAC needs the
  raw bytes.

## 5. RBAC & RLS rollout

- **RBAC** (migration 020): roles `owner > staff > viewer` in `shop_members`.
  Roll out warn-only first (`RBAC_ENFORCED` unset), populate `shop_members`,
  then set `RBAC_ENFORCED=true` to fail-closed (401 unauth, 403 wrong role).
- **RLS** (migration 021): enables Row Level Security so a tenant can only see
  its own rows. Safe order: deploy → set `SUPABASE_SERVICE_ROLE_KEY` + restart
  → verify the bot still works → run migration 021.

## 6. Secret rotation

| Secret | How to rotate |
|--------|---------------|
| Telegram bot token | Update in shop settings → server re-runs `setWebhook`. |
| `TELEGRAM_WEBHOOK_SECRET` | Change env → restart → webhook re-registers. |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in Supabase → update env → restart. |
| `VITE_SUPABASE_ANON_KEY` | Rotate in Supabase → rebuild client → redeploy. |
| `OPENROUTER_API_KEY` | Rotate at provider → update env → restart. |
| `META_APP_SECRET` | Rotate in Meta app → update env → restart. |

If an anon key was ever committed/exposed, rotate it and rebuild.

## 7. Health & readiness

- `GET /api/healthz` — liveness (process is up).
- `GET /api/readyz` — readiness (DB + storage reachable). Point your
  orchestrator / load balancer probe here before sending traffic.

## 8. Deployment

- Node 20 + Postgres 16 (see `.replit`). Build the client, then run the server:
  ```bash
  npm ci && npm run build && npm start
  ```
- The Express server serves the built SPA and all API/webhook routes; the SPA
  fallback must remain **after** every API route in `server.js`.
- Wait for `/api/readyz` to return healthy before routing live traffic.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Telegram updates ignored, 401 in logs | `TELEGRAM_WEBHOOK_SECRET` changed without re-running `setWebhook`. Restart / re-save token. |
| Bot stops reading/writing after enabling RLS | Server still on anon key. Set `SUPABASE_SERVICE_ROLE_KEY` and restart. |
| Admin gets 403 on settings | RBAC enforced but `shop_members` missing the user as `owner`. |
| IG webhook signature failures | `META_APP_SECRET` wrong, or JSON parsing runs before HMAC (must use raw body). |
| Loyalty / coupon save errors about missing columns | Migrations 027–030 not applied. Run them in order. |
| Duplicate order from one message | Idempotency table (022) not migrated. |
| `vite: command not found` on build | Dependencies not installed — run `npm ci` first. |
