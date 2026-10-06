import { faNum, toFa, jDateTime, ago, esc, emptyState, toast, setBusy, useStyle, debounce, fileToDataUrl, table, pager, ICON, $, $$ } from '/panel/assets/js/core.js';
import { oapi, ofile, qs, errText, showError, head, pill, storeLink, TICKET_STATUS, PRIORITY, CATEGORY, showErrors, clearErrors } from '../ui.js';

useStyle('o-tickets', `
.ot-stats{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.ot-msg{max-width:min(640px,100%);border:1px solid var(--border);border-radius:14px;padding:10px 14px;background:var(--surface-2);overflow-wrap:anywhere;white-space:pre-wrap}
.ot-row{display:flex}.ot-row.admin{justify-content:flex-end}
.ot-row.admin .ot-msg{background:var(--brand-soft);border-color:transparent}
.ot-meta{font-size:.78rem;color:var(--muted);margin-bottom:4px}
.ot-att{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;white-space:normal}
.ot-att img{max-width:160px;max-height:120px;border-radius:10px;border:1px solid var(--border);display:block}
.ot-thread{display:grid;gap:12px}
.ot-files{font-size:.84rem}
`);

const FILTERS = [['active', 'فعال'], ['open', 'منتظر پاسخ'], ['waiting', 'در حال بررسی'], ['answered', 'پاسخ‌داده‌شده'], ['closed', 'بسته‌شده'], ['', 'همه']];
const st = { status: 'active', q: '', page: 1 };
const dur = (s) => (s < 3600 ? `${toFa(Math.max(1, Math.round(s / 60)))} دقیقه` : s < 86400 ? `${toFa(Math.round(s / 3600))} ساعت` : `${toFa(Math.round(s / 86400))} روز`);

export async function render(page, { sub, query, go }) {
  if (sub[0]) return thread(page, sub[0], go);
  if (query.get('q') !== null) { st.q = query.get('q') || ''; st.status = ''; st.page = 1; }
  page.innerHTML = `${head('تیکت‌ها')}<div id="tk-stats" class="ot-stats"></div>
    <div class="toolbar"><div class="seg" role="group" aria-label="وضعیت">${FILTERS.map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${st.status === v}">${t}</button>`).join('')}</div>
      <label class="sr-only" for="tk-q">جستجو</label><input class="input grow" id="tk-q" type="search" placeholder="جستجو: موضوع، شناسه، آیدی یا موبایل فروشگاه" value="${esc(st.q)}" autocomplete="off"></div>
    <div id="tk-list" aria-live="polite"></div>`;
  oapi('/api/owner/tickets/stats').then((s) => {
    const k = (t, v) => `<div class="card stat"><b class="num">${v}</b><span>${t}</span></div>`;
    $('#tk-stats', page).innerHTML = k('منتظر پاسخ', faNum(s.open)) + k('در حال بررسی', faNum(s.waiting)) + k('پاسخ‌داده‌شده', faNum(s.answered)) + k('بسته‌شده', faNum(s.closed)) + k('میانگین اولین پاسخ', s.avg_first_response_seconds == null ? '—' : dur(s.avg_first_response_seconds));
  }).catch(() => { $('#tk-stats', page).remove(); });
  const list = $('#tk-list', page);
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/tickets${qs({ status: st.status, q: st.q, page: st.page, per_page: 20 })}`); } catch (e) { return showError(list, e, load); }
    list.innerHTML = r.data.length ? table([
      { title: 'موضوع', render: (t) => `<a class="o-link" href="#/tickets/${encodeURIComponent(t.id)}"><b>${esc(t.subject)}</b></a>${t.unread ? ' <span class="pill warn">جدید</span>' : ''}<br><span class="muted" style="font-size:.78rem">${esc(CATEGORY[t.category] || t.category)} · ${faNum(t.message_count)} پیام</span>` },
      { title: 'فروشگاه', render: (t) => (t.store ? `<b>${esc(t.store.name || t.store.handle)}</b><br><span class="muted ltr" style="font-size:.78rem">@${esc(t.store.handle || '')}</span>` : '—') },
      { title: 'اولویت', render: (t) => pill(PRIORITY, t.priority) },
      { title: 'وضعیت', render: (t) => pill(TICKET_STATUS, t.status) },
      { title: 'آخرین فعالیت', cls: 'nowrap', render: (t) => `${ago(t.last_reply_at || t.updated_at)}${t.waiting_seconds ? `<br><span class="muted" style="font-size:.78rem">منتظر ${dur(t.waiting_seconds)}</span>` : ''}` },
    ], r.data, { rowAttr: (t) => `data-id="${esc(t.id)}"` }) : `<div class="card">${emptyState('inbox', 'تیکتی نیست', st.q || st.status ? 'فیلترها را تغییر دهید.' : 'وقتی فروشنده‌ای پیام بفرستد، اینجا دیده می‌شود.')}</div>`;
    list.appendChild(pager(r, (p) => { st.page = p; load(); }));
    $$('tr[data-id]', list).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) go(`/tickets/${encodeURIComponent(tr.dataset.id)}`); }));
  };
  $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; st.page = 1; $$('[data-f]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  $('#tk-q', page).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350));
  await load();
}

