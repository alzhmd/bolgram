/*
 * Site configuration — the ONLY place for brand, links, plans and the pricing model.
 * Change values here (or let the admin panel write assets/content/content.json for texts).
 * All prices are SAMPLE values until confirmed (shown with a «نمونه» label on the site).
 */
window.SITE = {
  BRAND: 'بلگرام',
  BRAND_EN: 'Bolgram',
  DOMAIN: 'bolgram.ir',
  API_BASE: 'https://api.bolgram.ir',          // used in code samples
  APP_URL: 'https://app.bolgram.ir',            // merchant panel (login/signup live there)
  LOGIN_URL: 'https://app.bolgram.ir/login.html',
  SIGNUP_URL: 'https://app.bolgram.ir/login.html#register',
  STATUS_URL: 'https://app.bolgram.ir/health',   // TODO: real status page
  SUPPORT_TELEGRAM: 'https://t.me/bolgram_support',
  SUPPORT_EMAIL: 'support@bolgram.ir',
  TRIAL_DAYS: 7,
  APP_LINKS: { play: '', bazaar: '', myket: '', ios: '/docs.html#ios' }, // empty = «به‌زودی»

  // Billing periods for the pricing switch; discount in percent.
  PERIODS: [
    { key: '1', label: 'ماهانه', months: 1, discount: 0 },
    { key: '3', label: '۳ ماهه', months: 3, discount: 10 },
    { key: '6', label: '۶ ماهه', months: 6, discount: 20 },
  ],

  // Monthly price in Toman. `tx` = included successful payments per month (Infinity = unlimited).
  PLANS: {
    personal: [
      { id: 'start', name: 'شروع', price: 149000, tx: 300, cards: 1, devices: 1, features: ['تأیید خودکار از پیامک', 'لینک پرداخت', 'اعلان بله و تلگرام'] },
      { id: 'pro', name: 'حرفه‌ای', price: 390000, tx: 1500, cards: 5, devices: 3, featured: true, features: ['همه امکانات شروع', 'API و وب‌هوک', 'صف بررسی واریز مشکوک', 'شخصی‌سازی صفحه پرداخت'] },
      { id: 'biz', name: 'تجاری', price: 890000, tx: 6000, cards: 20, devices: 10, features: ['همه امکانات حرفه‌ای', 'چند فروشگاه', 'پشتیبانی اولویت‌دار'] },
    ],
    marketplace: [
      { id: 'mk-start', name: 'مارکت کوچک', price: 990000, tx: 5000, cards: 30, devices: 15, features: ['تا ۱۰ فروشنده', 'تسویه مستقیم به کارت هر فروشنده', 'گزارش جدا برای هر فروشنده'] },
      { id: 'mk-pro', name: 'مارکت حرفه‌ای', price: 2490000, tx: 20000, cards: 120, devices: 60, featured: true, features: ['تا ۵۰ فروشنده', 'API چندفروشنده', 'نقش‌ها و دسترسی تیم'] },
    ],
  },

  /*
   * Pricing model used by the cost calculator. Switch `model` without touching code:
   *  - 'subscription': cheapest plan that fits + `overagePerTx` Toman for each extra payment
   *  - 'tiered':       percentage of volume by monthly volume tier (Toman), with min/max per payment
   *  - 'credit':       pay per successful payment from prepaid credit
   */
  FEE_TIERS: {
    model: 'subscription',
    overagePerTx: 400,
    tiered: [
      { upTo: 100000000, percent: 0.6 },
      { upTo: 500000000, percent: 0.45 },
      { upTo: Infinity, percent: 0.3 },
    ],
    tieredMinPerTx: 300,
    tieredMaxPerTx: 15000,
    creditPerTx: 350,
  },
};
