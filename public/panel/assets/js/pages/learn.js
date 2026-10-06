// Learn center: searchable guides with categories, progress checkmarks (localStorage) and deep links #/learn/<slug>.
import { esc, toFa, fixArabic, debounce, emptyState, ICON, useStyle, $, $$ } from '../core.js';

const CATS = [
  ['start', 'شروع کار'], ['sales', 'فروش و دریافت پول'], ['connect', 'اتصال و یکپارچه‌سازی'],
  ['manage', 'مدیریت فروشگاه'], ['security', 'امنیت'], ['help', 'عیب‌یابی'],
];
const CAT_NAME = Object.fromEntries(CATS);
const L = (id, t) => [id, t];

// Guide content lives here (HTML is static, authored in this file only).
const ARTICLES = [
  {
    slug: 'getting-started', cat: 'start', min: 6, title: 'شروع سریع: از ثبت‌نام تا اولین پرداخت',
    summary: 'پنج قدم ساده برای دریافت اولین پرداخت کارت‌به‌کارت با تأیید خودکار.',
    links: [L('cards', 'افزودن کارت'), L('app', 'نصب برنامهٔ اندروید'), L('devices', 'دستگاه‌ها'), L('invoices', 'فاکتورها')],
    body: `<p>بولگرام پول را مستقیم به <b>کارت بانکی خودتان</b> می‌رساند. گوشی اندرویدی شما پیامک بانک را می‌خواند و بولگرام پرداخت را به فاکتور درست وصل می‌کند.</p>
<ol>
<li><b>ثبت‌نام:</b> با شمارهٔ موبایل ثبت‌نام کنید و شمارهٔ خود را با کد پیامکی تأیید کنید.</li>
<li><b>افزودن کارت:</b> در بخش «کارت‌ها» شمارهٔ کارتی را که می‌خواهید پول در آن بنشیند ثبت کنید. فقط ۴ رقم آخر در صفحه‌ها نمایش داده می‌شود. کارت باید به نام خودتان باشد.</li>
<li><b>نصب برنامهٔ اندروید و اتصال گوشی:</b> برنامه را از بخش «برنامهٔ اندروید» دانلود کنید، روی گوشی‌ای که پیامک بانک روی آن می‌آید نصب کنید و با کد اتصال در بخش «دستگاه‌ها» جفت کنید. دسترسی پیامک و بی‌نیاز بودن از بهینه‌سازی باتری را بدهید.</li>
<li><b>ساخت اولین فاکتور:</b> از «فاکتورها» یا دکمهٔ فاکتور جدید، مبلغ را به تومان بنویسید. بولگرام چند ریال به مبلغ اضافه می‌کند تا فاکتور شما یکتا شود (راهنمای «مبلغ یکتا» را ببینید).</li>
<li><b>پرداخت آزمایشی:</b> یک فاکتور کم‌مبلغ بسازید، لینک را باز کنید و دقیقاً همان مبلغ را از کارت دیگری به کارت خودتان واریز کنید. چند ثانیه بعد وضعیت فاکتور «پرداخت‌شده» می‌شود. اگر نشد، راهنمای «فاکتور در حال انتظار مانده» را بخوانید.</li>
</ol>
<p class="lc-note">پیش از شروع فروش واقعی، حتماً یک پرداخت آزمایشی انجام دهید.</p>`,
  },
  {
    slug: 'cards-same-bank', cat: 'start', min: 4, title: 'کارت‌ها و استراتژی هم‌بانک',
    summary: 'چند کارت ثبت کنیم و چرا داشتن کارت از چند بانک پرداخت را آسان‌تر می‌کند.',
    links: [L('cards', 'کارت‌های من')],
    body: `<p>مشتری وقتی از <b>همان بانک شما</b> پرداخت کند، انتقال معمولاً سریع‌تر و راحت‌تر انجام می‌شود و مشکل سقف و کارمزد کمتری دارد. به همین دلیل بهتر است برای بانک‌های پرمشتری (مثل ملت، ملی، صادرات، سپه…) کارت ثبت کنید.</p>
<ul><li>در صفحهٔ پرداخت، مشتری بانک خودش را انتخاب می‌کند و اگر کارت هم‌بانک داشته باشید همان به او نشان داده می‌شود.</li>
<li>کارت‌ها را می‌توانید موقتاً غیرفعال کنید؛ مثلاً وقتی به سقف روزانهٔ آن کارت رسیده‌اید.</li>
<li>برای هر بانک یک کارت اصلی کافی است؛ کارت‌های بیشتر فقط وقتی لازم است که حجم واریز روزانه زیاد باشد (<a href="#/learn/card-limits">سقف کارت‌به‌کارت</a>).</li>
<li>تعداد کارت‌ها به پلن شما بستگی دارد.</li></ul>`,
  },
  {
    slug: 'unique-amounts', cat: 'start', min: 3, title: 'مبلغ یکتا چیست و چرا باید دقیقاً همان را واریز کرد',
    summary: 'راز تأیید خودکار: هر فاکتور باز یک مبلغ منحصربه‌فرد دارد.',
    links: [L('invoices', 'فاکتورها'), L('deposits', 'واریزی‌های بی‌صاحب')],
    body: `<p>پیامک بانک فقط مبلغ و ساعت را می‌گوید و نام فاکتور را نه. برای اینکه بدانیم یک واریز مال کدام فاکتور است، بولگرام به هر فاکتور باز چند ریال اضافه یا کم می‌کند تا دو فاکتور باز هیچ‌وقت مبلغ یکسان نداشته باشند.</p>
<p>مثال: فاکتور ۲۰۰٬۰۰۰ تومانی ممکن است <b>۲٬۰۰۰٬۰۰۷ ریال</b> نمایش داده شود. مشتری باید همان رقم را واریز کند.</p>
<ul><li>اگر مشتری مبلغ دیگری واریز کند، پیامک با هیچ فاکتوری جور نمی‌شود و به «واریزی‌های بی‌صاحب» می‌رود تا خودتان بررسی کنید.</li>
<li>مبلغ یکتا پس از انقضا یا لغو فاکتور دوباره آزاد می‌شود.</li>
<li>از مشتری بخواهید رقم را کپی کند و دستی تایپ نکند.</li></ul>`,
  },
  {
    slug: 'payment-links', cat: 'sales', min: 4, title: 'لینک پرداخت: فروش در اینستاگرام، تلگرام و بیو',
    summary: 'یک بار لینک بسازید و برای هر مشتری فاکتور خودکار بگیرید.',
    links: [L('links', 'لینک‌های پرداخت')],
    body: `<p>لینک پرداخت یک صفحهٔ آمادهٔ پرداخت با نشانی کوتاه است. هر بار که مشتری آن را باز می‌کند، یک فاکتور تازه با مبلغ یکتا ساخته می‌شود.</p>
<ul><li><b>قیمت ثابت:</b> برای یک محصول یا خدمت مشخص.</li><li><b>مبلغ دلخواه:</b> مشتری خودش مبلغ را می‌نویسد؛ مناسب بیو و هزینهٔ سفارشی.</li><li><b>چند گزینه:</b> مثلاً بسته‌های مختلف یا مبلغ حمایت.</li></ul>
<p>می‌توانید ظرفیت، تاریخ انقضا و اطلاعاتی که از خریدار پرسیده شود (نام، موبایل، نشانی…) را تعیین کنید. نشانی لینک را در بیو، استوری یا پیام‌رسان بگذارید.</p>`,
  },
  {
    slug: 'bots', cat: 'connect', min: 3, title: 'ربات تلگرام و بله',
    summary: 'اعلان پرداخت و ساخت فاکتور از داخل پیام‌رسان.',
    links: [L('bots', 'اتصال ربات')],
    body: `<p>با اتصال ربات، هر پرداخت تأییدشده، واریزی بی‌صاحب و قطع‌شدن دستگاه را فوری در پیام‌رسان می‌بینید و می‌توانید فاکتور بسازید.</p>
<ol><li>به بخش «ربات‌ها» بروید و پیام‌رسان موردنظر را انتخاب کنید.</li><li>کد یک‌بارمصرف را داخل ربات بفرستید یا لینک اتصال را باز کنید.</li><li>پس از اتصال، پیام آزمایشی دریافت می‌کنید.</li></ol>
<p>اتصال هر زمان از همان صفحه قابل قطع است.</p>`,
  },
  {
    slug: 'webhooks-api', cat: 'connect', min: 6, title: 'وب‌هوک، API و ووکامرس',
    summary: 'اتصال بولگرام به سایت یا فروشگاه‌ساز خودتان.',
    links: [L('webhooks', 'وب‌هوک'), L('plugins', 'کلید API و افزونه‌ها')],
    body: `<p>اگر فروشگاه اینترنتی دارید، می‌توانید بدون دخالت دستی سفارش‌ها را با پرداخت تطبیق دهید.</p>
<ul><li><b>API:</b> با کلید API یک فاکتور بسازید و مشتری را به صفحهٔ پرداخت بفرستید. کلید را محرمانه نگه دارید و هرگز در کد سمت مرورگر نگذارید.</li>
<li><b>وب‌هوک:</b> پس از پرداخت، بولگرام نتیجه را به نشانی سرور شما می‌فرستد. درخواست با امضای HMAC (SHA-256) همراه است؛ حتماً امضا را قبل از تأیید سفارش بررسی کنید، و پاسخ موفق (کد ۲۰۰) برگردانید تا ارسال دوباره انجام نشود.</li>
<li><b>ووکامرس:</b> افزونهٔ آماده را از بخش «افزونه‌ها» دانلود و با کلید API راه‌اندازی کنید.</li></ul>
<p class="lc-note">هر درخواست وب‌هوک ممکن است بیش از یک بار برسد؛ پردازش را طوری بنویسید که تکرار آن مشکلی ایجاد نکند.</p>`,
  },
  {
    slug: 'team-roles', cat: 'manage', min: 3, title: 'همکاران و نقش‌ها',
    summary: 'به صندوق‌دار و حسابدار فقط دسترسی لازم را بدهید.',
    links: [L('team', 'همکاران')],
    body: `<p>هر همکار با شمارهٔ موبایل خودش وارد می‌شود و بر اساس نقش، فقط بخش‌های مجاز را می‌بیند.</p>
<ul><li><b>مالک:</b> همهٔ بخش‌ها.</li><li><b>مدیر فروشگاه:</b> همه‌چیز به‌جز همکاران، API، تنظیمات فروشگاه و مدیریت کیف پول.</li><li><b>حسابدار:</b> فاکتورها، گزارش‌ها، واریزی‌های بی‌صاحب و کیف پول.</li><li><b>صندوق‌دار:</b> ساخت و دیدن فاکتور.</li><li><b>فقط مشاهده:</b> دیدن فاکتورها و گزارش‌ها.</li></ul>
<p>هر کاری مهم همکاران در گزارش فعالیت ثبت می‌شود. همکار جدا شده، فوراً از حساب خارج می‌شود.</p>`,
  },
  {
    slug: 'wallet-fees', cat: 'manage', min: 3, title: 'کیف پول، پلن و هزینه‌ها',
    summary: 'چطور هزینهٔ سرویس محاسبه می‌شود و موجودی را مدیریت کنیم.',
    links: [L('wallet', 'کیف پول'), L('plans', 'پلن‌ها')],
    body: `<p>پول مشتریان همیشه مستقیم به کارت شما می‌رود و وارد کیف پول بولگرام نمی‌شود. کیف پول فقط برای پرداخت هزینهٔ استفاده از سرویس است.</p>
<ul><li>مبلغ دقیق پلن‌ها و کارمزدها را در صفحهٔ «پلن‌ها» و «کیف پول» ببینید؛ همان اعداد معتبر است.</li>
<li>اگر موجودی کم شود اعلان می‌گیرید. با تمام شدن موجودی ممکن است ساخت فاکتور جدید متوقف شود، پس زودتر شارژ کنید.</li>
<li>هر شارژ و هر کسر در تاریخچهٔ کیف پول ثبت است و می‌توانید گزارش بگیرید.</li></ul>`,
  },
  {
    slug: 'trust-badge', cat: 'manage', min: 3, title: 'نماد اعتماد بولگرام',
    summary: 'با تأیید هویت، به مشتری نشان دهید فروشگاه شما واقعی است.',
    links: [L('trust', 'درخواست نماد اعتماد'), L('review', 'نظر من')],
    body: `<p>پس از ارسال مدارک و تأیید بولگرام، نمادی دریافت می‌کنید که روی سایت یا صفحهٔ اینستاگرام می‌گذارید. با کلیک روی آن، مشتری صفحهٔ تأیید را می‌بیند: نام فروشگاه، تاریخ تأیید و راه‌های ارتباطی.</p>
<ul><li>برای شخص حقیقی: کد ملی و تصویر کارت ملی. برای شرکت: شناسه ملی و روزنامهٔ رسمی یا جواز کسب.</li><li>مدارک فقط برای بررسی هویت استفاده می‌شود و عمومی نیست.</li><li>در صورت رد شدن، دلیل نمایش داده می‌شود و می‌توانید اصلاح و دوباره ارسال کنید.</li></ul>`,
  },
  {
    slug: 'fake-sms', cat: 'security', min: 5, title: 'پیامک جعلی و کلاهبرداری',
    summary: 'چطور فریب رسید و پیامک ساختگی را نخوریم.',
    links: [L('deposits', 'واریزی‌های بی‌صاحب'), L('devices', 'دستگاه‌ها')],
    body: `<p>کلاهبردار ممکن است عکس رسید یا پیامک ساختگی نشان دهد و بگوید «پول واریز شد». <b>رسید و اسکرین‌شات هیچ‌وقت مدرک واریز نیست.</b></p>
<ul><li>بولگرام فقط پیامک‌هایی را می‌پذیرد که از <b>شمارهٔ رسمی بانک</b> روی گوشی شما آمده باشد؛ پیامک ساختگی از شمارهٔ عادی رد می‌شود.</li>
<li>هر واریز مشکوک در «واریزی‌های بی‌صاحب» با برچسب مشکوک می‌ماند، نه تأیید خودکار.</li>
<li>برای مبلغ‌های بزرگ، قبل از تحویل کالا موجودی را در <b>برنامهٔ بانک خودتان</b> ببینید.</li>
<li>هرگز کد پیامکی (رمز دوم، کد ورود) خود را به کسی ندهید؛ بولگرام هیچ‌وقت آن را نمی‌خواهد.</li>
<li>برنامهٔ اندروید را فقط از صفحهٔ رسمی بولگرام نصب کنید.</li></ul>`,
  },
  {
    slug: 'held-deposits', cat: 'security', min: 3, title: 'واریزی بی‌صاحب را کِی تأیید کنیم؟',
    summary: 'قاعدهٔ طلایی: اول موجودی بانک، بعد تأیید.',
    links: [L('deposits', 'واریزی‌های بی‌صاحب')],
    body: `<p>گاهی واریزی می‌رسد که به هیچ فاکتوری نمی‌خورد: مبلغ اشتباه، واریز دو بار یا پیامک مشکوک. این‌ها در «واریزی‌های بی‌صاحب» نگه داشته می‌شود.</p>
<p class="lc-note"><b>هرگز واریزی نگه‌داشته‌شده را تأیید نکنید مگر اینکه خودتان آن را در برنامهٔ بانک ببینید.</b> تأیید یعنی فاکتور پرداخت‌شده می‌شود و کالا یا خدمت تحویل داده می‌شود.</p>
<ol><li>برنامهٔ بانک را باز کنید و تراکنش را با همان مبلغ و ساعت پیدا کنید.</li><li>اگر هست، فاکتور مناسب را انتخاب و تأیید کنید.</li><li>اگر نیست یا مطمئن نیستید، رد کنید.</li></ol>`,
  },
  {
    slug: 'card-limits', cat: 'security', min: 3, title: 'سقف کارت‌به‌کارت روزانه',
    summary: 'سقف تراکنش مشتری چقدر است و برای مبلغ بالا چه کنیم.',
    links: [L('cards', 'کارت‌ها'), L('links', 'لینک‌های پرداخت')],
    body: `<p class="lc-note">آخرین بررسی: مهر ۱۴۰۵. بر پایهٔ گزارش‌های رسانه‌ای دربارهٔ سقف تراکنش‌های بانکی ۱۴۰۵ (مثل <a href="https://fararu.com/fa/news/978296/%D8%B3%D9%82%D9%81-%D8%AA%D8%B1%D8%A7%DA%A9%D9%86%D8%B4-%D8%A8%D8%A7%D9%86%DA%A9%DB%8C-1405" target="_blank" rel="noopener">فرارو</a> و <a href="https://banker.ir/%D8%B3%D9%82%D9%81-%D8%AA%D8%B1%D8%A7%DA%A9%D9%86%D8%B4%D9%87%D8%A7%DB%8C-%D8%A8%D8%A7%D9%86%DA%A9%DB%8C-%D8%AF%D8%B1-%D8%B3%D8%A7%D9%84-%DB%B1%DB%B4%DB%B0%DB%B5-%DA%86%D9%82%D8%AF%D8%B1/" target="_blank" rel="noopener">بانکر</a>)، سقف کارت‌به‌کارت در شبکهٔ شتاب <b>۱۵ میلیون تومان در هر ۲۴ ساعت برای هر کارت مبدأ</b> است (پیش‌تر ۱۰ میلیون تومان بود).</p>
<ul><li>این سقف قانون بانکی است نه محدودیت بولگرام و ممکن است تغییر کند یا بسته به بانک و روش (برنامه، اینترنت‌بانک، خودپرداز) فرق داشته باشد؛ عدد دقیق را از بانک خود بپرسید.</li>
<li>اگر فاکتور شما بیشتر از سقف مشتری است، از او بخواهید در چند نوبت یا از چند کارت پرداخت کند و برای هر بخش جدا فاکتور بسازید.</li>
<li>هم‌بانک بودن گاهی سقف و شرایط بهتری دارد (<a href="#/learn/cards-same-bank">استراتژی هم‌بانک</a>).</li>
<li>سقف دریافت روزانهٔ کارت شما را هم از بانک بپرسید و در صورت نیاز کارت دوم فعال کنید.</li></ul>`,
  },
  {
    slug: 'device-offline', cat: 'help', min: 4, title: 'دستگاه آفلاین شده است',
    summary: 'چند بررسی ساده وقتی گوشی «آفلاین» نشان داده می‌شود.',
    links: [L('devices', 'دستگاه‌ها'), L('support', 'پشتیبانی')],
    body: `<p>اگر گوشی چند دقیقه به بولگرام سیگنال نفرستد «آفلاین» نمایش داده می‌شود و پرداخت‌ها تأیید خودکار نمی‌شوند.</p>
<ol><li>اینترنت گوشی (وای‌فای یا داده) را بررسی کنید.</li><li>برنامه را باز کنید؛ باید وضعیت «متصل» را ببینید.</li><li>در تنظیمات اندروید، برای برنامه «بدون محدودیت باتری» و اجازهٔ اجرا در پس‌زمینه را فعال کنید (در برخی گوشی‌ها شیائومی، سامسونگ و هوآوی باید برنامه را در لیست «قفل‌شده» یا «خودکار شروع شود» بگذارید).</li><li>گوشی را به شارژ وصل نگه دارید و حالت صرفه‌جویی باتری را خاموش کنید.</li><li>اگر هنوز آفلاین است، برنامه را ببندید و دوباره باز کنید؛ در آخر دستگاه را حذف و دوباره جفت کنید.</li></ol>
<p>پیامک‌هایی که در زمان آفلاین بودن آمده، بعد از اتصال دوباره پردازش می‌شود.</p>`,
  },
  {
    slug: 'sms-not-detected', cat: 'help', min: 4, title: 'پیامک بانک شناسایی نمی‌شود',
    summary: 'پیامک روی گوشی هست اما در بولگرام ثبت نشده.',
    links: [L('devices', 'دستگاه‌ها'), L('deposits', 'واریزی‌های بی‌صاحب')],
    body: `<ol><li>مطمئن شوید پیامک واقعاً از <b>شمارهٔ سرویس بانک</b> است (نه شمارهٔ عادی).</li>
<li>دسترسی «پیامک» برنامه را در تنظیمات اندروید بررسی کنید.</li>
<li>سیم‌کارتی که بانک پیامک را به آن می‌فرستد باید در همان گوشی باشد. برخی بانک‌ها باید برای سیم‌کارت جدید دوباره فعال‌سازی پیامک شوند.</li>
<li>اگر پیامک در برنامهٔ دیگری مثل پیام‌رسان یا «اعلان‌های هوشمند» می‌رود، آن را به برنامهٔ پیام‌های پیش‌فرض برگردانید.</li>
<li>قالب پیامک بعضی بانک‌ها گاهی تغییر می‌کند؛ اگر پیامک درست رسیده ولی شناخته نمی‌شود، متن پیامک را (بدون اطلاعات حساس) در تیکت برای ما بفرستید.</li></ol>`,
  },
  {
    slug: 'invoice-pending', cat: 'help', min: 4, title: 'فاکتور در حالت «در انتظار» مانده است',
    summary: 'مشتری گفته پرداخت کرده ولی فاکتور هنوز پرداخت‌شده نیست.',
    links: [L('invoices', 'فاکتورها'), L('deposits', 'واریزی‌های بی‌صاحب'), L('devices', 'دستگاه‌ها')],
    body: `<ol><li><b>در برنامهٔ بانک ببینید</b> پول واقعاً آمده یا نه. اگر نیامده، پرداخت انجام نشده است.</li>
<li>مبلغ را با فاکتور مقایسه کنید: اگر مشتری رقم متفاوتی واریز کرده، واریز در «واریزی‌های بی‌صاحب» است؛ فاکتور درست را انتخاب و تأیید کنید.</li>
<li>وضعیت دستگاه را ببینید؛ اگر آفلاین بوده است (<a href="#/learn/device-offline">راهنما</a>) پس از آنلاین شدن پردازش می‌شود.</li>
<li>فاکتور اگر منقضی شده باشد هم ممکن است واریز دیرهنگام به «بی‌صاحب» برود.</li>
<li>اگر پیامک بانک آمده ولی ثبت نشده، <a href="#/learn/sms-not-detected">پیامک شناسایی نمی‌شود</a> را ببینید.</li></ol>`,
  },
];