async function thread(page, id, go) {
  const urls = [];
  const load = async () => {
    let r;
    try { r = await oapi(`/api/owner/tickets/${encodeURIComponent(id)}`); } catch (e) { return showError(page, e, load); }
    const t = r.ticket, s = r.store;
    page.innerHTML = `<div><a href="#/tickets" class="btn btn-sm btn-ghost">${ICON.chev} بازگشت به تیکت‌ها</a></div>
      <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2 style="min-width:0;overflow-wrap:anywhere">${esc(t.subject)}</h2>${pill(TICKET_STATUS, t.status)} ${pill(PRIORITY, t.priority)}</div>
        <dl class="kv"><dt>فروشگاه</dt><dd>${storeLink(s.id, s.name || s.handle)} <span class="muted ltr">@${esc(s.handle || '')}</span></dd><dt>تماس</dt><dd><span class="ltr num">${esc(s.phone || '—')}</span>${s.email ? ` · <span class="ltr">${esc(s.email)}</span>` : ''}</dd>
          <dt>پلن</dt><dd>${esc(s.plan || '—')}${s.status === 'SUSPENDED' ? ' <span class="pill bad">معلق</span>' : ''}</dd><dt>دسته</dt><dd>${esc(CATEGORY[t.category] || t.category)}</dd><dt>ثبت</dt><dd>${jDateTime(t.created_at)}</dd></dl>
        <div class="toolbar" style="margin-top:12px"><label for="tk-st" class="muted">وضعیت</label><select class="input select" id="tk-st">${Object.entries(TICKET_STATUS).map(([v, [n]]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <label for="tk-pr" class="muted">اولویت</label><select class="input select" id="tk-pr">${Object.entries(PRIORITY).map(([v, [n]]) => `<option value="${v}" ${t.priority === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></section>
      <section class="ot-thread" aria-label="گفتگو">${r.messages.map((m) => `<div class="ot-row ${m.author_kind === 'admin' ? 'admin' : ''}"><div class="ot-msg"><div class="ot-meta">${esc(m.author_name || (m.author_kind === 'admin' ? 'پشتیبانی' : 'فروشنده'))} · ${jDateTime(m.created_at)}</div>${esc(m.body)}${m.attachments?.length ? `<div class="ot-att">${m.attachments.map((a) => `<span data-att="${esc(a.url)}" data-name="${esc(a.name || a.file)}" data-mime="${esc(a.mime || '')}"></span>`).join('')}</div>` : ''}</div></div>`).join('')}</section>
      <form class="card" id="tk-reply" novalidate><div class="card-head"><h3>پاسخ به فروشنده</h3></div>
        <div class="field"><label for="f-body">متن پاسخ</label><textarea class="input" id="f-body" name="body" rows="4" maxlength="5000"></textarea><span class="err" data-err="body" role="alert"></span></div>
        <div class="field"><label for="f-files">پیوست (حداکثر ۳ تصویر یا PDF)</label><input class="input" id="f-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf"><span class="err" data-err="attachments" role="alert"></span></div>
        <button class="btn btn-primary" type="submit" id="tk-send">ارسال پاسخ</button></form>`;
    // attachments need the owner token: fetch as blobs
    $$('[data-att]', page).forEach(async (el) => {
      const mime = el.dataset.mime, name = el.dataset.name;
      try {
        const url = URL.createObjectURL(await ofile(el.dataset.att));
        urls.push(url);
        el.innerHTML = mime.startsWith('image/') ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(name)}"></a>` : `<a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">${esc(name)}</a>`;
      } catch { el.textContent = `${name} (بارگذاری نشد)`; }
    });
    const patch = async (body) => {
      try { await oapi(`/api/owner/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body }); toast('ذخیره شد', 'ok'); } catch (e) { toast(errText(e), 'err'); load(); }
    };
    $('#tk-st', page).addEventListener('change', (e) => patch({ status: e.target.value }));
    $('#tk-pr', page).addEventListener('change', (e) => patch({ priority: e.target.value }));
    const form = $('#tk-reply', page);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const body = form.elements.body.value.trim();
      if (body.length < 2) return showErrors(form, { body: 'متن پاسخ را بنویسید' });
      const files = [...$('#f-files', form).files];
      if (files.length > 3) return showErrors(form, { attachments: 'حداکثر ۳ پیوست مجاز است' });
      const btn = $('#tk-send', form);
      setBusy(btn, true, 'در حال ارسال…');
      try {
        const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, data_url: await fileToDataUrl(f) })));
        await oapi(`/api/owner/tickets/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body, ...(attachments.length ? { attachments } : {}) } });
        toast('پاسخ ارسال شد', 'ok');
        urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
        load();
      } catch (err) {
        setBusy(btn, false);
        const orphan = showErrors(form, err.body?.errors || {});
        if (orphan.length || !err.body?.errors) toast(errText(err), 'err');
      }
    });
  };
  await load();
  void go;
}
