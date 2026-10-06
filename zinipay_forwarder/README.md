# بولگرام، اپ اندروید

اپ فورواردر بولگرام (`ir.bolgram.forwarder`): پیامک واریز بانک‌های ایرانی را می‌خواند و به سرور می‌فرستد تا فاکتورها خودکار تأیید شوند.

## چطور کار می‌کند

- **ضبط و صف در لایهٔ native (Kotlin)**: `SmsListenerReceiver` پیامک را می‌گیرد، `Filter` فقط فرستنده‌های بانکی را نگه می‌دارد و **هرگز پیامک رمز، رمز پویا یا کد یکبارمصرف را رد نمی‌کند**. پیامک اول روی دیسک ذخیره می‌شود (`Store`)، بعد با `Forwarder` ارسال می‌شود. اگر اینترنت قطع باشد، صف با backoff نمایی (۱۵ ثانیه تا ۳۰ دقیقه) و با برگشت شبکه دوباره تلاش می‌شود؛ هیچ پیامکی گم نمی‌شود.
- **سرویس پیش‌زمینه** (`ForegroundSyncService`): heartbeat هر دقیقه، به‌روزرسانی فهرست فرستنده‌ها هر ۶ ساعت (`GET /api/v1/device/senders`)، بازیابی پیامک‌های از‌دست‌رفته بعد از ریبوت (`Catchup`).
- **رابط فارسی راست‌به‌چپ (Flutter)**: مجوزها، اتصال با QR یا کد ۸ حرفی، وضعیت اتصال و پیامک‌های اخیر. متن پیامک روی گوشی نگه‌داری نمی‌شود، فقط فرستنده و نتیجه.

## اتصال

پنل ← دستگاه‌ها ← «اتصال گوشی اندروید» یک QR (`bolgram://pair?s=<server>&c=<code>`) و کد ۸ حرفی ۱۰ دقیقه‌ای می‌سازد. اپ کد را به `POST /api/v1/device/pair` می‌دهد و توکن دستگاه می‌گیرد؛ توکن در هدر `X-Device-Token` برای `/sms/ingest`، `/heartbeat` و `/senders` فرستاده می‌شود. QR قدیمی (JSON با `device_token`) هم پشتیبانی می‌شود.

## ساخت

```bash
flutter pub get
flutter analyze && flutter test
flutter build apk --release --dart-define=BOLGRAM_SERVER=https://your-domain.ir
```

امضا از متغیرهای محیطی `ANDROID_KEYSTORE_PATH`، `ANDROID_STORE_PASSWORD`، `ANDROID_KEY_ALIAS` و `ANDROID_KEY_PASSWORD` خوانده می‌شود و بدون آن‌ها با کلید debug امضا می‌شود. گردش‌کار `.github/workflows/android.yml` همین کار را با secrets انجام می‌دهد، SHA-256 را چاپ می‌کند و روی تگ‌های `v*` فایل را به Release می‌چسباند. بعد از انتشار، متغیرهای `ANDROID_APP_VERSION`، `ANDROID_APK_URL` و `ANDROID_APK_SHA256` را روی سرور بگذارید تا صفحهٔ «اپلیکیشن» پنل لینک و اثر انگشت را نشان دهد.
