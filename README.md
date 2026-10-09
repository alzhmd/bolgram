⭐ اگه این پروژه براتون مفیده، لطفاً بهش استار بدید.

# بولگرام — درگاه پرداخت کارت‌به‌کارت با تأیید خودکار

بولگرام پول را مستقیم به کارت بانکی خود فروشنده می‌رساند و پرداخت را بدون دخالت انسان تأیید می‌کند:
1. هر فاکتور یک **مبلغ یکتا** می‌گیرد؛ مثلاً ۲۵۰٬۰۰۱ تومان به‌جای ۲۵۰٬۰۰۰.
2. مشتری کارت‌به‌کارت می‌کند.
3. گوشی اندروید فروشنده پیامک واریز بانک را به سرور می‌فرستد.
4. سرور از روی مبلغ، فاکتور را پیدا و پرداخت را تأیید می‌کند.

## امکانات
- **پنل فروشنده** (`/panel/`):
  - فروش: داشبورد، فاکتورها (فیلتر، جزئیات، لغو، خروجی اکسل)، واریزی‌های بی‌صاحب (اتصال به فاکتور یا رد)، گزارش فروش با نمودار
  - مالی: لینک پرداخت (مبلغ ثابت، آزاد یا چندگزینه‌ای، و لینک ارزی)، کیف پول کارمزد و شارژ با هدیه، پلن‌ها، کارت‌ها
  - اتصال: دستگاه‌ها و اتصال گوشی با QR، شورتکات آیفون، ربات تلگرام و بله، وب‌هوک، کلید API و افزونهٔ ووکامرس
  - کسب‌وکار: نماد اعتماد، همکاران با نقش (مالک، مدیر، حسابدار، صندوق‌دار، فقط مشاهده)، دعوت دوستان، پشتیبانی، آموزش، اعلان‌ها، تنظیمات
- **پنل مالک سرویس** (`/owner/`):
  - داشبورد کل، فروشگاه‌ها (تعلیق، خروج اجباری)، پلن‌ها و تنظیمات مالی، کیف پول‌ها و شارژها
  - تیکت‌ها، بررسی نماد اعتماد، نظرها، اعلان همگانی، وب‌هوک‌های ناموفق، ویرایش محتوای سایت
  - آزمایشگاه پیامک بانک، گزارش فعالیت، سلامت سیستم
- **صفحه‌های مشتری:** پرداخت `/checkout.html` (نمایش کارت هم‌بانک با مشتری)، لینک پرداخت `/l/<نام>`، نماد اعتماد `/trust/<نام فروشگاه>`
- **تشخیص پیامک بانک‌های ایرانی:**
  - بانک‌ها: ملت، ملی، تجارت، پاسارگاد، رسالت، پارسیان، بلو، شهر، مهر ایران، خاورمیانه و قالب عمومی، با ارقام فارسی و تاریخ شمسی.
  - پیامک فرستندهٔ غیربانکی هرگز خودکار تأیید نمی‌شود.
  - پیامک تکراری دوباره حساب نمی‌شود و پیامک رمز یکبارمصرف و برداشت نادیده گرفته می‌شود.
- **ربات تلگرام و بله:** ساخت فاکتور با فرستادن مبلغ، مدیریت کارت‌ها، گزارش، بررسی واریزی‌ها و اعلان لحظه‌ای پرداخت. در تلگرام با Rich Message (جدول فشرده، دکمه‌های رنگی و نقل‌قول بازشو).
- **اپ اندروید** (`app/`): ارسال پیامک بانکی با صف آفلاین؛ پیامک‌های رمز و OTP هرگز فرستاده نمی‌شوند.
- **سایت معرفی** (`website/`): برای Cloudflare Pages؛ محتوا، پلن‌ها و نظرها را زنده از سرور می‌خواند.

## ساختار پروژه
```
src/            سرور (Fastify + TypeScript، دیتابیس SQLite داخلی Node.js)
  routes/v2/    API پنل فروشنده و پنل مالک
  parsers/ir/   تشخیص پیامک بانک‌های ایرانی
  bot/          ربات تلگرام و بله
public/         پنل فروشنده، پنل مالک، صفحهٔ پرداخت و لینک پرداخت
app/            اپ اندروید (Flutter)
website/        سایت معرفی (استاتیک)
integrations/   افزونهٔ ووکامرس
deploy/         Caddyfile و سرویس systemd
tests/          تست‌ها
```

## نصب خودکار با یک دستور
روی یک سرور Ubuntu یا Debian، با کاربر root:
```bash
git clone https://github.com/alzhmd/bolgram.git /opt/bolgram && sudo bash /opt/bolgram/deploy/install.sh
```
اسکریپت این کارها را انجام می‌دهد:
- Docker را اگر نصب نیست نصب می‌کند.
- کلید Cloudflare را روی سرور پیدا می‌کند و رکوردهای DNS را می‌سازد: `bolgram.ir`، `www` و `pay.bolgram.ir` به IP سرور. کلید را می‌توانید با `CF_API_TOKEN=...` هم بدهید.
- کلیدهای امنیتی و رمز پنل مالک را تصادفی می‌سازد و رمز را در `/root/bolgram-credentials.txt` می‌گذارد.
- سایت و پنل را با HTTPS بالا می‌آورد.
- اگر nginx روی سرور باشد، بولگرام را پشت همان nginx قرار می‌دهد.

