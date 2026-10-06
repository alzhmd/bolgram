import { api, can, table, pager, modal, confirmDialog, toast, copy, setBusy, useStyle, esc, $, $$, jDateTime, ago, normMobile, emptyState, ICON, session, passwordError } from '../core.js';

useStyle('team', `
.tm-who b{display:block}.tm-who small{color:var(--muted)}
.tm-acts{display:flex;gap:6px;flex-wrap:wrap}
.tm-link{display:flex;gap:8px;align-items:stretch;margin:10px 0}.tm-link .code{flex:1;word-break:break-all;direction:ltr;text-align:left;user-select:all}
.tm-matrix{overflow-x:auto;border:1px solid var(--border);border-radius:12px}
.tm-matrix table{border-collapse:collapse;width:100%;min-width:520px;font-size:.88rem}
.tm-matrix th,.tm-matrix td{padding:8px 12px;border-bottom:1px solid var(--border);text-align:center}
.tm-matrix th:first-child,.tm-matrix td:first-child{text-align:right;position:sticky;right:0;background:var(--surface)}
.tm-matrix tr:last-child td{border:0}.tm-yes{color:var(--green);font-weight:700}.tm-no{color:var(--muted);opacity:.5}
.tm-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}.tm-filters .field{margin:0;min-width:180px;flex:1}
.tm-meta{color:var(--muted);font-size:.8rem}
`);

const ROLE_HINT = {
  manager: 'همهٔ کارهای روزمره به‌جز تنظیمات فروشگاه، کلید API، کیف پول و مدیریت همکاران',
  accountant: 'فاکتورها، واریزی‌های بی‌صاحب، گزارش‌ها و کیف پول',
  cashier: 'ساخت فاکتور و دیدن فاکتورها، لینک‌ها و کارت‌ها',
  viewer: 'فقط مشاهده، بدون هیچ تغییری',
};
const STATUS_CLS = { active: 'ok', invited: 'warn', disabled: 'bad' };

