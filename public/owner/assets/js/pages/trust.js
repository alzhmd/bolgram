import { faNum, jDateTime, esc, emptyState, toast, confirmDialog, setBusy, useStyle, debounce, table, pager, ICON, $, $$ } from '/panel/assets/js/core.js';
import { oapi, ofile, qs, errText, showError, head, pill, storeLink, field, showErrors, clearErrors } from '../ui.js';

useStyle('o-trust', `
.otr-docs{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.otr-doc{border:1px solid var(--border);border-radius:14px;padding:10px;display:grid;gap:8px;background:var(--surface-2);min-width:0}
.otr-doc img{width:100%;max-height:240px;object-fit:contain;border-radius:10px;background:var(--bg)}
.otr-doc b{overflow-wrap:anywhere}
`);

const STATUS = { pending: ['در انتظار بررسی', 'warn'], approved: ['تأییدشده', 'ok'], rejected: ['ردشده', 'bad'], draft: ['پیش‌نویس', ''] };
const TYPE = { individual: 'شخص حقیقی', company: 'شرکت یا شخص حقوقی' };
const KIND = { national_card: 'کارت ملی', business_license: 'روزنامهٔ رسمی / جواز کسب', other: 'سایر مدارک' };
const st = { status: 'pending', q: '', page: 1 };

export async function render(page, { sub, go }) {
  if (sub[0]) return detail(page, sub[0], go);
  page.innerHTML = `${head('نماد اعتماد')}
    <div class="toolbar"><div class="seg" role="group" aria-label="وضعیت" id="tr-f"></div>
      <label class="sr-only" for="tr-q">جستجو</label><input class="input grow" id="tr-q" type="search" placeholder="جستجو: نام کسب‌وکار، فروشگاه یا موبایل" value="${esc(st.q)}" autocomplete="off"></div>
    <div id="tr-list" aria-live="polite"></div>`;
  const list = $('#tr-list', page);
  const seg = $('#tr-f', page);
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/trust${qs({ status: st.status, q: st.q, page: st.page, per_page: 20 })}`); } catch (e) { return showError(list, e, load); }
    seg.innerHTML = [['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده']].map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${st.status === v}">${t} (${faNum(r.counts[v] || 0)})</button>`).join('') + `<button type="button" data-f="" aria-pressed="${st.status === ''}">همه</button>`;
    $$('[data-f]', seg).forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; st.page = 1; load(); }));
    list.innerHTML = r.data.length ? table([
      { title: 'کسب‌وکار', render: (t) => `<a class="o-link" href="#/trust/${encodeURIComponent(t.merchant_id)}"><b>${esc(t.business_name || '—')}</b></a><br><span class="muted" style="font-size:.78rem">${esc(TYPE[t.business_type] || '')} · ${esc(t.owner_name || '')}</span>` },
      { title: 'فروشگاه', render: (t) => (t.store ? `${esc(t.store.name || t.store.handle)}<br><span class="muted ltr" style="font-size:.78rem">@${esc(t.store.handle || '')}</span>` : '—') },
      { title: 'وضعیت', render: (t) => pill(STATUS, t.status) },
      { title: 'ارسال', cls: 'nowrap', render: (t) => (t.submitted_at ? jDateTime(t.submitted_at) : '—') },
      { title: 'تصمیم', cls: 'nowrap', render: (t) => (t.decided_at ? jDateTime(t.decided_at) : '—') },
    ], r.data, { rowAttr: (t) => `data-id="${esc(t.merchant_id)}"` }) : `<div class="card">${emptyState('shield', 'درخواستی نیست', st.status === 'pending' ? 'درخواست بررسی‌نشده‌ای وجود ندارد.' : 'با این فیلتر درخواستی پیدا نشد.')}</div>`;
    list.appendChild(pager(r, (p) => { st.page = p; load(); }));
    $$('tr[data-id]', list).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) go(`/trust/${encodeURIComponent(tr.dataset.id)}`); }));
  };
  $('#tr-q', page).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350));
  await load();
}