دامنه‌ها با `SITE_DOMAIN` و `PAY_DOMAIN` قابل تغییرند.

## راه‌اندازی روی سرور (پیشنهادی: Docker)
پیش‌نیاز: یک سرور لینوکس با Docker، و یک دامنه (مثلاً `pay.example.com`) که رکورد A آن به IP سرور اشاره کند.

```bash
git clone https://github.com/alzhmd/bolgram.git && cd bolgram
cp .env.example .env
openssl rand -hex 32   # برای JWT_SECRET
openssl rand -hex 32   # برای CARD_ENC_KEY
nano .env               # مقادیر را پر کنید (پایین را ببینید)
docker compose up -d --build
```

حداقل مقادیر لازم در `.env`:

| متغیر | توضیح |
|---|---|
| `DOMAIN` و `PUBLIC_BASE_URL` | دامنهٔ شما، مثلاً `pay.example.com` و `https://pay.example.com` |
| `JWT_SECRET` | رشتهٔ تصادفی؛ عوض کردنش همه را از حساب خارج می‌کند |
| `CARD_ENC_KEY` | کلید رمزنگاری شمارهٔ کارت‌ها. **از آن نسخهٔ پشتیبان بگیرید و هرگز عوضش نکنید.** |
| `ADMIN_EMAIL` و `ADMIN_PASSWORD` | ورود به پنل مالک |
| `SMSIR_API_KEY` و `SMSIR_TEMPLATE_ID` | پیامک کد ورود. در پنل SMS.IR یک قالب Verify با پارامتر `CODE` بسازید. |

Caddy گواهی HTTPS را خودکار می‌گیرد. بعد از بالا آمدن:
- پنل فروشنده: `https://دامنه/panel/`
- پنل مالک: `https://دامنه/owner/`
- **پشتیبان‌گیری:** همهٔ داده‌ها (دیتابیس و فایل‌ها) در volume `bolgram-data` هستند:
  ```bash
  docker compose exec bolgram node -e "new (require('node:sqlite').DatabaseSync)('/data/bolgram.db').exec(\"VACUUM INTO '/data/backup.db'\")"
  docker compose cp bolgram:/data/backup.db ./bolgram-backup.db
  ```
  فایل `.env` را هم جای امن نگه دارید.
- **به‌روزرسانی:**
  ```bash
  git pull && docker compose up -d --build
  ```

### بدون Docker
Node.js 22.13 یا بالاتر لازم است.
```bash
npm ci && npm run build && npm prune --omit=dev
sudo cp deploy/bolgram.service /etc/systemd/system/ && sudo systemctl enable --now bolgram
```
- سرویس از پوشهٔ `/opt/bolgram` و کاربر `bolgram` اجرا می‌شود؛ در صورت نیاز فایل سرویس را ویرایش کنید.
- جلوی آن Caddy یا Nginx با HTTPS بگذارید و به پورت 4000 وصل کنید.
- اگر پراکسی روی همان سرور است، `TRUST_PROXY` را خالی بگذارید.

## بعد از نصب
1. **فروشگاه سرویس (برای شارژ کیف پول فروشنده‌ها):**
   1. در پنل فروشنده یک فروشگاه برای خود سرویس بسازید.
   2. کارت و گوشی آن را وصل کنید.
   3. در پنل مالک ← «تنظیمات مالی» آن را به‌عنوان فروشگاه سرویس انتخاب کنید.
   از این به بعد شارژ کیف پول فروشنده‌ها با همان سازوکار کارت‌به‌کارت به این فروشگاه واریز و خودکار تأیید می‌شود.
2. **ربات‌ها (اختیاری):**
   - تلگرام: `TELEGRAM_BOT_TOKEN` و `TELEGRAM_BOT_USERNAME` از BotFather. سرورِ داخل ایران برای تلگرام یک رله در `TELEGRAM_API_BASE` لازم دارد.
   - بله: `BALE_BOT_TOKEN` و `BALE_BOT_USERNAME`؛ بله داخل ایران مستقیم کار می‌کند.
3. **سلامت سیستم:** در پنل مالک صفحهٔ «سلامت سیستم» نشان می‌دهد چه تنظیمی کم است.