export async function render(page, { me, actor }) {
  if (!can('team:manage')) return renderSelf(page, actor);
  let tab = 'members';
  let state = null;
  page.innerHTML = `<div class="page-head"><h1>همکاران</h1><div class="actions"><button class="btn btn-primary" id="tm-invite" type="button">${ICON.plus} دعوت همکار</button></div></div>
    <div class="tabs" role="tablist"><button role="tab" data-tab="members" aria-selected="true">اعضای تیم</button><button role="tab" data-tab="activity" aria-selected="false">فعالیت‌ها</button></div>
    <div id="tm-body" aria-live="polite" style="margin-top:14px"></div>`;
  const body = $('#tm-body', page);
  const roleName = (id) => state.roles.find((r) => r.id === id)?.name || id;

  const load = async () => {
    body.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    try { state = await api('/api/v2/team'); } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.body?.message || e.message)}</div>`; return; }
    show();
  };
  const show = () => (tab === 'members' ? showMembers() : showActivity());

  function showLink(title, r) {
    const text = `${me?.name || 'فروشگاه'} شما را به پنل بولگرام دعوت کرده است. برای پیوستن این پیوند را باز کنید (تا ۷۲ ساعت معتبر است):`;
    const m = modal({
      title, body: `<p>این پیوند را برای همکار بفرستید. او با باز کردن آن، با کد پیامکی به شمارهٔ خودش وارد می‌شود.</p>
        <div class="tm-link"><div class="code" id="tm-url">${esc(r.invite_link)}</div></div>
        <div class="tm-acts"><button class="btn btn-primary btn-sm" id="tm-copy" type="button">کپی پیوند</button>
        ${navigator.share ? '<button class="btn btn-sm" id="tm-share" type="button">اشتراک‌گذاری</button>' : ''}
        <a class="btn btn-sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(r.invite_link)}&text=${encodeURIComponent(text)}">ارسال در تلگرام</a></div>
        <p class="hint" style="margin-top:12px">این پیوند فقط یک بار نمایش داده می‌شود؛ اگر گم شد، «دعوت دوباره» بزنید.</p>`,
      actions: '<button class="btn" data-close>بستن</button>',
    });
    $('#tm-copy', m.el).addEventListener('click', (e) => copy(r.invite_link, e.currentTarget));
    $('#tm-share', m.el)?.addEventListener('click', () => navigator.share({ title: 'دعوت به بولگرام', text, url: r.invite_link }).catch(() => {}));
  }

  function inviteModal() {
    const opts = state.roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    const m = modal({
      title: 'دعوت همکار جدید',
      body: `<form id="tm-form" novalidate>
        <div class="field"><label for="tm-name">نام همکار</label><input class="input" id="tm-name" maxlength="60" autocomplete="off"><div class="err" id="tm-name-err" role="alert"></div></div>
        <div class="field"><label for="tm-mobile">شمارهٔ موبایل</label><input class="input ltr" id="tm-mobile" type="tel" inputmode="tel" maxlength="20" placeholder="۰۹۱۲۳۴۵۶۷۸۹"><div class="err" id="tm-mobile-err" role="alert"></div></div>
        <div class="field"><label for="tm-role">نقش</label><select class="input select" id="tm-role">${opts}</select><div class="hint" id="tm-role-hint"></div><div class="err" id="tm-role-err" role="alert"></div></div>
      </form>`,
      actions: '<button class="btn" data-close>انصراف</button><button class="btn btn-primary" id="tm-send" type="button">ساخت دعوت‌نامه</button>',
    });
    const sel = $('#tm-role', m.el);
    sel.value = 'cashier';
    const hint = () => ($('#tm-role-hint', m.el).textContent = ROLE_HINT[sel.value] || '');
    hint(); sel.addEventListener('change', hint);
    const send = async () => {
      const errs = {};
      const name = $('#tm-name', m.el).value.trim();
      const mobile = normMobile($('#tm-mobile', m.el).value);
      if (name.length < 2) errs.name = 'نام همکار را وارد کنید';
      if (!mobile) errs.mobile = 'شمارهٔ موبایل معتبر نیست';
      for (const k of ['name', 'mobile', 'role']) $(`#tm-${k}-err`, m.el).textContent = errs[k] || '';
      if (Object.keys(errs).length) return;
      const btn = $('#tm-send', m.el);
      setBusy(btn, true, 'در حال ساخت…');
      try {
        const r = await api('/api/v2/team/invite', { method: 'POST', body: { name, mobile, role: sel.value } });
        m.close(); toast('دعوت‌نامه ساخته شد', 'ok');
        showLink('پیوند دعوت', r);
        load();
      } catch (e) {
        setBusy(btn, false);
        for (const [k, v] of Object.entries(e.body?.errors || {})) { const el = $(`#tm-${k}-err`, m.el); if (el) el.textContent = v; }
        if (!e.body?.errors) toast(e.body?.message || e.message, 'err');
        if (e.status === 402) toast(e.body.message, 'err');
      }
    };
    $('#tm-send', m.el).addEventListener('click', send);
    $('#tm-form', m.el).addEventListener('submit', (e) => { e.preventDefault(); send(); });
  }
  $('#tm-invite', page).addEventListener('click', () => (state ? inviteModal() : load()));

  async function act(fn, ok) {
    try { const r = await fn(); if (ok) toast(ok, 'ok'); await load(); return r; } catch (e) { toast(e.body?.message || e.message, 'err'); load(); }
  }

  function showMembers() {
    const rows = state.data;
    const cols = [
      { title: 'همکار', render: (r) => `<div class="tm-who"><b>${esc(r.name || '—')}</b><small class="ltr">${esc(r.mobile)}</small></div>` },
      { title: 'نقش', render: (r) => `<select class="input select" data-role="${r.id}" aria-label="نقش ${esc(r.name || r.mobile)}" style="min-width:130px">${state.roles.map((x) => `<option value="${x.id}" ${x.id === r.role ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` },
      { title: 'وضعیت', render: (r) => `<span class="pill ${STATUS_CLS[r.status] || ''}">${esc(r.status_name)}</span>${r.status === 'invited' ? `<div class="tm-meta">${r.invite_expired ? 'دعوت منقضی شده' : `تا ${esc(jDateTime(r.invite_expires_at))}`}</div>` : ''}` },
      { title: 'آخرین ورود', render: (r) => (r.last_login_at ? `${esc(jDateTime(r.last_login_at))}<div class="tm-meta">${esc(ago(r.last_login_at))}</div>` : '<span class="muted">—</span>') },
      { title: 'عملیات', render: (r) => `<div class="tm-acts">
        ${r.status !== 'active' ? `<button class="btn btn-sm" data-reinvite="${r.id}" type="button">دعوت دوباره</button>` : ''}
        ${r.status === 'active' ? `<button class="btn btn-sm" data-disable="${r.id}" type="button">غیرفعال‌سازی</button>` : r.status === 'disabled' ? `<button class="btn btn-sm" data-enable="${r.id}" type="button">فعال‌سازی</button>` : ''}
        <button class="btn btn-sm btn-danger" data-remove="${r.id}" type="button">حذف</button></div>` },
    ];
    const matrix = `<table><thead><tr><th scope="col">دسترسی</th><th scope="col">مالک</th>${state.roles.map((r) => `<th scope="col">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${state.perms
      .map((p) => `<tr><td>${esc(p.name)}</td><td class="tm-yes" aria-label="دارد">✓</td>${state.roles.map((r) => (r.perms.includes(p.key) ? '<td class="tm-yes" aria-label="دارد">✓</td>' : '<td class="tm-no" aria-label="ندارد">—</td>')).join('')}</tr>`).join('')}</tbody></table>`;
    body.innerHTML = `${state.limit_message ? `<div class="alert alert-warn" style="margin-bottom:12px">${esc(state.limit_message)} <a href="#/plans">مشاهدهٔ پلن‌ها</a></div>` : ''}
      <section class="card"><div class="card-head"><h3>اعضای تیم</h3></div>
        <ul class="list" style="margin-bottom:10px"><li><span class="tm-who"><b>${esc(state.owner.name)}</b><small class="ltr">${esc(state.owner.mobile || '')}</small></span><span class="pill ok" style="margin-inline-start:auto">مالک</span></li></ul>
        ${rows.length ? table(cols, rows) : emptyState('users', 'هنوز همکاری اضافه نکرده‌اید', 'صندوق‌دار یا حسابدار را دعوت کنید تا با شمارهٔ خودش و دسترسی محدود وارد پنل شود؛ لازم نیست رمز شما را بداند.', '<button class="btn btn-primary" id="tm-empty-invite" type="button">دعوت همکار</button>')}
      </section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h3>هر نقش چه کاری می‌تواند بکند؟</h3></div>
        <p class="muted" style="margin-top:0">دسترسی‌ها با نقش تعیین می‌شود و با تغییر نقش، همکار بلافاصله با دسترسی جدید وارد می‌شود. هر تغییر در تب «فعالیت‌ها» ثبت می‌شود.</p>
        <div class="tm-matrix" tabindex="0" role="region" aria-label="جدول دسترسی نقش‌ها">${matrix}</div></section>`;
    $('#tm-empty-invite', body)?.addEventListener('click', inviteModal);
    const byId = (id) => rows.find((r) => r.id === id);
    $$('[data-role]', body).forEach((s) => s.addEventListener('change', () => act(() => api(`/api/v2/team/${s.dataset.role}`, { method: 'PATCH', body: { role: s.value } }), 'نقش تغییر کرد')));
    $$('[data-reinvite]', body).forEach((b) => b.addEventListener('click', async () => {
      const r = await act(() => api(`/api/v2/team/${b.dataset.reinvite}/reinvite`, { method: 'POST' }));
      if (r) showLink('پیوند دعوت جدید', r);
    }));
    $$('[data-disable]', body).forEach((b) => b.addEventListener('click', async () => {
      const r = byId(b.dataset.disable);
      if (await confirmDialog('غیرفعال‌سازی همکار', `«${esc(r.name || r.mobile)}» بلافاصله از پنل خارج می‌شود و تا فعال‌سازی دوباره نمی‌تواند وارد شود.`, 'غیرفعال کن', true)) act(() => api(`/api/v2/team/${r.id}`, { method: 'PATCH', body: { status: 'disabled' } }), 'همکار غیرفعال شد');
    }));
    $$('[data-enable]', body).forEach((b) => b.addEventListener('click', () => act(() => api(`/api/v2/team/${b.dataset.enable}`, { method: 'PATCH', body: { status: 'active' } }), 'همکار فعال شد')));
    $$('[data-remove]', body).forEach((b) => b.addEventListener('click', async () => {
      const r = byId(b.dataset.remove);
      if (await confirmDialog('حذف همکار', `«${esc(r.name || r.mobile)}» از تیم حذف می‌شود و دیگر نمی‌تواند وارد شود. این کار برگشت‌پذیر نیست.`, 'حذف کن', true)) act(() => api(`/api/v2/team/${r.id}`, { method: 'DELETE' }), 'همکار حذف شد');
    }));
  }

  async function showActivity(p = 1, f = {}) {
    body.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    const qs = new URLSearchParams({ page: p, ...(f.actor ? { actor: f.actor } : {}), ...(f.action ? { action: f.action } : {}) });
    let r;
    try { r = await api(`/api/v2/team/activity?${qs}`); } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.body?.message || e.message)}</div>`; return; }
    const cols = [
      { title: 'زمان', render: (x) => esc(jDateTime(x.at)) },
      { title: 'چه کسی', render: (x) => esc(x.actor_name || '—') },
      { title: 'چه کاری', render: (x) => `<b>${esc(x.label)}</b>${x.meta?.name ? `<div class="tm-meta">${esc(x.meta.name)}${x.meta.to ? ` ← ${esc(roleName(x.meta.to))}` : ''}</div>` : ''}` },
      { title: 'آی‌پی', cls: 'ltr', render: (x) => esc(x.ip || '—') },
    ];
    body.innerHTML = `<section class="card"><div class="card-head"><h3>گزارش فعالیت</h3></div>
      <div class="tm-filters"><div class="field"><label for="af-actor">انجام‌دهنده</label><select class="input select" id="af-actor"><option value="">همه</option>${r.actors.map((a) => `<option value="${esc(a.id)}" ${a.id === f.actor ? 'selected' : ''}>${esc(a.name || a.id)}</option>`).join('')}</select></div>
      <div class="field"><label for="af-action">نوع کار</label><select class="input select" id="af-action"><option value="">همه</option>${r.actions.map((a) => `<option value="${esc(a.action)}" ${a.action === f.action ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></div></div>
      <div id="af-list">${table(cols, r.data, { empty: 'فعالیتی ثبت نشده است' })}</div></section>`;
    if (r.total > r.per_page) $('#af-list', body).appendChild(pager(r, (n) => showActivity(n, f)));
    const re = () => showActivity(1, { actor: $('#af-actor', body).value, action: $('#af-action', body).value });
    $('#af-actor', body).addEventListener('change', re);
    $('#af-action', body).addEventListener('change', re);
  }

  $$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tab]', page).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    show();
  }));
  await load();
}

