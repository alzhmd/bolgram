import { CONFIG, payBase, api, session, toFa, toLatin, faNum, toman, jDate, jTime, esc, modal, toast, copy, setBusy, ICON, $, $$ } from './core.js';

export const NAV = [
  { group: 'عملیات', items: [['dashboard', 'داشبورد', 'home'], ['invoices', 'فاکتورها', 'receipt'], ['reports', 'گزارش‌ها', 'chart'], ['links', 'لینک‌های پرداخت', 'link']] },
  { group: 'مالی', items: [['wallet', 'کیف پول', 'wallet'], ['cards', 'کارت‌ها', 'card'], ['plans', 'اشتراک و پلن‌ها', 'crown']] },
  { group: 'اتصال', items: [['devices', 'دستگاه‌ها', 'phone'], ['app', 'اپلیکیشن', 'app'], ['bots', 'ربات تلگرام و بله', 'bot'], ['plugins', 'افزونه‌ها', 'plug'], ['webhooks', 'اعلان‌های وب‌هوک', 'hook']] },
  { group: 'کسب‌وکار', items: [['trust', 'نماد اعتماد', 'shield'], ['team', 'همکاران', 'users'], ['referral', 'دعوت دوستان', 'gift']] },
  { group: 'کمک', items: [['support', 'پشتیبانی', 'help'], ['learn', 'آموزش', 'book'], ['review', 'نظر من', 'star'], ['notifications', 'اعلان‌ها', 'bell']] },
  { group: 'حساب', items: [['settings', 'تنظیمات و پروفایل', 'cog']] },
];
export const PAGE_TITLES = Object.fromEntries(NAV.flatMap((g) => g.items.map(([id, t]) => [id, t])));
const SITE_LINKS = [['تعرفه‌ها', '/pricing.html'], ['بلاگ', '/blog/'], ['سؤالات متداول', '/faq.html'], ['مستندات فنی', '/docs.html'], ['درباره ما', '/about.html'], ['تماس با ما', '/contact.html']];

let me = null;
let notifItems = [];

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bg_theme', t); } catch {}
  $$('[data-theme-toggle]').forEach((b) => (b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon));
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-theme-toggle]')) setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

