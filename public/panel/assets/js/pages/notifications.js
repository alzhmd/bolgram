import { api, pager, useStyle, esc, $, $$, jDate, jTime, toFa, emptyState, toast } from '../core.js';
import { setNotifications } from '../shell.js';

useStyle('notifications', `
.nt-list{display:flex;flex-direction:column;gap:8px}
.nt-day{margin:16px 0 4px;color:var(--muted);font-size:.85rem;font-weight:700}
.nt-item{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:right;border:1px solid var(--border);background:var(--surface);color:var(--fg);border-radius:12px;padding:12px 14px;cursor:pointer;font:inherit}
.nt-item:hover,.nt-item:focus-visible{border-color:var(--brand)}
.nt-item.unread{background:var(--brand-soft)}
.nt-dot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:7px;background:var(--muted)}
.nt-item.success .nt-dot{background:var(--green)}.nt-item.warning .nt-dot{background:var(--amber)}.nt-item.danger .nt-dot{background:var(--red)}.nt-item.info .nt-dot{background:var(--brand)}
.nt-main{flex:1;min-width:0}.nt-main b{display:block}.nt-main p{margin:2px 0 0;color:var(--muted);font-size:.9rem}
.nt-meta{flex:none;color:var(--muted);font-size:.78rem;white-space:nowrap}
.nt-filters{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:10px 0}
`);

const CATS = { payment: 'پرداخت', deposit: 'واریزی', device: 'دستگاه', billing: 'اشتراک و کیف پول', support: 'پشتیبانی', trust: 'نماد اعتماد', team: 'همکاران', system: 'سیستم' };

export async function render(page) {
  let cat = '', unread = false, pg = 1;
  page.innerHTML = `<div class="page-head"><h1>اعلان‌ها</h1><div class="actions"><button class="btn" id="nt-all" type="button">همه را خوانده‌شده کن</button></div></div>
    <div class="tabs" role="tablist" aria-label="دسته‌بندی اعلان‌ها"><button role="tab" data-cat="" aria-selected="true">همه</button>${Object.entries(CATS).map(([k, v]) => `<button role="tab" data-cat="${k}" aria-selected="false">${v}</button>`).join('')}</div>
    <div class="nt-filters"><label class="check"><input type="checkbox" id="nt-unread"> <span>فقط خوانده‌نشده‌ها</span></label><span class="muted" id="nt-count" aria-live="polite"></span></div>
    <div id="nt-body"></div>`;
  const body = $('#nt-body', page);

  const load = async () => {
    body.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await api(`/api/v2/notifications?page=${pg}&per_page=25${cat ? `&category=${cat}` : ''}${unread ? '&unread=1' : ''}`); } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.body?.message || e.message)}</div>`; return; }
    $('#nt-count', page).textContent = r.unread ? `${toFa(r.unread)} خوانده‌نشده` : 'همه خوانده شده‌اند';
    if (!r.data.length) { body.innerHTML = `<section class="card">${emptyState('bell', unread ? 'اعلان خوانده‌نشده‌ای ندارید' : 'هنوز اعلانی ندارید', 'پرداخت‌ها، واریزی‌های نیازمند بررسی، وضعیت دستگاه و پیام‌های پشتیبانی همین‌جا نمایش داده می‌شود.')}</section>`; return; }
    const groups = [];
    for (const n of r.data) {
      const day = jDate(n.created_at, { weekday: 'long' });
      (groups.at(-1)?.day === day ? groups.at(-1) : groups[groups.push({ day, items: [] }) - 1]).items.push(n);
    }
    body.innerHTML = groups.map((g) => `<div class="nt-day">${esc(g.day)}</div><div class="nt-list">${g.items.map((n) => `<button type="button" class="nt-item ${n.level} ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}" data-href="${esc(n.href || '')}">
      <span class="nt-dot" aria-hidden="true"></span><span class="nt-main"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}</span>
      <span class="nt-meta">${esc(n.category_name)} · ${esc(jTime(n.created_at))}${n.read ? '' : ' · <b>جدید</b>'}</span></button>`).join('')}</div>`).join('');
    if (r.total > r.per_page) body.appendChild(pager(r, (n) => { pg = n; load(); }));
    $$('.nt-item', body).forEach((el) => el.addEventListener('click', async () => {
      if (el.classList.contains('unread')) { api('/api/v2/notifications/read', { method: 'POST', body: { ids: [el.dataset.id] } }).catch(() => {}); el.classList.remove('unread'); pollBell(); }
      if (el.dataset.href) location.hash = el.dataset.href;
    }));
  };

  $$('[data-cat]', page).forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat; pg = 1;
    $$('[data-cat]', page).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    load();
  }));
  $('#nt-unread', page).addEventListener('change', (e) => { unread = e.target.checked; pg = 1; load(); });
  $('#nt-all', page).addEventListener('click', async () => {
    try { await api('/api/v2/notifications/read', { method: 'POST', body: { all: true, ...(cat ? { category: cat } : {}) } }); toast('همه خوانده‌شده شدند', 'ok'); pollBell(); load(); } catch (e) { toast(e.body?.message || e.message, 'err'); }
  });
  await load();
}

// ---------------------------------------------------------------- bell (header)
let bellTimer = null, bellBound = false;

async function pollBell() {
  try {
    const r = await api('/api/v2/notifications/unread-count');
    setNotifications(r.latest.map((n) => ({ at: n.created_at, ok: n.level === 'success' || n.level === 'info', title: n.title, sub: n.body || n.category_name, href: n.href || '#/notifications' })));
    const c = $('#bell-count');
    if (c) { c.textContent = r.count > 99 ? `${toFa(99)}+` : toFa(r.count); c.classList.toggle('hidden', !r.count); }
  } catch { /* offline or signed out: the next tick retries */ }
}

export function initBell() {
  if (bellBound) return pollBell();
  bellBound = true;
  pollBell();
  bellTimer = setInterval(() => { if (!document.hidden) pollBell(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollBell(); });
  // Opening the bell marks everything as read.
  document.addEventListener('click', (e) => {
    const bell = e.target.closest?.('#bell');
    if (!bell) return;
    const c = $('#bell-count');
    if (c && !c.classList.contains('hidden')) {
      api('/api/v2/notifications/read', { method: 'POST', body: { all: true } }).catch(() => {});
      setTimeout(() => c.classList.add('hidden'), 0);
    }
  });
  window.addEventListener('session-expired', () => { clearInterval(bellTimer); bellBound = false; }, { once: true });
}
