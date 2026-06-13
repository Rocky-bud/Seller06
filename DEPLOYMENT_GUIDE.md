# 🚀 راهنمای استقرار (Deployment) — اجرای زندهٔ پروژه

> این راهنما برای **زنده‌کردن کل سیستم** نوشته شده: بک‌اند (سرور Node/Express)، فرانت‌اند (React/Vite)، دیتابیس (Supabase) و وبهوک‌های تلگرام/اینستاگرام.
>
> اگر اهل برنامه‌نویسی نیستی هم نگران نباش — همهٔ دستورها را کپی‌پیست کن. مسیر اصلیِ پیشنهادی **Railway** است؛ در انتها **Render** و **Replit** هم به‌عنوان جایگزین آمده‌اند. ☕️

---

## 🧭 معماری پروژه در یک نگاه

این پروژه سه بخش دارد که باید کنار هم زنده شوند:

| بخش | چیست | کجا اجرا می‌شود |
|---|---|---|
| **دیتابیس** | Supabase (PostgreSQL + Storage) | روی سرویس ابری Supabase |
| **بک‌اند** | سرور Node/Express (`server.js` + `routes/`, `services/`, `middleware/`) | روی Railway / Render / Replit |
| **فرانت‌اند** | React + Vite (`client/`) — هنگام `npm run build` ساخته و توسط همان سرور سرو می‌شود | همان هاست بک‌اند |

> نکته: فرانت‌اند جدا دیپلوی نمی‌شود؛ بعد از `build`، فایل‌های ساخته‌شده توسط سرور Express سرو می‌شوند. پس فقط **یک سرویس** بالا می‌آید.

---

## ✅ مرحلهٔ ۰ — چک‌لیست پیش از شروع

قبل از هر کاری این‌ها را آماده داشته باش:

- [ ] حساب **GitHub** (برای آپلود کد)
- [ ] حساب **Railway** (railway.app — با گوگل/گیت‌هاب رایگان ثبت‌نام)
- [ ] پروژهٔ **Supabase** فعال + کلیدهای آن
- [ ] توکن ربات **تلگرام** (از BotFather) و در صورت نیاز کلیدهای **اینستاگرام/Meta**
- [ ] کلید **OpenRouter** (برای هوش مصنوعی ربات)

---

## 🗄️ مرحلهٔ ۱ — آماده‌سازی دیتابیس (Supabase)

۱. وارد پروژهٔ Supabase شو → بخش **SQL Editor**.

۲. مایگریشن‌ها را **به ترتیب** اجرا کن. فایل‌ها در پوشهٔ `supabase/migrations/` هستند. ترتیب درست:

```
003 … 028, 029, 030, 031, 032
```

۳. ⚠️ این‌ها حتماً باید اجرا شوند (وگرنه ثبت سفارش/کوپن/امتیاز خطا می‌دهد):

- **019** — تأیید اتمیک سفارش
- **020** — جدول اعضای فروشگاه + نقش‌ها (RBAC)
- **031** — افزایش اتمیک مصرف کوپن
- **032** — کاهش اتمیک مصرف کوپن

> وابستگی‌ها: `020` قبل از `021/022` — `027` قبل از `028/031/032` — `029` قبل از `030`.

۴. محتوای هر فایل را باز کن، کپی کن، در SQL Editor بچسبان و **Run** بزن.

---

## 🔑 مرحلهٔ ۲ — متغیرهای محیطی (.env)

این مقادیر را یادداشت کن؛ در مرحلهٔ ۴ داخل Railway وارد می‌کنیم. **هرگز فایل `.env` واقعی را در گیت‌هاب عمومی نگذار.**

```env
PORT=5000

# --- Supabase (سرور) ---
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# --- Supabase (فرانت‌اند) ---
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...

# --- هوش مصنوعی ---
OPENROUTER_API_KEY=...

# --- تلگرام / اینستاگرام ---
TELEGRAM_WEBHOOK_SECRET=یک-رشتهٔ-تصادفی-قوی
META_APP_SECRET=...
INSTAGRAM_APP_SECRET=...

# --- آدرس عمومی (برای وبهوک‌ها — باگ #14) ---
PUBLIC_BASE_URL=https://YOUR-APP.up.railway.app
WEBHOOK_BASE_URL=https://YOUR-APP.up.railway.app

# --- امنیت (محیط واقعی) ---
RBAC_ENFORCED=true
SUPER_ADMIN_EMAILS=carpediemclub88@gmail.com
```

> آدرس `PUBLIC_BASE_URL` را بعد از اولین استقرار (وقتی Railway دامنه داد) برمی‌گردی و کامل می‌کنی.

---

## 📤 مرحلهٔ ۳ — آپلود کد روی GitHub

اگر کد هنوز روی گیت‌هاب نیست:

```bash
cd مسیر/پروژه
git init
git add .
git commit -m "initial deploy"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

> مطمئن شو فایل `.gitignore` شامل `node_modules`، `dist` و `.env` باشد.

---

## 🚂 مرحلهٔ ۴ — استقرار روی Railway (مسیر اصلی)

۱. وارد **railway.app** شو → **New Project** → **Deploy from GitHub repo** → ریپوی پروژه را انتخاب کن.

۲. Railway خودش Node را تشخیص می‌دهد. در تنظیمات سرویس مطمئن شو:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start` (یا `node server.js`)

۳. به تب **Variables** برو و همهٔ متغیرهای مرحلهٔ ۲ را وارد کن.

