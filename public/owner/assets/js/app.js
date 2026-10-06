// Owner panel entry: login, shell (sidebar + mobile drawer), hash router with an error boundary.
import { CONFIG, ICON, esc, emptyState, jDate, jTime, setBusy, toFa, useStyle, $, $$ } from '/panel/assets/js/core.js';
import { session, closeSheets } from './ui.js';

const root = $('#app');

const NAV = [
  { group: 'نمای کلی', items: [['dashboard', 'داشبورد', 'home']] },
  { group: 'فروشگاه‌ها و مالی', items: [['stores', 'فروشگاه‌ها', 'users'], ['wallets', 'کیف پول‌ها و شارژها', 'wallet'], ['plans', 'پلن‌ها', 'crown'], ['billing', 'تنظیمات مالی', 'cog']] },
  { group: 'پشتیبانی و اعتماد', items: [['tickets', 'تیکت‌ها', 'help'], ['trust', 'نماد اعتماد', 'shield'], ['reviews', 'نظرها', 'star'], ['broadcast', 'اعلان همگانی', 'bell']] },
  { group: 'فنی', items: [['webhooks', 'وب‌هوک‌های ناموفق', 'hook'], ['smslab', 'آزمایشگاه پیامک', 'phone'], ['health', 'سلامت سیستم', 'bolt'], ['audit', 'گزارش فعالیت', 'receipt']] },
  { group: 'سایت', items: [['site', 'محتوای سایت', 'book']] },
];
const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items.map(([id, t]) => [id, t])));
const pick = (file) => () => import(`./pages/${file}.js`).then((m) => m.render);
const PAGES = Object.fromEntries(
  ['dashboard', 'stores', 'wallets', 'plans', 'billing', 'tickets', 'trust', 'reviews', 'broadcast', 'webhooks', 'smslab', 'health', 'audit', 'site'].map((id) => [id, pick(id)]),
);

useStyle('owner-shell', `
.o-who{display:grid;gap:2px;padding:4px 6px;font-size:.84rem;overflow-wrap:anywhere}
.o-badge{font-size:.7rem;background:var(--amber-soft);color:var(--amber);border-radius:99px;padding:0 8px;margin-inline-start:8px}
.o-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.overlay{z-index:80}.toasts{z-index:90}
.o-link{color:inherit;text-decoration:none}
.o-link:hover{color:var(--brand)}
.table td.nowrap,.table th.nowrap{white-space:nowrap}
.o-trunc{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}
@media (max-width:640px){.o-trunc{max-width:60vw}}
`);

// ---------- theme
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bg_theme', t); } catch { /* storage blocked */ }
  $$('[data-theme-toggle]').forEach((b) => { b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon; });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); });
setTheme(document.documentElement.dataset.theme || 'dark');

// ---------- login
function renderLogin(next) {
  document.title = 'ورود مدیر | بولگرام';
  root.innerHTML = `<main class="auth"><div style="width:min(460px,100%)">
    <div class="auth-top"><a class="logo" href="/"><img src="/favicon.svg" alt="" width="32" height="32"><span>${CONFIG.SERVICE_NAME}</span></a><button class="icon-btn" type="button" data-theme-toggle aria-label="تغییر تم"></button></div>
    <form class="auth-card" id="login" novalidate>
      <h1>ورود به پنل مدیریت</h1><p class="lead">این بخش مخصوص مالک پلتفرم است.</p>
      <div class="alert alert-err hidden" id="login-err" role="alert" style="margin-bottom:14px"></div>
      <div class="field"><label for="o-email">ایمیل</label><input class="input ltr" id="o-email" name="email" type="email" autocomplete="username" inputmode="email" required></div>
      <div class="field"><label for="o-pass">رمز عبور</label><div class="input-wrap"><input class="input ltr" id="o-pass" name="password" type="password" autocomplete="current-password" required><button class="eye" type="button" aria-label="نمایش رمز" id="o-eye">${ICON.eye}</button></div></div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" id="o-remember"><span>مرا در این دستگاه نگه دار</span></label>
      <button class="btn btn-primary btn-block" type="submit" id="o-go">ورود</button>
    </form></div></main>`;
  setTheme(document.documentElement.dataset.theme || 'dark');
  const form = $('#login'), err = $('#login-err'), btn = $('#o-go');
  let timer = null;
  const show = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); };
  $('#o-eye').addEventListener('click', () => { const i = $('#o-pass'); i.type = i.type === 'password' ? 'text' : 'password'; });
  const lock = (sec) => {
    clearInterval(timer);
    let left = sec;
    btn.disabled = true;
    const tick = () => {
      if (left <= 0) { clearInterval(timer); btn.disabled = false; show(''); return; }
      show(`به‌دلیل چند تلاش ناموفق، ورود موقتاً قفل شد. ${toFa(left)} ثانیهٔ دیگر دوباره تلاش کنید.`);
      left--;
    };
    tick(); timer = setInterval(tick, 1000);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#o-email').value.trim(), password = $('#o-pass').value;
    if (!email || !password) return show('ایمیل و رمز عبور را وارد کنید');
    show('');
    setBusy(btn, true, 'در حال ورود…');
    try {
      const res = await fetch('/api/owner/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        session.set(data.token, $('#o-remember').checked);
        const target = next || '#/dashboard';
        if (location.hash === target) route(); else location.hash = target;
        return;
      }
      setBusy(btn, false);
      if (res.status === 429) return lock(Number(data.retry_after) || 30);
      show(res.status === 401 ? 'ایمیل یا رمز عبور درست نیست' : 'ورود انجام نشد؛ کمی بعد دوباره تلاش کنید');
    } catch {
      setBusy(btn, false);
      show('اتصال به سرور برقرار نشد');
    }
  });
  $('#o-email').focus();
}

