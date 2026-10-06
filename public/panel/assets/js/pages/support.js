// Support: ticket list, new ticket form, chat-style thread with attachments, reply, close/reopen.
import { api, esc, faNum, toFa, toast, setBusy, emptyState, ICON, useStyle, session, ago, jDateTime, fileToDataUrl, pager, ApiError, $, $$ } from '../core.js';

const CATS = { payment: 'پرداخت و واریزی', technical: 'مشکل فنی', billing: 'مالی و صورت‌حساب', account: 'حساب کاربری', other: 'سایر' };
const PRIOS = { normal: 'عادی', high: 'مهم', urgent: 'فوری' };
const STATUS = { open: ['در انتظار پاسخ', 'warn'], answered: ['پاسخ داده شد', 'ok'], waiting: ['در حال بررسی', ''], closed: ['بسته شده', ''] };
const FILTERS = [['', 'همه'], ['active', 'باز'], ['answered', 'پاسخ‌داده‌شده'], ['closed', 'بسته']];
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const CSS = `
.sp-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.sp-row{display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);text-decoration:none;color:var(--fg)}
.sp-row:hover{border-color:var(--brand)}
.sp-row:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.sp-row.unread{border-color:var(--brand);background:var(--brand-soft)}
.sp-dot{width:10px;height:10px;border-radius:50%;background:var(--brand);flex:none}
.sp-dot.off{background:transparent}
.sp-main{flex:1;min-width:0}
.sp-main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-meta{display:flex;gap:6px 10px;flex-wrap:wrap;font-size:.8rem;color:var(--muted);margin-top:2px}
.sp-chat{display:grid;gap:12px;padding:6px 0}
.sp-msg{max-width:min(560px,92%);padding:12px 14px;border-radius:16px;border:1px solid var(--border);background:var(--surface-2);overflow-wrap:anywhere}
.sp-msg.me{background:var(--brand-soft);border-color:transparent;border-end-end-radius:4px}
.sp-msg.admin{background:var(--surface);border-end-start-radius:4px}
.sp-msg.me{justify-self:start}.sp-msg.admin{justify-self:end}
.sp-who{display:flex;gap:8px;justify-content:space-between;font-size:.78rem;color:var(--muted);margin-bottom:4px}
.sp-who b{color:var(--fg)}
.sp-text{white-space:pre-wrap;line-height:1.9}
.sp-atts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.sp-att{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font-size:.8rem;cursor:pointer;color:var(--fg);max-width:100%}
.sp-att img{width:44px;height:44px;object-fit:cover;border-radius:6px}
.sp-att span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.sp-pick{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.sp-chip{display:flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border:1px solid var(--border);border-radius:10px;font-size:.8rem;background:var(--surface-2)}
.sp-chip img{width:32px;height:32px;object-fit:cover;border-radius:6px}
.sp-chip button{border:0;background:none;color:var(--red);cursor:pointer;font-size:1.1rem;line-height:1}
.sp-top{display:flex;gap:8px 16px;flex-wrap:wrap;align-items:center}
.sp-reply{position:sticky;bottom:0;background:var(--surface);padding-top:12px}
`;

const pill = (s) => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

export async function render(page, { sub, go }) {
  useStyle('support', CSS);
  const id = sub?.[0];
  if (id === 'new') return renderNew(page, go);
  if (id) return renderThread(page, id, go);
  return renderList(page, go);
}