const KEY = 'bg_learn_done';
const readDone = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
const writeDone = (s) => { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* storage unavailable */ } };
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const norm = (s) => fixArabic(String(s)).toLowerCase().replace(/[‌\s]+/g, ' ');
const INDEX = ARTICLES.map((a) => ({ a, hay: norm(`${a.title} ${a.summary} ${plain(a.body)} ${CAT_NAME[a.cat]}`) }));
const PAGE_NAMES = { cards: 'کارت‌ها', app: 'برنامهٔ اندروید', devices: 'دستگاه‌ها', invoices: 'فاکتورها', deposits: 'واریزی‌های بی‌صاحب', links: 'لینک‌های پرداخت', bots: 'ربات‌ها', webhooks: 'وب‌هوک', plugins: 'افزونه‌ها', team: 'همکاران', wallet: 'کیف پول', plans: 'پلن‌ها', trust: 'نماد اعتماد', review: 'نظر من', support: 'پشتیبانی' };

const CSS = `
.lc-tools{display:grid;gap:12px;margin-bottom:16px}
.lc-search{position:relative;max-width:520px}
.lc-search svg{position:absolute;inset-inline-start:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.lc-search input{padding-inline-start:40px;width:100%}
.lc-cats{display:flex;gap:8px;flex-wrap:wrap}
.lc-cats button{border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:99px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:.88rem}
.lc-cats button[aria-pressed="true"]{background:var(--brand-soft);color:var(--brand);border-color:var(--brand)}
.lc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:14px}
.lc-card{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid var(--border);border-radius:16px;background:var(--surface);text-decoration:none;color:var(--fg)}
.lc-card:hover{border-color:var(--brand)}.lc-card:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.lc-card h3{margin:0;font-size:1rem;display:flex;gap:8px;align-items:flex-start}
.lc-card p{margin:0;color:var(--muted);font-size:.86rem;line-height:1.8}
.lc-meta{display:flex;gap:8px;align-items:center;font-size:.78rem;color:var(--muted);margin-top:auto}
.lc-tick{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--border);font-size:.8rem;color:transparent}
.lc-tick.on{background:var(--green);border-color:var(--green);color:#04130a}
.lc-prog{display:flex;gap:12px;align-items:center;margin-bottom:16px;max-width:520px}.lc-prog .progress{flex:1}
.lc-art{max-width:780px}
.lc-body{line-height:2;font-size:.97rem}
.lc-body ol,.lc-body ul{padding-inline-start:22px}.lc-body li{margin-bottom:6px}
.lc-body a{color:var(--brand)}
.lc-note{padding:10px 14px;border-radius:12px;background:var(--amber-soft);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent)}
.lc-rel{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.lc-pn{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:18px}
`;

