import { faNum, toFa, jDate, jDateTime, ago, esc, emptyState, useStyle, table, pager, $, $$ } from '/panel/assets/js/core.js';
import { oapi, qs, showError, head, pill, storeCell } from '../ui.js';

useStyle('o-hooks', `
.oh-sum{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.oh-spark{display:block;width:120px;height:28px;direction:ltr}
`);

const STATUS = { failed: ['ناموفق', 'bad'], retrying: ['در صف تلاش مجدد', 'warn'] };
const KIND = { store: 'فروشگاه', invoice: 'فاکتور', test: 'آزمایشی', resend: 'ارسال دوباره' };
const st = { tab: 'failures', page: 1, days: 14, upage: 1 };

export async function render(page) {
  page.innerHTML = `${head('وب‌هوک‌های ناموفق')}
    <div class="tabs" role="tablist" aria-label="بخش‌ها">${[['failures', 'ارسال‌های ناموفق'], ['usage', 'مصرف API']].map(([id, t]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${st.tab === id}">${t}</button>`).join('')}</div>
    <div id="oh-body" style="display:grid;gap:14px" role="tabpanel"></div>`;
  const body = $('#oh-body', page);
  const show = () => { $$('[data-tab]', page).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab))); (st.tab === 'failures' ? failures : usage)(body); };
  $$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; show(); }));
  show();
}

async function failures(body) {
  body.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const load = async () => {
    let r;
    try { r = await oapi(`/api/owner/webhooks/failures${qs({ page: st.page, per_page: 20 })}`); } catch (e) { return showError(body, e, load); }
    const k = (t, v) => `<div class="card stat"><b class="num">${faNum(v)}</b><span>${t}</span></div>`;
    body.innerHTML = `<div class="oh-sum">${k('ناموفق در ۲۴ ساعت', r.summary.failed_24h)}${k('موفق در ۲۴ ساعت', r.summary.delivered_24h)}${k('در صف تلاش مجدد', r.summary.pending_retries)}</div>
      <p class="muted" style="margin:0;font-size:.86rem">هر ردیف یک تلاش ناموفقِ ارسال به آدرس وب‌هوک فروشگاه است. «در صف تلاش مجدد» یعنی سیستم دوباره تلاش می‌کند؛ «ناموفق» یعنی این تلاش دیگر تکرار نمی‌شود و فروشنده باید آدرس را بررسی یا دستی ارسال کند.</p>
      <div id="oh-list">${r.data.length ? table([
        { title: 'زمان', cls: 'nowrap', render: (w) => jDateTime(w.created_at) },
        { title: 'فروشگاه', render: (w) => (w.merchant_id ? `<a class="o-link" href="#/stores/${encodeURIComponent(w.merchant_id)}">${storeCell(w)}</a>` : '—') },
        { title: 'رویداد', render: (w) => `<span class="ltr">${esc(w.event)}</span><br><span class="muted" style="font-size:.78rem">${esc(KIND[w.kind] || w.kind)}${w.invoice_id ? ` · <span class="ltr">${esc(w.invoice_id)}</span>` : ''}</span>` },
        { title: 'آدرس', render: (w) => `<span class="ltr o-trunc" title="${esc(w.url)}">${esc(w.url)}</span>` },
        { title: 'نتیجه', render: (w) => `${w.http_status ? `<span class="ltr num">HTTP ${toFa(w.http_status)}</span>` : '<span class="muted">بدون پاسخ</span>'}${w.error ? `<br><span class="muted ltr" style="font-size:.78rem">${esc(String(w.error).slice(0, 120))}</span>` : ''}` },
        { title: 'تلاش', cls: 'num', render: (w) => `${faNum(w.attempt)} از ${faNum(w.max_attempts)}` },
        { title: 'وضعیت', render: (w) => `${pill(STATUS, w.status)}${w.next_retry_at ? `<br><span class="muted" style="font-size:.78rem">تلاش بعدی ${jDateTime(w.next_retry_at)}</span>` : ''}` },
      ], r.data) : `<div class="card">${emptyState('hook', 'وب‌هوک ناموفقی نیست', 'همهٔ وب‌هوک‌ها به مقصد رسیده‌اند.')}</div>`}</div>`;
    if (r.data.length) $('#oh-list', body).appendChild(pager(r, (p) => { st.page = p; load(); }));
  };
  await load();
}

async function usage(body) {
  body.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const load = async () => {
    let r;
    try { r = await oapi(`/api/owner/api-usage${qs({ days: st.days, page: st.upage, per_page: 20 })}`); } catch (e) { return showError(body, e, load); }
    const spark = (days) => {
      const max = Math.max(1, ...days.map((d) => d.calls)), n = days.length;
      const pts = days.map((d, i) => `${((i / Math.max(1, n - 1)) * 100).toFixed(1)},${(26 - (d.calls / max) * 24).toFixed(1)}`).join(' ');
      return `<svg class="oh-spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="روند فراخوانی روزانه"><polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
    };
    body.innerHTML = `<div class="toolbar"><label for="oh-days" class="muted">بازه</label><select class="input select" id="oh-days" style="max-width:200px">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${st.days === d ? 'selected' : ''}>${toFa(d)} روز اخیر</option>`).join('')}</select><span class="muted" style="font-size:.84rem">از ${jDate(r.from)}</span></div>
      <p class="muted" style="margin:0;font-size:.86rem">فراخوانی‌های API نسخهٔ ۱ (کلیدهای نام‌دار و کلید قدیمی) به تفکیک فروشگاه؛ فقط فروشگاه‌هایی که در این بازه فراخوانی داشته‌اند.</p>
      <div id="oh-list">${r.data.length ? table([
        { title: 'فروشگاه', render: (u) => (u.merchant_id ? `<a class="o-link" href="#/stores/${encodeURIComponent(u.merchant_id)}">${storeCell(u)}</a>` : '—') },
        { title: 'فراخوانی', cls: 'num', render: (u) => `<b>${faNum(u.calls)}</b>` },
        { title: 'روند', render: (u) => spark(u.days) },
        { title: 'کلید فعال', cls: 'num', render: (u) => faNum(u.active_keys) },
        { title: 'آخرین استفاده', cls: 'nowrap', render: (u) => (u.last_used_at ? ago(u.last_used_at) : '—') },
      ], r.data) : `<div class="card">${emptyState('plug', 'فراخوانی API ثبت نشده', 'وقتی فروشگاه‌ها با کلید API درخواست بفرستند، مصرفشان اینجا می‌آید.')}</div>`}</div>`;
    $('#oh-days', body).addEventListener('change', (e) => { st.days = Number(e.target.value); st.upage = 1; load(); });
    if (r.data.length) $('#oh-list', body).appendChild(pager(r, (p) => { st.upage = p; load(); }));
  };
  await load();
}
