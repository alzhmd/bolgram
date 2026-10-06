// Panel entry: hash router with auth + role guard, lazy pages, error boundary, 404 and forbidden pages.
import { api, session, esc, emptyState, $, CTX } from './core.js';
import { renderLogin, renderRegister, renderForgot, renderVerify } from './auth.js';
import { renderShell, setActiveNav, setTheme, PAGE_TITLES, allowed } from './shell.js';

const root = $('#app');
setTheme(localStorage.getItem('bg_theme') || 'dark');

const PUBLIC = { login: renderLogin, register: renderRegister, forgot: renderForgot };
const PUBLIC_TITLES = { login: 'ورود', register: 'ساخت حساب', forgot: 'فراموشی رمز', verify: 'تأیید شماره', invite: 'پیوستن به فروشگاه' };

// Every page module exports render(page, { me, actor, query, go }).
const pick = (name) => (m) => m[name] || m.render;
const PAGES = {
  dashboard: () => import('./pages/dashboard.js').then(pick('renderDashboard')),
  invoices: () => import('./pages/invoices.js').then(pick('render')),
  deposits: () => import('./pages/deposits.js').then(pick('render')),
  reports: () => import('./pages/reports.js').then(pick('render')),
  links: () => import('./pages/links.js').then(pick('render')),
  wallet: () => import('./pages/wallet.js').then(pick('render')),
  cards: () => import('./pages/cards.js').then(pick('renderCards')),
  plans: () => import('./pages/plans.js').then(pick('render')),
  devices: () => import('./pages/devices.js').then(pick('render')),
  app: () => import('./pages/app-page.js').then(pick('render')),
  bots: () => import('./pages/bots.js').then(pick('renderBots')),
  plugins: () => import('./pages/plugins.js').then(pick('render')),
  webhooks: () => import('./pages/webhooks.js').then(pick('render')),
  trust: () => import('./pages/trust.js').then(pick('render')),
  team: () => import('./pages/team.js').then(pick('render')),
  referral: () => import('./pages/referral.js').then(pick('render')),
  support: () => import('./pages/support.js').then(pick('render')),
  learn: () => import('./pages/learn.js').then(pick('render')),
  review: () => import('./pages/review.js').then(pick('render')),
  notifications: () => import('./pages/notifications.js').then(pick('render')),
  settings: () => import('./pages/settings.js').then(pick('render')),
};

let me = null;
let shellReady = false;

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  return { id: path.replace(/^\/+/, '').split('/')[0] || 'dashboard', sub: path.replace(/^\/+/, '').split('/').slice(1), path, query: new URLSearchParams(qs || '') };
}
const go = (path) => { location.hash = '#' + path; };

window.addEventListener('session-expired', () => {
  me = null; shellReady = false;
  const { path } = parse();
  go(`/login?expired=1&next=${encodeURIComponent(path)}`);
});

async function route() {
  const { id, sub, path, query } = parse();
  window.scrollTo(0, 0);
  if (PUBLIC[id] || id === 'verify' || id === 'invite') {
    if (session.get() && PUBLIC[id]) return go('/dashboard');
    shellReady = false;
    document.title = `${PUBLIC_TITLES[id]} | بولگرام`;
    if (id === 'invite') return (await import('./pages/invite.js')).render(root, { go, query });
    return (id === 'verify' ? renderVerify : PUBLIC[id])(root, { go, query });
  }
  if (!session.get()) return go(`/login?next=${encodeURIComponent(path)}`);
  try {
    if (!me) {
      const r = await api('/api/v2/me');
      me = r.merchant;
      Object.assign(CTX, { me: r.merchant, actor: r.actor, roles: r.roles || {}, permNames: r.perm_names || {} });
    }
  } catch (e) {
    if (e.status === 401) return;
    root.innerHTML = `<main class="auth"><div class="auth-card">${emptyState('alert', 'اتصال به سرور ممکن نشد', esc(e.message), '<button class="btn btn-primary" onclick="location.reload()">تلاش دوباره</button>')}</div></main>`;
    return;
  }
  if (!shellReady) {
    renderShell(root, me);
    shellReady = true;
    import('./pages/notifications.js').then((m) => m.initBell?.()).catch(() => {});
  }
  setActiveNav(id);
  const page = $('#page');
  const title = PAGE_TITLES[id];
  document.title = `${title || 'صفحه پیدا نشد'} | بولگرام`;
  try {
    if (PAGES[id] && !allowed(id)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (PAGES[id]) {
      page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
      const render = await PAGES[id]();
      await render(page, { me, actor: CTX.actor, query, sub, go });
    } else if (id === 'forbidden') page.innerHTML = `<section class="card">${emptyState('lock', 'دسترسی ندارید', 'نقش شما اجازهٔ دیدن این بخش را نمی‌دهد. از مالک فروشگاه بخواهید دسترسی بدهد.', '<a class="btn" href="#/dashboard">داشبورد</a>')}</section>`;
    else page.innerHTML = `<section class="card">${emptyState('search', 'صفحه پیدا نشد', 'آدرسی که باز کردید وجود ندارد.', '<a class="btn btn-primary" href="#/dashboard">بازگشت به داشبورد</a>')}</section>`;
  } catch (e) {
    if (e.status === 401) return;
    if (e.status === 403) return id === 'forbidden' ? null : go('/forbidden');
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