export async function render(page, { sub }) {
  useStyle('learn', CSS);
  const slug = sub?.[0];
  const art = slug && ARTICLES.find((a) => a.slug === slug);
  if (art) return renderArticle(page, art);
  return renderList(page, slug);
}

function renderList(page, missingSlug) {
  const done = readDone();
  let cat = '';
  let q = '';
  page.innerHTML = `<div class="page-head"><h1>مرکز آموزش</h1></div>
    ${missingSlug ? `<div class="alert alert-warn" style="margin-bottom:12px">راهنمای «${esc(missingSlug)}» پیدا نشد؛ از فهرست زیر انتخاب کنید.</div>` : ''}
    <div class="lc-prog"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${ARTICLES.length}" aria-valuenow="${done.size}" aria-label="پیشرفت یادگیری"><i style="width:${(done.size / ARTICLES.length) * 100}%"></i></div><span class="muted" id="lc-prog-t">${toFa(done.size)} از ${toFa(ARTICLES.length)} راهنما خوانده شد</span></div>
    <div class="lc-tools"><div class="lc-search"><label class="sr-only" for="lc-q">جستجو در راهنماها</label>${ICON.search}<input id="lc-q" class="input" type="search" placeholder="جستجو: مثلاً «آفلاین» یا «وب‌هوک»" autocomplete="off"></div>
    <div class="lc-cats" role="group" aria-label="دسته‌بندی"><button type="button" data-c="" aria-pressed="true">همه</button>${CATS.map(([k, t]) => `<button type="button" data-c="${k}" aria-pressed="false">${t}</button>`).join('')}</div></div>
    <div id="lc-list" aria-live="polite"></div>`;
  const list = $('#lc-list', page);
  const draw = () => {
    const terms = norm(q).split(' ').filter(Boolean);
    const rows = INDEX.filter((x) => (!cat || x.a.cat === cat) && terms.every((t) => x.hay.includes(t))).map((x) => x.a);
    if (!rows.length) { list.innerHTML = emptyState('search', 'راهنمایی پیدا نشد', 'عبارت دیگری را جستجو کنید یا از بخش پشتیبانی بپرسید.', '<a class="btn btn-primary" href="#/support">پرسش از پشتیبانی</a>'); return; }
    list.innerHTML = `<div class="lc-grid">${rows.map((a) => `<a class="lc-card" href="#/learn/${a.slug}"><h3><span class="lc-tick ${done.has(a.slug) ? 'on' : ''}" ${done.has(a.slug) ? 'role="img" aria-label="خوانده شده"' : 'aria-hidden="true"'}>✓</span>${esc(a.title)}</h3><p>${esc(a.summary)}</p><div class="lc-meta"><span class="pill">${CAT_NAME[a.cat]}</span><span>${toFa(a.min)} دقیقه</span></div></a>`).join('')}</div>`;
  };
  $('#lc-q', page).addEventListener('input', debounce((e) => { q = e.target.value; draw(); }, 120));
  $$('[data-c]', page).forEach((b) => b.addEventListener('click', () => { cat = b.dataset.c; $$('[data-c]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  draw();
}

function renderArticle(page, a) {
  const done = readDone();
  const i = ARTICLES.indexOf(a);
  const prev = ARTICLES[i - 1], next = ARTICLES[i + 1];
  document.title = `${a.title} | بولگرام`;
  page.innerHTML = `<div class="page-head"><h1>${esc(a.title)}</h1><div class="actions"><a class="btn btn-ghost" href="#/learn">همهٔ راهنماها</a></div></div>
    <article class="card lc-art"><div class="lc-meta" style="margin:0 0 12px"><span class="pill">${CAT_NAME[a.cat]}</span><span>${toFa(a.min)} دقیقه مطالعه</span></div>
      <div class="lc-body">${a.body}</div>
      ${a.links?.length ? `<div class="lc-rel"><span class="muted">صفحه‌های مرتبط:</span>${a.links.map(([id, t]) => `<a class="btn btn-sm" href="#/${id}">${esc(t || PAGE_NAMES[id])}</a>`).join('')}</div>` : ''}
      <label class="check" style="margin-top:18px"><input type="checkbox" id="lc-done" ${done.has(a.slug) ? 'checked' : ''}> این راهنما را خواندم</label>
      <div class="lc-pn">${prev ? `<a class="btn" href="#/learn/${prev.slug}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn btn-primary" href="#/learn/${next.slug}">${esc(next.title)} →</a>` : ''}</div></article>`;
  $('#lc-done', page).addEventListener('change', (e) => { const s = readDone(); if (e.target.checked) s.add(a.slug); else s.delete(a.slug); writeDone(s); });
}