async function detail(page, mid, go) {
  const urls = [];
  const load = async () => {
    let r;
    try { r = await oapi(`/api/owner/trust/${encodeURIComponent(mid)}`); } catch (e) { return showError(page, e, load); }
    const q = r.request, s = r.store, docs = q.documents || [];
    const row = (k, v, ltr) => (v ? `<dt>${k}</dt><dd class="${ltr ? 'ltr num' : ''}">${esc(v)}</dd>` : '');
    page.innerHTML = `<div><a href="#/trust" class="btn btn-sm btn-ghost">${ICON.chev} بازگشت به درخواست‌ها</a></div>
      <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>${esc(q.business_name || 'درخواست نماد اعتماد')}</h2>${pill(STATUS, q.status)}</div>
        <dl class="kv"><dt>فروشگاه</dt><dd>${storeLink(s.id, s.name || s.handle)} <span class="muted ltr">@${esc(s.handle || '')}</span></dd>
          ${row('موبایل فروشگاه', s.phone, true)}${row('ایمیل', s.email, true)}
          <dt>نوع</dt><dd>${esc(TYPE[q.business_type] || q.business_type)}</dd>${row('نام مالک', q.owner_name)}${row('کد ملی', q.national_code, true)}${row('شناسهٔ ملی شرکت', q.company_national_id, true)}
          ${row('وب‌سایت', q.website, true)}${row('اینستاگرام', q.instagram, true)}${row('تلفن', q.phone, true)}${row('نشانی', q.address)}
          <dt>ارسال</dt><dd>${q.submitted_at ? jDateTime(q.submitted_at) : '—'}</dd>${q.decided_at ? `<dt>تصمیم</dt><dd>${jDateTime(q.decided_at)}</dd>` : ''}${row('یادداشت تصمیم', q.note)}</dl></section>
      <section class="card"><div class="card-head"><h3>مدارک</h3></div>
        ${docs.length ? `<div class="otr-docs">${docs.map((d, i) => `<div class="otr-doc" data-doc="${i}"><b>${esc(KIND[d.kind] || d.kind)}</b><span class="muted" style="font-size:.8rem">${esc(d.name || '')}</span><div data-slot><span class="spinner"></span></div></div>`).join('')}</div>` : '<p class="muted">مدرکی بارگذاری نشده است.</p>'}</section>
      ${q.status === 'draft' ? '' : `<form class="card" id="tr-decide" novalidate><div class="card-head"><h3>تصمیم</h3></div>
        <p class="muted" style="margin-top:0">${q.status === 'approved' ? 'این درخواست تأیید شده است؛ ردِ آن، نشان اعتماد را برمی‌دارد.' : 'تأیید، نشان «نماد اعتماد بولگرام» را برای این فروشگاه فعال می‌کند.'}</p>
        ${field('note', 'یادداشت (برای رد الزامی است)', '<textarea class="input" id="f-note" name="note" rows="3" maxlength="500"></textarea>', 'فروشنده این یادداشت را می‌بیند')}
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-green" type="button" data-d="1">${q.status === 'approved' ? 'تأیید مجدد' : 'تأیید نماد'}</button><button class="btn btn-danger" type="button" data-d="0">رد درخواست</button></div></form>`}`;
    $$('[data-doc]', page).forEach(async (el) => {
      const d = docs[Number(el.dataset.doc)], slot = $('[data-slot]', el);
      try {
        const blob = await ofile(d.url);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        slot.innerHTML = (d.mime || blob.type).startsWith('image/') ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(KIND[d.kind] || d.kind)}"></a>` : `<a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">باز کردن فایل</a>`;
      } catch (e) { slot.textContent = `بارگذاری نشد: ${errText(e)}`; }
    });
    const form = $('#tr-decide', page);
    form?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      clearErrors(form);
      const approved = b.dataset.d === '1';
      const note = form.elements.note.value.trim();
      if (!approved && note.length < 3) return showErrors(form, { note: 'برای رد درخواست، دلیل را بنویسید (حداقل ۳ نویسه)' });
      if (!(await confirmDialog(approved ? 'تأیید نماد اعتماد' : 'رد درخواست', approved ? 'نشان اعتماد برای این فروشگاه فعال می‌شود و فروشنده مطلع می‌شود.' : 'درخواست رد می‌شود و فروشنده دلیل را می‌بیند.', approved ? 'تأیید' : 'رد درخواست', !approved))) return;
      setBusy(b, true);
      try {
        await oapi(`/api/owner/trust/${encodeURIComponent(mid)}/decide`, { method: 'POST', body: { approved, ...(note ? { note } : {}) } });
        toast(approved ? 'نماد اعتماد تأیید شد' : 'درخواست رد شد', 'ok');
        urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
        load();
      } catch (err) { setBusy(b, false); const o = showErrors(form, err.body?.errors || {}); if (o.length || !err.body?.errors) toast(errText(err), 'err'); }
    });
  };
  await load();
  void go;
}