// ---------------------------------------------------------------- list
async function renderList(page, go, state = { status: '', page: 1 }) {
  page.innerHTML = `<div class="page-head"><h1>پشتیبانی</h1><div class="actions"><a class="btn btn-primary" href="#/support/new">${ICON.plus} تیکت جدید</a></div></div>
    <section class="card"><div class="toolbar"><div class="seg" role="group" aria-label="فیلتر وضعیت">${FILTERS.map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${state.status === v}">${t}</button>`).join('')}</div></div>
    <div id="sp-body" aria-live="polite"><p class="muted">در حال بارگذاری…</p></div></section>
    <p class="muted" style="margin-top:12px">پاسخ‌گویی معمولاً در ساعات کاری انجام می‌شود. برای پاسخ سریع‌تر، شمارهٔ فاکتور یا مبلغ واریزی را در پیام بنویسید. پیش از ثبت تیکت می‌توانید <a href="#/learn/device-offline">راهنمای عیب‌یابی</a> را ببینید.</p>`;
  $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => renderList(page, go, { status: b.dataset.f, page: 1 })));
  const body = $('#sp-body', page);
  try {
    const q = new URLSearchParams({ page: state.page, per_page: 15 });
    if (state.status) q.set('status', state.status);
    const r = await api(`/api/v2/support/tickets?${q}`);
    if (!r.data.length) {
      body.innerHTML = state.status
        ? `<div class="empty" style="padding:24px">تیکتی با این وضعیت نیست.</div>`
        : emptyState('help', 'هنوز تیکتی ثبت نکرده‌اید', 'اگر سؤال یا مشکلی دارید، تیکت جدید بسازید؛ تیم بولگرام پاسخ می‌دهد.', `<a class="btn btn-primary" href="#/support/new">ثبت اولین تیکت</a>`);
      return;
    }
    body.innerHTML = `<ul class="sp-list">${r.data.map((t) => `<li><a class="sp-row ${t.unread ? 'unread' : ''}" href="#/support/${esc(t.id)}">
        <span class="sp-dot ${t.unread ? '' : 'off'}" ${t.unread ? 'role="img" aria-label="پاسخ جدید"' : 'aria-hidden="true"'}></span>
        <span class="sp-main"><b>${esc(t.subject)}</b><span class="sp-meta"><span>${CATS[t.category] || ''}</span><span>${toFa(t.message_count)} پیام</span><span>${ago(t.updated_at)}</span>${t.priority !== 'normal' ? `<span>اولویت ${PRIOS[t.priority]}</span>` : ''}</span></span>
        ${t.unread ? '<span class="pill ok">پاسخ جدید</span>' : pill(t.status)}</a></li>`).join('')}</ul>`;
    if (r.total > r.per_page) body.appendChild(pager(r, (p) => renderList(page, go, { ...state, page: p })));
  } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.message || 'خطا در دریافت تیکت‌ها')}</div>`; }
}

// ---------------------------------------------------------------- attachments picker
function picker(root) {
  const files = [];
  const box = document.createElement('div');
  const draw = () => {
    box.innerHTML = `<div class="sp-pick">${files.map((f, i) => `<span class="sp-chip">${f.preview ? `<img src="${f.preview}" alt="">` : ICON.receipt}<span>${esc(f.name)}</span><button type="button" data-rm="${i}" aria-label="حذف ${esc(f.name)}">×</button></span>`).join('')}</div>`;
  };
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); draw(); } });
  const input = $('input[type=file]', root);
  input.addEventListener('change', async () => {
    for (const f of [...input.files]) {
      if (files.length >= MAX_FILES) { toast(`حداکثر ${toFa(MAX_FILES)} پیوست مجاز است`, 'err'); break; }
      if (!ACCEPT.includes(f.type)) { toast(`«${f.name}» مجاز نیست؛ فقط تصویر یا PDF`, 'err'); continue; }
      if (f.size > MAX_BYTES) { toast(`«${f.name}» بزرگ‌تر از ۵ مگابایت است`, 'err'); continue; }
      const data_url = await fileToDataUrl(f);
      files.push({ name: f.name, data_url, preview: f.type.startsWith('image/') ? data_url : null });
    }
    input.value = '';
    draw();
  });
  draw();
  return { el: box, get: () => files.map((f) => ({ name: f.name, data_url: f.data_url })), clear: () => { files.length = 0; draw(); } };
}

const ATTACH_FIELD = `<div class="field"><label for="sp-files">پیوست (اختیاری)</label><input id="sp-files" class="input" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" multiple><div class="hint">تا ۳ فایل تصویر یا PDF، هر کدام حداکثر ۵ مگابایت. اطلاعات کارت و رمز را ارسال نکنید.</div><div data-pick></div></div>`;

