import { faNum, toFa, toman, jDateTime, ago, esc, emptyState, toast, setBusy, useStyle, copy, table, $, $$ } from '/panel/assets/js/core.js';
import { oapi, errText, showError, head, field, showErrors, clearErrors } from '../ui.js';

useStyle('o-sms', `
.osm-wrap{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
@media (max-width:900px){.osm-wrap{grid-template-columns:1fr}}
.osm-dot{width:12px;height:12px;border-radius:50%;display:inline-block;margin-inline-end:6px;vertical-align:middle}
.osm-sample{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:8px;margin:6px 0 0;max-height:120px;overflow:auto;direction:rtl}
`);

const SAMPLES = [
  ['نمونهٔ واریز ملت', 'Bank Mellat', 'حساب1848394556\nواریز31,500,000\nمانده31,894,014\n05/06/28-13:57'],
  ['نمونهٔ واریز ملی', '700717', 'بانك ملي ايران\nانتقال:25,000,000+\nحساب:10000\nمانده:198,088,329\n0625-19:42'],
  ['نمونهٔ برداشت ملی', '+98700717', 'بانك ملي ايران\nبرداشت:500,000-\nحساب:10000\nمانده:23,488,359\n0705-20:46'],
];
const KIND = { transaction: 'پیامک تراکنشی', sensitive: 'رمز یا کد تأیید', non_transaction: 'غیرتراکنشی', empty: 'خالی' };
const SOURCE = { package: 'نام برنامهٔ اعلان', sender: 'شمارهٔ فرستنده', merchant_trust: 'فرستندهٔ مورد اعتماد فروشگاه', template: 'قالب پیام', text: 'کلمات متن پیام' };