export function renderShell(root, merchant) {
  me = merchant;
  const mini = localStorage.getItem('bg_side_mini') === '1';
  const bannerClosed = localStorage.getItem('bg_banner_gift') === '1';
  root.innerHTML = `<div class="shell ${mini ? 'mini' : ''}" id="shell">
    <aside class="side" id="side" aria-label="منوی پنل">
      <button class="side-toggle" type="button" id="side-toggle" aria-label="جمع و باز کردن منو" aria-expanded="${!mini}">${ICON.chev}</button>
      <a class="logo" href="#/dashboard"><img src="/favicon.svg" alt="" width="32" height="32" onerror="this.remove()"><span>${CONFIG.SERVICE_NAME}</span></a>
      <nav class="side-scroll">
        ${NAV.map((g) => `<div class="side-group"><span>${g.group}</span>${g.items.map(([id, t, ic]) => `<a class="nav-item" href="#/${id}" data-nav="${id}" data-tip="${t}">${ICON[ic]}<span>${t}</span></a>`).join('')}</div>`).join('')}
        <div class="side-group drawer-links"><span>سایت</span>${SITE_LINKS.map(([t, u]) => `<a class="nav-item" href="${CONFIG.SITE_URL}${u}" target="_blank" rel="noopener"><span>${t}</span></a>`).join('')}</div>
      </nav>
      <div class="side-foot">
        <div class="who"><b>${esc(merchant.name)}</b><span class="ltr">@${esc(merchant.handle || merchant.id)}</span></div>
        <button class="btn btn-sm btn-ghost" type="button" id="new-store" title="به‌زودی">${ICON.plus}<span>فروشگاه جدید</span></button>
        <button class="btn btn-sm btn-ghost" type="button" data-theme-toggle aria-label="تغییر تم"></button>
        <button class="btn btn-sm btn-danger" type="button" data-logout>${ICON.out}<span>خروج از حساب</span></button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" type="button" id="menu-btn" aria-label="باز کردن منو" aria-controls="side" aria-expanded="false">${ICON.menu}</button>
        <a class="logo" href="#/dashboard"><span>${CONFIG.SERVICE_NAME}</span></a>
        <nav class="site-links" aria-label="لینک‌های سایت">${SITE_LINKS.map(([t, u]) => `<a href="${CONFIG.SITE_URL}${u}" target="_blank" rel="noopener">${t}</a>`).join('')}</nav>
        <div class="top-end">
          <span class="clock num" id="clock" aria-live="off"></span>
          <button class="icon-btn" type="button" id="search-btn" aria-label="جستجو (Ctrl+K)" title="جستجو (Ctrl+K)">${ICON.search}</button>
          <button class="icon-btn" type="button" data-theme-toggle aria-label="تغییر تم"></button>
          <div style="position:relative"><button class="icon-btn" type="button" id="bell" aria-label="اعلان‌ها" aria-expanded="false" aria-haspopup="true">${ICON.bell}<span class="badge-count hidden" id="bell-count"></span></button><div class="dropdown hidden" id="bell-menu"></div></div>
          <div style="position:relative"><button class="icon-btn" type="button" id="avatar" aria-label="منوی حساب" aria-expanded="false" aria-haspopup="true">${ICON.user}</button>
            <div class="dropdown hidden" id="avatar-menu" style="width:220px">
              <a href="#/settings">${ICON.user} پروفایل</a><a href="#/settings">${ICON.cog} تنظیمات</a><button class="item" type="button" data-tour-start>${ICON.book} اجرای دوبارهٔ تور پنل</button>
              <button class="item" type="button" data-logout style="color:var(--red)">${ICON.out} خروج</button></div></div>
        </div>
      </header>
      ${bannerClosed ? '' : `<div class="banner" id="gift-banner" role="note">${ICON.gift}<span>شارژ هدیه: با شارژ کیف پول کارمزد تا ۲۰٪ اعتبار هدیه بگیرید.</span><button class="icon-btn x" type="button" aria-label="بستن اطلاعیه" id="banner-x">${ICON.x}</button></div>`}
      <div id="page" class="page" tabindex="-1"></div>
    </div>
    <button class="btn btn-primary fab" type="button" id="fab" data-tour="fab">${ICON.plus} فاکتور</button>
  </div>`;
  setTheme(document.documentElement.dataset.theme || 'dark');

  const shell = $('#shell'), side = $('#side');
  $('#side-toggle').addEventListener('click', () => {
    const m = shell.classList.toggle('mini');
    localStorage.setItem('bg_side_mini', m ? '1' : '0');
    $('#side-toggle').setAttribute('aria-expanded', String(!m));
  });
  const closeDrawer = () => { side.classList.remove('open'); $('.scrim')?.remove(); $('#menu-btn').setAttribute('aria-expanded', 'false'); };
  $('#menu-btn').addEventListener('click', () => {
    side.classList.add('open');
    const s = document.createElement('div'); s.className = 'scrim'; s.addEventListener('click', closeDrawer); document.body.appendChild(s);
    $('#menu-btn').setAttribute('aria-expanded', 'true');
    side.querySelector('a')?.focus();
  });
  side.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeMenus(); } });

  $('#banner-x')?.addEventListener('click', () => { localStorage.setItem('bg_banner_gift', '1'); $('#gift-banner').remove(); });
  $$('[data-logout]').forEach((b) => b.addEventListener('click', () => { session.clear(); location.hash = '#/login'; }));
  $('#new-store').addEventListener('click', () => toast('چند فروشگاه برای یک حساب در مرحلهٔ بعد فعال می‌شود'));

  const toggleMenu = (btn, menu) => {
    const open = menu.classList.contains('hidden');
    closeMenus();
    if (open) { menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  };
  $('#bell').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu($('#bell'), $('#bell-menu')); markSeen(); });
  $('#avatar').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu($('#avatar'), $('#avatar-menu')); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) closeMenus(); });

  const tick = () => { const n = new Date(); const c = $('#clock'); if (c) c.textContent = `${jDate(n, { weekday: 'long', month: 'long', day: 'numeric' })} · ${jTime(n)}`; };
  tick(); setInterval(tick, 20_000);

  $('#search-btn').addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });
  $('#fab').addEventListener('click', quickInvoice);
}

function closeMenus() {
  $$('.dropdown').forEach((d) => d.classList.add('hidden'));
  $('#bell')?.setAttribute('aria-expanded', 'false');
  $('#avatar')?.setAttribute('aria-expanded', 'false');
}