// ---------------------------------------------------------------- new
function renderNew(page, go) {
  page.innerHTML = `<div class="page-head"><h1>تیکت جدید</h1><div class="actions"><a class="btn btn-ghost" href="#/support">بازگشت</a></div></div>
    <form class="card" id="sp-form" novalidate style="max-width:760px">
      <div class="field"><label for="sp-subject">موضوع</label><input id="sp-subject" class="input" maxlength="120" required><div class="err" data-err="subject"></div></div>
      <div class="grid g2"><div class="field"><label for="sp-cat">دسته</label><select id="sp-cat" class="input select">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="sp-prio">اولویت</label><select id="sp-prio" class="input select">${Object.entries(PRIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><div class="hint">«فوری» را فقط برای توقف کامل پذیرش پرداخت استفاده کنید.</div></div></div>
      <div class="field"><label for="sp-body">شرح مشکل یا سؤال</label><textarea id="sp-body" class="input" rows="7" maxlength="5000" required></textarea><div class="err" data-err="body"></div></div>
      ${ATTACH_FIELD}
      <div class="err" data-err="attachments" role="alert"></div>
      <button class="btn btn-primary" type="submit">ارسال تیکت</button></form>`;
  const pk = picker(page);
  $('[data-pick]', page).replaceWith(pk.el);
  $('#sp-form', page).addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('[data-err]', page).forEach((x) => (x.textContent = ''));
    const btn = $('button[type=submit]', page);
    setBusy(btn, true, 'در حال ارسال…');
    try {
      const r = await api('/api/v2/support/tickets', { method: 'POST', body: { subject: $('#sp-subject', page).value, category: $('#sp-cat', page).value, priority: $('#sp-prio', page).value, body: $('#sp-body', page).value, attachments: pk.get() } });
      toast('تیکت ثبت شد', 'ok');
      go(`/support/${r.ticket.id}`);
    } catch (err) {
      setBusy(btn, false);
      if (err instanceof ApiError && err.body?.errors) for (const [k, v] of Object.entries(err.body.errors)) { const el = $(`[data-err="${k}"]`, page); if (el) el.textContent = v; }
      toast(err.message || 'ثبت تیکت انجام نشد', 'err');
    }
  });
}