export async function render(page) {
  page.innerHTML = `${head('آزمایشگاه پیامک')}
    <p class="muted" style="margin:0">پیامک بانکی را بچسبانید تا ببینید بولگرام آن را چطور می‌خواند. این بخش چیزی ذخیره نمی‌کند و روی هیچ فاکتوری اثر ندارد.</p>
    <div class="osm-wrap">
      <form class="card" id="sm-form" novalidate>
        <div class="card-head"><h3>پیامک آزمایشی</h3></div>
        <div class="chips" style="margin-bottom:12px">${SAMPLES.map(([t], i) => `<button class="chip" type="button" data-sample="${i}">${t}</button>`).join('')}</div>
        ${field('sender', 'فرستنده (سرشماره یا نام)', '<input class="input ltr" id="f-sender" name="sender" maxlength="60" autocomplete="off" placeholder="Bank Mellat / 700717">')}
        ${field('body', 'متن پیامک', '<textarea class="input" id="f-body" name="body" rows="6" maxlength="2000" placeholder="متن کامل پیامک را اینجا بچسبانید"></textarea>')}
        <button class="btn btn-primary" type="submit" id="sm-go">تحلیل پیامک</button></form>
      <section class="card" aria-live="polite"><div class="card-head"><h3>نتیجه</h3></div><div id="sm-out">${emptyState('phone', 'هنوز تحلیلی انجام نشده', 'یک نمونه را انتخاب کنید یا پیامک خودتان را بچسبانید.')}</div></section>
    </div>
    <section class="card"><div class="card-head"><h3>فرستنده‌های ناشناس (۳۰ روز اخیر)</h3></div>
      <p class="muted" style="margin-top:0;font-size:.86rem">پیامک‌هایی که از فرستندهٔ ناشناس رسیده و در صف بررسی مانده‌اند. اگر چند فروشگاه از یک سرشمارهٔ تازه پیامک واقعی بانک دریافت می‌کنند، همان سرشماره را به فهرست بانک‌ها اضافه کنید.</p>
      <div id="sm-unknown" aria-live="polite"></div></section>`;
  const form = $('#sm-form', page), out = $('#sm-out', page);
  const fill = (sender, body) => { form.elements.sender.value = sender; form.elements.body.value = body; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $$('[data-sample]', page).forEach((b) => b.addEventListener('click', () => { const s = SAMPLES[Number(b.dataset.sample)]; fill(s[1], s[2]); form.requestSubmit(); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const sender = form.elements.sender.value.trim(), body = form.elements.body.value;
    const errors = {};
    if (!sender) errors.sender = 'فرستنده را وارد کنید';
    if (body.trim().length < 3) errors.body = 'متن پیامک را بچسبانید';
    if (Object.keys(errors).length) return showErrors(form, errors);
    const btn = $('#sm-go', page);
    setBusy(btn, true, 'در حال تحلیل…');
    try { show(await oapi('/api/owner/sms-lab', { method: 'POST', body: { sender, body } })); }
    catch (err) { const o = showErrors(form, err.body?.errors || {}); if (o.length || !err.body?.errors) toast(errText(err), 'err'); }
    finally { setBusy(btn, false); }
  });
  const show = (r) => {
    const p = r.parsed, d = r.detail, b = r.bank;
    const ok = p.success && p.trusted;
    const row = (k, v, ltr) => (v === null || v === undefined || v === '' ? '' : `<dt>${k}</dt><dd class="${ltr ? 'ltr num' : ''}">${v}</dd>`);
    out.innerHTML = `<div class="alert ${p.success ? (ok ? 'alert-ok' : 'alert-warn') : 'alert-err'}" role="status" style="margin-bottom:14px"><b>${p.success ? 'خوانده شد' : 'پذیرفته نمی‌شود'}</b> — ${esc(r.verdict)}</div>
      <dl class="kv">
        <dt>نوع پیام</dt><dd>${esc(KIND[d.kind] || d.kind)}</dd>
        <dt>بانک</dt><dd>${b ? `<span class="osm-dot" style="background:${esc(b.color)}" aria-hidden="true"></span>${esc(b.name_fa)}${b.parent ? ` <span class="muted">(تسویه از طریق ${esc(b.parent)})</span>` : ''}` : '<span class="muted">شناسایی نشد</span>'}</dd>
        ${row('روش تشخیص بانک', d.bank_source ? esc(SOURCE[d.bank_source] || d.bank_source) : '')}
        <dt>فرستنده</dt><dd class="ltr">${esc(d.sender_norm || '—')} ${d.sender_trusted ? '<span class="pill ok">معتبر</span>' : '<span class="pill warn">ناشناس</span>'}</dd>
        ${row('جهت', d.direction ? (d.direction === 'credit' ? 'واریز' : 'برداشت') : '')}
        ${row('مبلغ', d.amount_rial ? `${toman(d.amount_rial)} <span class="muted ltr">(${faNum(d.amount_rial)} ریال)</span>` : '')}
        ${row('مانده', d.balance_rial ? toman(d.balance_rial) : '')}
        ${row('حساب', esc(d.account || ''), true)}${row('کارت', esc(d.card || ''), true)}${row('کارت پرداخت‌کننده', esc(d.payer_card || ''), true)}${row('نام پرداخت‌کننده', esc(d.payer_name || ''))}
        ${row('شمارهٔ پیگیری بانک', esc(d.reference || ''), true)}${row('شناسهٔ تراکنش بولگرام', esc(p.trx_id || ''), true)}
        ${row('زمان در پیامک', d.bank_time ? jDateTime(d.bank_time) : '')}${row('قالب پیام', esc(d.template_id || ''), true)}
        <dt>اطمینان</dt><dd class="num">${toFa(Math.round((d.confidence || 0) * 100))}٪</dd>
        ${row('توضیح', esc(d.description || ''))}</dl>
      ${d.problems?.length ? `<h3 style="margin:14px 0 6px">نکته‌ها</h3><ul style="margin:0;padding-inline-start:20px">${d.problems.map((x) => `<li class="ltr" style="direction:ltr;text-align:left">${esc(x)}</li>`).join('')}</ul>` : ''}`;
  };
  // unknown senders
  const box = $('#sm-unknown', page);
  const load = async () => {
    box.innerHTML = '<span class="spinner"></span> در حال بارگذاری…';
    let r;
    try { r = await oapi('/api/owner/sms-lab/unknown-senders'); } catch (e) { return showError(box, e, load); }
    box.innerHTML = r.data.length ? table([
      { title: 'فرستنده', render: (u) => `<span class="ltr"><b>${esc(u.sender || '(بدون فرستنده)')}</b></span>` },
      { title: 'تعداد', cls: 'num', render: (u) => `${faNum(u.count)}<br><span class="muted" style="font-size:.78rem">${faNum(u.devices)} دستگاه</span>` },
      { title: 'آخرین', cls: 'nowrap', render: (u) => (u.last_at ? ago(u.last_at) : '—') },
      { title: 'حدس بانک', render: (u) => (u.bank_guess ? `${esc(u.bank_guess.name_fa)}` : '<span class="muted">—</span>') },
      { title: 'نمونه', render: (u) => `<pre class="osm-sample">${esc(u.sample)}</pre><span style="display:inline-flex;gap:6px;margin-top:6px"><button class="btn btn-sm" type="button" data-try="${esc(u.sender)}">آزمایش در آزمایشگاه</button></span>` },
    ], r.data) : emptyState('check', 'فرستندهٔ ناشناسی نیست', 'در ۳۰ روز گذشته پیامکی از فرستندهٔ ناشناس در صف بررسی نمانده است.');
    const bySender = Object.fromEntries(r.data.map((u) => [u.sender, u]));
    $$('[data-try]', box).forEach((b) => b.addEventListener('click', () => { const u = bySender[b.dataset.try]; fill(u.sender, u.sample); form.requestSubmit(); }));
  };
  void copy;
  await load();
}