/** Team members cannot manage the team but can change their own password. */
function renderSelf(page, actor) {
  page.innerHTML = `<div class="page-head"><h1>حساب من</h1></div>
    <section class="card" style="max-width:480px"><div class="card-head"><h3>تغییر رمز عبور</h3></div>
    ${actor?.kind === 'staff' ? `<p class="muted" style="margin-top:0">با تغییر رمز، در سایر دستگاه‌ها از حساب خارج می‌شوید.</p>
    <form id="pw" novalidate>
      <div class="field"><label for="pw-cur">رمز فعلی</label><input class="input ltr" id="pw-cur" type="password" autocomplete="current-password" maxlength="64"><div class="err" id="pw-cur-err" role="alert"></div></div>
      <div class="field"><label for="pw-new">رمز جدید</label><input class="input ltr" id="pw-new" type="password" autocomplete="new-password" maxlength="64"><div class="err" id="pw-new-err" role="alert"></div></div>
      <button class="btn btn-primary" type="submit">ذخیرهٔ رمز جدید</button></form>` : '<p class="muted">برای تغییر رمز مالک از «فراموشی رمز» در صفحهٔ ورود استفاده کنید.</p>'}</section>`;
  const f = $('#pw', page);
  f?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('#pw-cur', f).value, nw = $('#pw-new', f).value;
    const perr = passwordError(nw, {});
    $('#pw-cur-err', f).textContent = cur ? '' : 'رمز فعلی را وارد کنید';
    $('#pw-new-err', f).textContent = perr || '';
    if (!cur || perr) return;
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ذخیره…');
    try {
      const r = await api('/api/v2/team/me/password', { method: 'POST', body: { current: cur, next: nw } });
      session.set(r.token, !!localStorage.getItem('bg_token'));
      toast('رمز عبور تغییر کرد', 'ok');
      f.reset();
    } catch (err) {
      for (const [k, v] of Object.entries(err.body?.errors || {})) { const el = $(`#pw-${k === 'current' ? 'cur' : 'new'}-err`, f); if (el) el.textContent = v; }
      if (!err.body?.errors) toast(err.body?.message || err.message, 'err');
    }
    setBusy(btn, false);
  });
}