export function setActiveNav(id) {
  $$('[data-nav]').forEach((a) => (a.dataset.nav === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

// ---------- notifications (derived from real recent activity; full center comes with the notifications page)
export function setNotifications(items) {
  notifItems = items;
  const seen = Number(localStorage.getItem('bg_notif_seen') || 0);
  const unread = items.filter((n) => new Date(n.at).getTime() > seen).length;
  const c = $('#bell-count');
  if (c) { c.textContent = toFa(unread); c.classList.toggle('hidden', !unread); }
  const menu = $('#bell-menu');
  if (menu) {
    menu.innerHTML = items.length
      ? items.slice(0, 5).map((n) => `<a href="${n.href || '#/notifications'}">${n.ok ? '✅' : '⚠️'} <span><b>${esc(n.title)}</b><br><small class="muted">${esc(n.sub)}</small></span></a>`).join('') + '<a href="#/notifications" style="justify-content:center;color:var(--brand)">همهٔ اعلان‌ها</a>'
      : '<div class="empty" style="padding:16px">اعلانی وجود ندارد</div>';
  }
}
function markSeen() {
  localStorage.setItem('bg_notif_seen', String(Date.now()));
  $('#bell-count')?.classList.add('hidden');
}

// ---------- global search (Ctrl/Cmd+K)
function openSearch() {
  const pages = Object.entries(PAGE_TITLES);
  const m = modal({ title: 'جستجو', body: `<input class="input" id="q" placeholder="نام صفحه، مثلاً «کارت‌ها»" autocomplete="off"><ul class="list" id="q-res" style="margin-top:10px" role="listbox"></ul>` });
  const input = $('#q', m.el), res = $('#q-res', m.el);
  const render = () => {
    const q = toLatin(input.value).trim();
    const hits = pages.filter(([id, t]) => !q || t.includes(q) || id.includes(q.toLowerCase())).slice(0, 8);
    res.innerHTML = hits.map(([id, t], i) => `<li role="option" ${i === 0 ? 'aria-selected="true"' : ''}><a href="#/${id}" style="flex:1;text-decoration:none;color:var(--fg)">${esc(t)}</a></li>`).join('') || '<li class="muted">نتیجه‌ای پیدا نشد</li>';
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = res.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); m.close(); } } });
  res.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
  render();
}

// ---------- quick invoice (FAB)
const CHANNELS = [['instagram', 'اینستاگرام'], ['telegram', 'تلگرام'], ['in_person', 'حضوری'], ['website', 'سایت'], ['other', 'سایر']];
export async function quickInvoice() {
  let cards = [];
  try { cards = (await api('/api/v2/cards')).data.filter((c) => c.active); } catch {}
  if (!cards.length) {
    const m = modal({ title: 'اول کارت اضافه کنید', body: '<p>برای ساخت فاکتور باید حداقل یک کارت بانکی فعال داشته باشید؛ مشتری به همین کارت واریز می‌کند.</p>', actions: '<button class="btn" data-close>بعداً</button><a class="btn btn-primary" href="#/cards" data-go>افزودن کارت</a>' });
    m.el.querySelector('[data-go]').addEventListener('click', () => m.close());
    return;
  }
  const m = modal({
    title: 'فاکتور سریع',
    body: `<form id="qi" novalidate>
      <div class="field"><label for="qi-amount">مبلغ (تومان)</label><input class="input ltr num" id="qi-amount" inputmode="numeric" autocomplete="off" placeholder="۲۵۰٬۰۰۰"><div class="err" id="qi-amount-err" role="alert"></div></div>
      <div class="field"><label for="qi-note">بابت (اختیاری)</label><input class="input" id="qi-note" maxlength="200" autocomplete="off"></div>
      <div class="field"><label for="qi-ch">کانال فروش</label><select class="input" id="qi-ch">${CHANNELS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <button class="btn btn-primary btn-block" type="submit">ساخت فاکتور</button></form>`,
  });
  const f = $('#qi', m.el), amt = $('#qi-amount', m.el);
  amt.addEventListener('input', () => {
    const d = toLatin(amt.value).replace(/\D/g, '');
    amt.value = d ? faNum(Number(d)) : '';
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = Number(toLatin(amt.value).replace(/\D/g, ''));
    const err = $('#qi-amount-err', m.el);
    if (!value || value < 1000) { err.textContent = 'مبلغ باید حداقل ۱٬۰۰۰ تومان باشد'; amt.setAttribute('aria-invalid', 'true'); return amt.focus(); }
    err.textContent = '';
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ساخت…');
    try {
      const r = await api('/api/v2/invoices', { method: 'POST', body: { amount: value, note: $('#qi-note', m.el).value, channel: $('#qi-ch', m.el).value } });
      const inv = r.invoice, link = payBase() + inv.pay_path;
      $('.m-body', m.el).innerHTML = `<div class="alert alert-ok" style="margin-bottom:12px">فاکتور ساخته شد. مشتری باید <b>دقیقاً همین مبلغ</b> را واریز کند.</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <img class="qr" src="/api/v1/payment/qr?raw=1&size=320&data=${encodeURIComponent(link)}" alt="QR لینک پرداخت" width="160" height="160">
          <div style="flex:1;min-width:200px"><div class="muted">مبلغ یکتا</div><div style="font-size:1.6rem;font-weight:800" class="num">${faNum(inv.amount_toman)} تومان</div>
          <div class="muted" style="margin-top:6px">مهلت پرداخت: ${jTime(inv.expires_at)}</div></div></div>
        <div class="field" style="margin-top:14px"><label for="qi-link">لینک پرداخت</label><input class="input ltr" id="qi-link" readonly value="${esc(link)}"></div>
        <div class="modal-actions"><button class="btn" type="button" data-close>بستن</button><button class="btn btn-primary" type="button" id="qi-copy">کپی لینک</button></div>`;
      $('#qi-copy', m.el).addEventListener('click', (ev) => copy(link, ev.currentTarget));
      window.dispatchEvent(new CustomEvent('data-changed'));
    } catch (er) {
      setBusy(btn, false);
      err.textContent = er.body?.errors?.amount || er.body?.message || er.message;
    }
  });
}

