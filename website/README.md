# سایت معرفی بولگرام (استاتیک)

سایت معرفی و بازاریابی بولگرام: صفحهٔ اصلی، تعرفه، سؤالات متداول، مستندات API، درباره ما، تماس، قوانین و وبلاگ. HTML/CSS/JS خالص است و build لازم ندارد.

```
website/
├── public/              ← همین پوشه منتشر می‌شود (Cloudflare Pages: output = website/public)
│   ├── index.html, pricing.html, faq.html, docs.html, about.html, contact.html, legal.html, login.html, 404.html
│   ├── blog/            ← فهرست و مقاله‌ها
│   ├── assets/css/main.css      ← توکن‌های رنگ/تایپ و همهٔ استایل‌ها
│   ├── assets/js/config.js      ← برند، دامنه، لینک‌ها، پلن‌ها، مدل قیمت (FEE_TIERS)
│   ├── assets/js/main.js        ← تم، منو، تب‌ها، accordion، دمو، ماشین‌حساب
│   ├── assets/content/content.json ← متن‌های قابل ویرایش (برای پنل ادمین)
│   ├── assets/img/ (logo.svg, og.png), assets/fonts/ (Vazirmatn، مجوز OFL)
│   └── _headers, robots.txt, sitemap.xml
└── tools/
    ├── partials/header.html, footer.html   ← هدر و فوتر مشترک
    ├── faq.json                            ← سؤالات متداول (صفحهٔ اصلی + faq.html + JSON-LD)
    └── build_pages.py                      ← هدر/فوتر/FAQ را در همهٔ صفحه‌ها می‌گذارد
```

## اجرا روی کامپیوتر
```bash
cd website/public && python3 -m http.server 8080
# http://localhost:8080
```
لینک‌ها مطلق هستند (`/pricing.html`)، پس صفحه را با سرور باز کنید، نه با دوبار کلیک روی فایل.

## ویرایش
- **برند، دامنه، لینک ثبت‌نام/ورود، لینک تلگرام و دانلود اپ:** `public/assets/js/config.js`. اگر لینک دانلود خالی باشد، دکمه «به‌زودی» نمایش داده می‌شود.
- **قیمت‌ها و ماشین‌حساب:** `PLANS`، `PERIODS` و `FEE_TIERS` در همان فایل. با تغییر `FEE_TIERS.model` به `subscription`، `tiered` یا `credit`، ماشین‌حساب مدل جدید را محاسبه می‌کند.
- **هدر، فوتر و FAQ:** فایل‌های `tools/partials/*.html` و `tools/faq.json` را ویرایش کنید و بعد اجرا کنید: `python3 website/tools/build_pages.py`
- **متن‌ها از پنل ادمین (مرحلهٔ بعد):** هر متنی که `data-k="..."` دارد با کلید هم‌نام در `assets/content/content.json` جایگزین می‌شود، مثلاً `{"hero.title": "…", "img.logo": "/uploads/logo.svg"}`. متن پیش‌فرض داخل HTML می‌ماند، پس سئو آسیب نمی‌بیند.
- **رنگ‌ها:** متغیرهای `:root` و `[data-theme="dark"]` در ابتدای `main.css`.

## استقرار روی Cloudflare Pages
1. در Cloudflare: Workers & Pages → Create → Pages → Connect to Git و همین مخزن را انتخاب کنید.
2. Build command: خالی. Build output directory: `website/public`.
3. دامنهٔ خود را در Custom domains اضافه کنید.

یا با Wrangler: `npx wrangler pages deploy website/public --project-name bolgram`

فایل `_headers` هدرهای امنیتی (CSP و…) و کش طولانی فایل‌های ثابت را تنظیم می‌کند. Cloudflare فشرده‌سازی brotli/gzip را خودش انجام می‌دهد.

## کیفیت (آخرین بررسی)
- Lighthouse موبایل: عملکرد ۹۸–۹۹، دسترس‌پذیری ۱۰۰، بهترین‌روش‌ها ۱۰۰، سئو ۱۰۰ (اندازه‌گیری روی سرور محلی بدون فشرده‌سازی)
- بدون اسکرول افقی در ۳۷۵، ۷۶۸ و ۱۲۸۰ پیکسل، بدون خطای جاوااسکریپت و بدون لینک `#` در هیچ صفحه
- بدون کوکی و ابزار ردیابی؛ جای آنالیتیکس با `<!-- ANALYTICS -->` مشخص است.