۴. به تب **Settings → Networking** برو و **Generate Domain** بزن. یک آدرس مثل
   `https://your-app.up.railway.app` می‌گیری.

۵. حالا برگرد به **Variables** و مقدار `PUBLIC_BASE_URL` و `WEBHOOK_BASE_URL` را با همین آدرس کامل کن → سرویس دوباره دیپلوی می‌شود.

۶. منتظر بمان تا وضعیت **Deployed / Active** شود.

---

## 🔗 مرحلهٔ ۵ — اتصال وبهوک‌ها (تلگرام/اینستاگرام)

تا اینجا سرور بالاست، اما ربات هنوز نمی‌داند پیام‌ها را کجا بفرستد. باید وبهوک‌ها را ست کنی.

- این کار از طریق اندپوینت **`POST /api/shops/webhooks/register-all`** انجام می‌شود.
- ⚠️ این مسیر فقط برای **سوپرادمین** باز است (طبق باگ #14). یعنی باید با حسابی که ایمیلش در `SUPER_ADMIN_EMAILS` است وارد شده باشی و توکن معتبر بفرستی.
- آدرس پایه به‌صورت خودکار از `PUBLIC_BASE_URL`/`WEBHOOK_BASE_URL` خوانده می‌شود؛ نیازی به فرستادن دستی آدرس نیست.

نمونهٔ فراخوانی (با توکن سوپرادمین):

```bash
curl -X POST https://your-app.up.railway.app/api/shops/webhooks/register-all \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
```

---

## ❤️ مرحلهٔ ۶ — بررسی سلامت سرویس

```bash
curl https://your-app.up.railway.app/api/readyz
```

- پاسخ موفق = سرویس آمادهٔ پذیرش درخواست است.
- لاگ‌ها به‌صورت **JSON** در داشبورد Railway دیده می‌شوند.

حالا آدرس اپ را در مرورگر باز کن → صفحهٔ ورود داشبورد را می‌بینی. وارد شو و سیستم را **زنده** ببین! 🎉

---

## 🔁 جایگزین A — Render

۱. در **render.com** → **New → Web Service** → اتصال به ریپوی گیت‌هاب.
۲. تنظیمات:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
۳. متغیرهای محیطی مرحلهٔ ۲ را در بخش **Environment** وارد کن.
۴. بعد از استقرار، آدرس `onrender.com` را در `PUBLIC_BASE_URL` بگذار و دوباره دیپلوی کن.
۵. وبهوک‌ها و `readyz` را مثل مراحل ۵ و ۶ انجام بده.

> نکته: در پلن رایگان Render، سرویس بعد از بی‌کاری «خواب» می‌رود و درخواست اول کند است.

---

## 🔁 جایگزین B — Replit

- این پروژه از قبل `REPLIT_DEV_DOMAIN` را می‌شناسد، پس روی Replit هم خوب کار می‌کند.
۱. در Replit → **Create → Import from GitHub**.
۲. در بخش **Secrets** متغیرهای مرحلهٔ ۲ را وارد کن.
۳. دکمهٔ **Run** را بزن؛ Replit آدرس عمومی می‌دهد.
۴. همان آدرس را در `PUBLIC_BASE_URL` بگذار، سپس وبهوک‌ها و `readyz`.

> برای روشن‌ماندن دائمی روی Replit به پلن Reserved VM / Deployments نیاز داری.

---

## 🧪 می‌خواهی فقط سریع و لوکال تست کنی؟ (موقتی)

```bash
npm install
npm run build
npm start          # روی پورت 5000
```

برای اینکه تلگرام/اینستاگرام به لپ‌تاپت برسند، یک تونل عمومی بزن:

```bash
ngrok http 5000
```

آدرس HTTPS‌ای که ngrok می‌دهد را در `PUBLIC_BASE_URL` بگذار. (با بستن لپ‌تاپ قطع می‌شود؛ فقط برای تست.)

---

## 🆘 رفع اشکال سریع

| مشکل | علت محتمل | راه‌حل |
|---|---|---|
| `vite: command not found` | وابستگی‌ها نصب نشده | مطمئن شو Build Command شامل `npm install` است |
| ربات پیام‌ها را دریافت نمی‌کند | وبهوک ست نشده یا `PUBLIC_BASE_URL` غلط است | مرحلهٔ ۵ را با آدرس درست تکرار کن |
| خطای ۴۰۳ روی `register-all` | کاربر سوپرادمین نیست | ایمیلت را در `SUPER_ADMIN_EMAILS` بگذار و دوباره وارد شو |
| خطای دیتابیس هنگام سفارش/کوپن | مایگریشن اجرا نشده | مایگریشن‌های ۰۱۹/۰۲۰/۰۳۱/۰۳۲ را اجرا کن |
| صفحه بالا می‌آید ولی داده ندارد | کلیدهای Supabase اشتباه | `SUPABASE_URL` و کلیدها را بررسی کن |

---

## 📌 خلاصهٔ مسیر طلایی

1. مایگریشن‌های Supabase را اجرا کن (به‌خصوص 019/020/031/032).
2. کد را روی GitHub بگذار.
3. در Railway از روی ریپو دیپلوی کن.
4. متغیرهای محیطی را وارد کن و دامنه بگیر.
5. `PUBLIC_BASE_URL` را با دامنه کامل کن.
6. وبهوک‌ها را با حساب سوپرادمین ست کن.
7. `/api/readyz` را چک کن و اپ را در مرورگر باز کن. 🎉