// ---------------------------------------------------------------- thread
async function fetchBlobUrl(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.get()}` } });
  if (!res.ok) throw new Error('دریافت فایل ناموفق بود');
  return URL.createObjectURL(await res.blob());
}

function msgHtml(m) {
  const me = m.author_kind === 'store';
  return `<article class="sp-msg ${me ? 'me' : 'admin'}"><div class="sp-who"><b>${esc(me ? m.author_name : 'پشتیبانی بولگرام')}</b><span>${jDateTime(m.created_at)}</span></div>
    <div class="sp-text">${esc(m.body)}</div>
    ${m.attachments.length ? `<div class="sp-atts">${m.attachments.map((a) => `<button type="button" class="sp-att" data-att="${esc(a.url)}" data-name="${esc(a.name)}" data-mime="${esc(a.mime)}" aria-label="باز کردن ${esc(a.name)}">${a.mime.startsWith('image/') ? '<img alt="" data-thumb>' : ICON.receipt}<span>${esc(a.name)}</span></button>`).join('')}</div>` : ''}</article>`;
}

async function renderThread(page, id, go) {
  page.innerHTML = `<div class="page-head"><h1>گفتگوی پشتیبانی</h1><div class="actions"><a class="btn btn-ghost" href="#/support">همهٔ تیکت‌ها</a></div></div><p class="muted">در حال بارگذاری…</p>`;
  let data;
  try { data = await api(`/api/v2/support/tickets/${encodeURIComponent(id)}`); } catch (e) {
    page.innerHTML = `<div class="page-head"><h1>پشتیبانی</h1></div><section class="card">${emptyState('help', 'تیکت پیدا نشد', e.message || '', '<a class="btn btn-primary" href="#/support">بازگشت به تیکت‌ها</a>')}</section>`;
    return;
  }
  const draw = (d) => {
    const t = d.ticket;
    const closed = t.status === 'closed';
    page.innerHTML = `<div class="page-head"><h1>${esc(t.subject)}</h1><div class="actions"><a class="btn btn-ghost" href="#/support">همهٔ تیکت‌ها</a>
        ${closed ? '<button class="btn" id="sp-reopen" type="button">باز کردن دوباره</button>' : '<button class="btn" id="sp-close" type="button">بستن تیکت</button>'}</div></div>
      <section class="card"><div class="sp-top">${pill(t.status)}<span class="muted">${CATS[t.category] || ''}</span><span class="muted">اولویت ${PRIOS[t.priority]}</span><span class="muted">شمارهٔ تیکت: <span class="ltr">${esc(t.id.slice(-8))}</span></span><span class="muted">ایجاد: ${jDateTime(t.created_at)}</span></div>
      <div class="sp-chat" id="sp-chat" aria-live="polite">${d.messages.map(msgHtml).join('')}</div>
      ${closed ? `<div class="alert alert-warn">این تیکت بسته شده است. برای ادامهٔ گفتگو آن را دوباره باز کنید.</div>` : `<form class="sp-reply" id="sp-reply" novalidate>
        <div class="field"><label for="sp-rbody">پاسخ شما</label><textarea id="sp-rbody" class="input" rows="4" maxlength="5000"></textarea><div class="err" data-err="body"></div></div>
        ${ATTACH_FIELD}<div class="err" data-err="attachments" role="alert"></div>
        <button class="btn btn-primary" type="submit">ارسال پاسخ</button></form>`}</section>`;
    // lazy-load image thumbnails with the auth header
    $$('.sp-att', page).forEach(async (b) => {
      const img = $('[data-thumb]', b);
      if (img) { try { img.src = await fetchBlobUrl(b.dataset.att); } catch { img.remove(); } }
    });
    $$('.sp-att', page).forEach((b) => b.addEventListener('click', async () => {
      try {
        const url = await fetchBlobUrl(b.dataset.att);
        const w = window.open(url, '_blank', 'noopener');
        if (!w) { const a = Object.assign(document.createElement('a'), { href: url, download: b.dataset.name }); document.body.appendChild(a); a.click(); a.remove(); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { toast(e.message, 'err'); }
    }));
    const act = (sel, path) => $(sel, page)?.addEventListener('click', async (ev) => {
      setBusy(ev.currentTarget, true);
      try { const r = await api(`/api/v2/support/tickets/${t.id}/${path}`, { method: 'POST', body: {} }); toast(path === 'close' ? 'تیکت بسته شد' : 'تیکت دوباره باز شد', 'ok'); draw({ ticket: r.ticket, messages: d.messages }); }
      catch (e) { setBusy(ev.currentTarget, false); toast(e.message, 'err'); }
    });
    act('#sp-close', 'close');
    act('#sp-reopen', 'reopen');
    const form = $('#sp-reply', page);
    if (form) {
      const pk = picker(form);
      $('[data-pick]', form).replaceWith(pk.el);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        $$('[data-err]', form).forEach((x) => (x.textContent = ''));
        const btn = $('button[type=submit]', form);
        setBusy(btn, true, 'در حال ارسال…');
        try {
          const r = await api(`/api/v2/support/tickets/${t.id}/reply`, { method: 'POST', body: { body: $('#sp-rbody', form).value, attachments: pk.get() } });
          toast('پاسخ ارسال شد', 'ok');
          draw(r);
          $('#sp-chat', page).lastElementChild?.scrollIntoView({ block: 'center' });
        } catch (err) {
          setBusy(btn, false);
          if (err instanceof ApiError && err.body?.errors) for (const [k, v] of Object.entries(err.body.errors)) { const el = $(`[data-err="${k}"]`, form); if (el) el.textContent = v; }
          toast(err.message || 'ارسال انجام نشد', 'err');
        }
      });
    }
  };
  draw(data);
}