// ---------- quick start + spotlight tour
const TOUR = [
  ['[data-tour="sales"]', 'فروش امروز', 'جمع واریزهای تأییدشدهٔ امروز اینجا لحظه‌ای به‌روز می‌شود.'],
  ['[data-tour="deposits"]', 'آخرین واریزها', 'هر پیامک بانکی که برسد، اینجا با وضعیت تطبیقش دیده می‌شود.'],
  ['[data-tour="status"]', 'وضعیت گوشی و فاکتورها', 'اگر گوشی قطع شود یا واریزی بی‌صاحب بماند، اینجا خبردار می‌شوید.'],
  ['[data-tour="fab"]', 'فاکتور سریع', 'از هر صفحه با این دکمه فاکتور بسازید و لینکش را برای مشتری بفرستید.'],
];
export function startTour() {
  let i = 0;
  const spot = document.createElement('div'), tip = document.createElement('div');
  spot.className = 'tour-spot'; tip.className = 'tour-tip'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-live', 'polite');
  document.body.append(spot, tip);
  const end = () => { spot.remove(); tip.remove(); localStorage.setItem('bg_tour_done', '1'); };
  const show = () => {
    const [sel, title, text] = TOUR[i];
    const el = $(sel);
    if (!el) { i++; return i < TOUR.length ? show() : end(); }
    el.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
    const r = el.getBoundingClientRect();
    Object.assign(spot.style, { top: `${r.top - 6}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const top = r.bottom + 14 + 170 < innerHeight ? r.bottom + 14 : Math.max(12, r.top - 184);
    Object.assign(tip.style, { top: `${top}px`, left: `${Math.min(Math.max(12, r.left), innerWidth - Math.min(300, innerWidth - 32) - 16)}px` });
    tip.innerHTML = `<div class="muted" style="font-size:.8rem">قدم ${toFa(i + 1)} از ${toFa(TOUR.length)}</div><b>${title}</b><p style="margin:6px 0 12px">${text}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-sm btn-ghost" type="button" data-skip>رد کردن</button><button class="btn btn-sm btn-primary" type="button" data-next>${i === TOUR.length - 1 ? 'تمام' : 'بعدی'}</button></div>`;
    tip.querySelector('[data-next]').focus();
    tip.querySelector('[data-next]').onclick = () => { i++; i < TOUR.length ? show() : end(); };
    tip.querySelector('[data-skip]').onclick = end;
  };
  show();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-tour-start]')) { closeMenus(); location.hash = '#/dashboard'; setTimeout(startTour, 400); } });

export function quickStart(status) {
  const steps = [['card', 'ثبت کارت بانکی', '#/cards'], ['device', 'نصب اپ روی گوشی', '#/app'], ['bot', 'اتصال ربات تلگرام و بله', '#/bots'], ['invoice', 'ساخت اولین فاکتور', '#/invoices']];
  const m = modal({
    title: 'راه‌اندازی سریع',
    body: `<p class="muted">چهار قدم تا دریافت اولین پرداخت خودکار:</p><ol class="steps4">${steps.map(([k, t, href], i) => `<li><span class="tick ${status[k] ? 'on' : ''}" aria-label="${status[k] ? 'انجام شده' : 'انجام نشده'}">${status[k] ? ICON.check : toFa(i + 1)}</span><a href="${href}" style="color:var(--fg);text-decoration:none;flex:1">${t}</a></li>`).join('')}</ol>`,
    actions: '<button class="btn btn-primary" type="button" data-start>شروع می‌کنم</button>',
    onClose: () => localStorage.removeItem('bg_quickstart'),
  });
  m.el.querySelector('[data-start]').addEventListener('click', () => { m.close(); if (!localStorage.getItem('bg_tour_done')) setTimeout(startTour, 300); });
  $$('.steps4 a', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
}
export { toman };