// ---------- shell
let shellReady = false;
function renderShell() {
  root.innerHTML = `<div class="shell" id="shell">
    <aside class="side" id="side" aria-label="منوی مدیریت">
      <a class="logo" href="#/dashboard"><img src="/favicon.svg" alt="" width="32" height="32" onerror="this.remove()"><span>${CONFIG.SERVICE_NAME}</span><span class="o-badge">مدیریت</span></a>
      <nav class="side-scroll">
        ${NAV.map((g) => `<div class="side-group"><span>${g.group}</span>${g.items.map(([id, t, ic]) => `<a class="nav-item" href="#/${id}" data-nav="${id}">${ICON[ic]}<span>${t}</span></a>`).join('')}</div>`).join('')}
      </nav>
      <div class="side-foot">
        <a class="btn btn-sm btn-ghost" href="/panel/" target="_blank" rel="noopener">${ICON.app}<span>پنل فروشگاه‌ها</span></a>
        <button class="btn btn-sm btn-ghost" type="button" data-theme-toggle aria-label="تغییر تم"></button>
        <button class="btn btn-sm btn-danger" type="button" data-logout>${ICON.out}<span>خروج</span></button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" type="button" id="menu-btn" aria-label="باز کردن منو" aria-controls="side" aria-expanded="false">${ICON.menu}</button>
        <b id="top-title" style="font-size:1rem"></b>
        <div class="top-end"><span class="clock num" id="clock" aria-live="off"></span>
          <button class="icon-btn" type="button" data-theme-toggle aria-label="تغییر تم"></button>
          <button class="icon-btn" type="button" data-logout aria-label="خروج">${ICON.out}</button></div>
      </header>
      <div id="page" class="page" tabindex="-1"></div>
    </div>
  </div>`;
  setTheme(document.documentElement.dataset.theme || 'dark');
  const side = $('#side');
  const closeDrawer = () => { side.classList.remove('open'); $('.scrim')?.remove(); $('#menu-btn')?.setAttribute('aria-expanded', 'false'); };
  $('#menu-btn').addEventListener('click', () => {
    side.classList.add('open');
    const s = document.createElement('div'); s.className = 'scrim'; s.addEventListener('click', closeDrawer); document.body.appendChild(s);
    $('#menu-btn').setAttribute('aria-expanded', 'true');
    side.querySelector('a')?.focus();
  });
  side.addEventListener('click', (e) => { if (e.target.closest('a[data-nav]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $$('[data-logout]').forEach((b) => b.addEventListener('click', () => { session.clear(); shellReady = false; if (location.hash === '#/login') route(); else location.hash = '#/login'; }));
  const tick = () => { const n = new Date(); const c = $('#clock'); if (c) c.textContent = `${jDate(n, { weekday: 'long', month: 'long', day: 'numeric' })} · ${jTime(n)}`; };
  tick(); setInterval(tick, 20_000);
  shellReady = true;
}

// ---------- router
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qsRaw] = raw.split('?');
  const parts = path.replace(/^\/+/, '').split('/');
  return { id: parts[0] || 'dashboard', sub: parts.slice(1).map(decodeURIComponent), path: raw, query: new URLSearchParams(qsRaw || '') };
}
const go = (path) => { location.hash = '#' + path; };

window.addEventListener('owner-session-expired', () => { shellReady = false; renderLogin(location.hash || '#/dashboard'); });

async function route() {
  const { id, sub, path, query } = parse();
  closeSheets();
  window.scrollTo(0, 0);
  if (!session.get()) {
    shellReady = false;
    return renderLogin(id === 'login' || id === '' ? '#/dashboard' : `#${path}`);
  }
  if (id === 'login') return go('/dashboard');
  if (!shellReady) renderShell();
  $$('[data-nav]').forEach((a) => (a.dataset.nav === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const title = TITLES[id];
  document.title = `${title || 'صفحه پیدا نشد'} | مدیریت بولگرام`;
  $('#top-title').textContent = title || '';
  // a fresh container per navigation: a slow page from an earlier route can never overwrite this one
  const old = $('#page');
  const page = old.cloneNode(false);
  old.replaceWith(page);
  try {
    if (!PAGES[id]) {
      page.innerHTML = `<section class="card">${emptyState('search', 'صفحه پیدا نشد', 'آدرسی که باز کردید وجود ندارد.', '<a class="btn btn-primary" href="#/dashboard">بازگشت به داشبورد</a>')}</section>`;
    } else {
      page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
      const render = await PAGES[id]();
      await render(page, { query, sub, go });
    }
  } catch (e) {
    if (e?.status === 401) return;
    console.error(e);
    page.innerHTML = `<section class="card">${emptyState('alert', 'نمایش این صفحه با خطا روبه‌رو شد', esc(e?.message || ''), '<button class="btn btn-primary" type="button" id="retry">تلاش دوباره</button>')}</section>`;
    $('#retry', page)?.addEventListener('click', route);
  }
  page.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
route();