## اپ اندروید
GitHub Actions (`.github/workflows/android.yml`) با هر push به `main` که پوشهٔ `app/` را تغییر دهد، APK را می‌سازد. می‌توانید دستی از تب Actions هم اجرایش کنید.
1. **کلید امضا** را یک‌بار بسازید:
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias bolgram -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.jks
   ```
   این فایل و رمزهایش را گم نکنید؛ بدون آن‌ها به‌روزرسانی اپ ممکن نیست.
2. **در GitHub ← Settings ← Secrets and variables ← Actions:**
   - Secretها: `ANDROID_KEYSTORE_BASE64` (خروجی دستور بالا)، `ANDROID_KEY_ALIAS`، `ANDROID_KEY_PASSWORD` و `ANDROID_STORE_PASSWORD`.
   - Variable: `BOLGRAM_SERVER` با مقدار `https://دامنه`.
3. **انتشار:** با push یک تگ مثل `v1.0.0`، APK همراه SHA-256 در Releases منتشر می‌شود.
4. **لینک دانلود در پنل:** آدرس، نسخه و SHA-256 را در `.env` بگذارید (`ANDROID_APK_URL`، `ANDROID_APP_VERSION`، `ANDROID_APK_SHA256`) تا در پنل ← «اپلیکیشن» نمایش داده شوند.
5. **فروشگاه‌ها:** برای بازار و مایکت همین APK کافی است. Google Play برای مجوز پیامک فرم «Permissions Declaration» می‌خواهد.

## سایت معرفی (Cloudflare Pages)
1. **اتصال مخزن:** در Cloudflare مسیر Workers & Pages ← Create ← Pages ← Connect to Git را بزنید و این مخزن را انتخاب کنید.
2. **تنظیمات ساخت:** Build command را خالی بگذارید و Build output directory را `website/public` بگذارید.
3. **دامنهٔ سرور:** در کل پوشهٔ `website/public`، عبارت `pay.bolgram.example` را با آدرس سرور خود جایگزین کنید:
   ```bash
   grep -rl pay.bolgram.example website/public | xargs sed -i 's#pay.bolgram.example#pay.example.com#g'
   ```
4. **هدر، فوتر و FAQ:** بعد از ویرایش `website/tools/` این را اجرا کنید:
   ```bash
   python3 website/tools/build_pages.py
   ```

## اتصال فروشگاه اینترنتی
- **ساخت فاکتور:** `POST /api/v1/payment/create` با هدر `x-api-key`؛ کلید را از پنل ← «افزونه‌ها و API» بگیرید. پاسخ شامل `payment_url` است؛ مشتری را به آن بفرستید.
- **وب‌هوک:** با `X-Bolgram-Signature: t=<unix>,v1=<hmac-sha256(secret, t + "." + body)>` امضا می‌شود.
- **ووکامرس:** فایل zip افزونه از همان صفحهٔ پنل دانلود می‌شود. سورس آن در `integrations/woocommerce/` است.
- **مستندات کامل:** `website/public/docs.html`.

## اتصال ربات‌های تلگرام و بله
کلاینت آمادهٔ پایتون و PHP در `integrations/bots/` است؛ هیچ وابستگی‌ای ندارد.
```python
from bolgram import Bolgram
bg = Bolgram("https://pay.bolgram.ir", "live_sk_...")      # پنل ← «افزونه‌ها و API»
inv = bg.create_invoice(150_000, order_id="u123-vpn-30d", customer="@ali")
# دکمهٔ inv["payment_url"] را برای کاربر بفرستید؛ مبلغ قابل پرداخت: inv["amount_toman"]
if bg.is_paid(inv["invoice_id"]):
    deliver()   # تحویل سرویس
```
برای دریافت خبر پرداخت دو راه هست:
- **وب‌هوک (فوری):** `webhook_url` را بدهید و امضا را با `Bolgram.verify_webhook` بررسی کنید.
- **پرس‌وجو:** هر ۱۰ تا ۱۵ ثانیه، تا ۳۰ دقیقه، `is_paid` را صدا بزنید.

## امنیت
- **ورود و دسترسی:** ورود، نقش‌ها و دسترسی‌ها سمت سرور بررسی می‌شوند و نشست‌ها با تغییر رمز یا تعلیق فروشگاه باطل می‌شوند.
- **کارت‌ها:** شمارهٔ کامل کارت‌ها با AES-256-GCM ذخیره می‌شود و همه‌جا فقط ۴ رقم آخر نمایش داده می‌شود.
- **محدودیت درخواست:** محدودیت تعداد درخواست بر اساس IP واقعی مشتری است؛ هدر جعلی `X-Forwarded-For` پذیرفته نمی‌شود.
- **قفل ورود:** ورود با رمز اشتباه، کد اتصال ربات و کد پیامکی پس از چند تلاش قفل می‌شوند.

## توسعه و تست
```bash
npm ci
npm run dev                                   # http://localhost:4000/panel/
npm test                                      # تست‌های سرور
npm run e2e -- http://127.0.0.1:4000          # چرخهٔ کامل پرداخت روی سرور در حال اجرا
```
قراردادهای کدنویسی پنل و API در `docs/dev/PANEL_CONVENTIONS.md` است.

## مجوز
MIT. این پروژه بر پایهٔ [SyncPay BD](https://github.com/jahidulislamseo/syncpay-bd) ساخته شده و برای ایران بازنویسی شده است.
