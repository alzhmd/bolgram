// Panel entry: hash router with auth guard, error boundary, 404 and forbidden pages.
import { api, session, esc, emptyState, $ } from './core.js';
import { renderLogin, renderRegister, renderForgot, renderVerify } from './auth.js';
import { renderShell, setActiveNav, setTheme, PAGE_TITLES } from './shell.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCards } from './pages/cards.js';

const root = $('#app');
setTheme(localStorage.getItem('bg_theme') || 'dark');

const PUBLIC = { login: renderLogin, register: renderRegister, forgot: renderForgot };
const PAGES = { dashboard: renderDashboard, cards: renderCards };
const SOON = {
  invoices: 'لیست فاکتورها با فیلتر کانال و وضعیت، جستجو، خروجی اکسل و جزئیات هر فاکتور.',
  reports: 'گزارش فروش بر اساس روز، ساعت، کارت و کانال با انتخاب بازهٔ شمسی.',
  links: 'لینک پرداخت چندبار مصرف با مبلغ ثابت یا آزاد، QR و آمار؛ و لینک ارزی.',
  wallet: 'موجودی کیف پول کارمزد، شارژ با هدیه، گردش حساب و درخواست برداشت.',
  plans: 'پلن‌های شخصی و مارکت‌پلیس، خرید و تمدید اشتراک.',
  devices: 'گوشی‌های متصل، آخرین پیامک، وضعیت اتصال و بانک‌هایی که سیستم می‌خواند.',
  app: 'دانلود اپ اندروید با اثر انگشت SHA-256 و راهنمای شورتکات آیفون.',
  bots: 'اتصال حساب به ربات تلگرام و بله با کد یک‌بارمصرف.',
  plugins: 'افزونهٔ ووکامرس و اتصال مستقیم API.',
  webhooks: 'گزارش ارسال وب‌هوک‌ها با کد پاسخ و ارسال مجدد.',
  trust: 'درخواست نماد اعتماد با احراز هویت.',
  team: 'دعوت همکار و صندوق‌دار و دفتر رویدادها.',
  referral: 'لینک دعوت اختصاصی و پاداش اشتراک.',
  support: 'ثبت و پیگیری تیکت پشتیبانی.',
  learn: 'آموزش‌ها از صفر تا اولین پرداخت.',
  review: 'ثبت نظر و امتیاز شما دربارهٔ سرویس.',
  notifications: 'مرکز اعلان‌ها با دسته‌بندی و فیلتر.',
  settings: 'پروفایل، لوگو، وب‌هوک، کلید API و امنیت حساب.',
};

let me = null;
let shellReady = false;

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  return { id: path.replace(/^\/+/, '').split('/')[0] || 'dashboard', path, query: new URLSearchParams(qs || '') };
}
const go = (path) => { location.hash = '#' + path; };

window.addEventListener('session-expired', () => {
  me = null; shellReady = false;
  const { path } = parse();
  go(`/login?expired=1&next=${encodeURIComponent(path)}`);
});

async function route() {
  const { id, path, query } = parse();
  window.scrollTo(0, 0);
  if (PUBLIC[id] || id === 'verify') {
    if (session.get() && id !== 'verify') return go('/dashboard');
    shellReady = false;
    document.title = `${{ login: 'ورود', register: 'ساخت حساب', forgot: 'فراموشی رمز', verify: 'تأیید شماره' }[id]} | بولگرام`;
    return (id === 'verify' ? renderVerify : PUBLIC[id])(root, { go, query });
  }
  if (!session.get()) return go(`/login?next=${encodeURIComponent(path)}`);
  try {
    if (!me) me = (await api('/api/v2/me')).merchant;
  } catch (e) {
    if (e.status === 401) return;
    root.innerHTML = `<main class="auth"><div class="auth-card">${emptyState('alert', 'اتصال به سرور ممکن نشد', esc(e.message), '<button class="btn btn-primary" onclick="location.reload()">تلاش دوباره</button>')}</div></main>`;
    return;
  }
  if (!shellReady) { renderShell(root, me); shellReady = true; }
  setActiveNav(id);
  const page = $('#page');
  const title = PAGE_TITLES[id];
  document.title = `${title || 'صفحه پیدا نشد'} | بولگرام`;
  try {
    if (PAGES[id]) await PAGES[id](page, { me, query, go });
    else if (SOON[id]) page.innerHTML = `<div class="page-head"><h1>${title}</h1></div><section class="card">${emptyState('bolt', 'این بخش در مرحلهٔ بعد ساخته می‌شود', SOON[id], '<a class="btn btn-primary" href="#/dashboard">بازگشت به داشبورد</a>')}</section>`;
    else if (id === 'forbidden') page.innerHTML = `<section class="card">${emptyState('lock', 'دسترسی ندارید', 'نقش شما اجازهٔ دیدن این بخش را نمی‌دهد. از مالک فروشگاه بخواهید دسترسی بدهد.', '<a class="btn" href="#/dashboard">داشبورد</a>')}</section>`;
    else page.innerHTML = `<section class="card">${emptyState('search', 'صفحه پیدا نشد', 'آدرسی که باز کردید وجود ندارد.', '<a class="btn btn-primary" href="#/dashboard">بازگشت به داشبورد</a>')}</section>`;
  } catch (e) {
    if (e.status === 401) return;
    if (e.status === 403) return go('/forbidden');
    // Error boundary: one broken page never takes down the panel.
    console.error(e);
    page.innerHTML = `<section class="card">${emptyState('alert', 'نمایش این صفحه با خطا روبه‌رو شد', esc(e.message || ''), '<button class="btn btn-primary" type="button" id="retry">تلاش دوباره</button>')}</section>`;
    $('#retry', page)?.addEventListener('click', route);
  }
  page.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
window.addEventListener('data-changed', () => { if (parse().id === 'dashboard') route(); });
route();
