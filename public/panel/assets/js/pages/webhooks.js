import { api, esc, toFa, faNum, jDateTime, toast, modal, confirmDialog, setBusy, copy, table, pager, emptyState, useStyle, ICON, $, $$ } from '../core.js';

useStyle('webhooks', `
.wh-secret{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wh-secret .code{flex:1;min-width:0;padding:10px 12px;overflow-wrap:anywhere;white-space:pre-wrap}
.wh-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.wh-stats>div{background:var(--surface-2);border-radius:12px;padding:10px 12px}
.wh-stats b{display:block;font-size:1.3rem}
.wh-docs h4{margin:18px 0 6px}
.wh-docs table{width:100%;border-collapse:collapse;font-size:.88rem}
.wh-docs td,.wh-docs th{padding:6px 8px;border-bottom:1px solid var(--border);text-align:start;vertical-align:top}
.wh-docs code{direction:ltr;unicode-bidi:isolate;background:var(--surface-2);padding:1px 6px;border-radius:6px}
.wh-url{direction:ltr;overflow-wrap:anywhere;font-size:.82rem}
.wh-result{margin-top:10px}
.wh-pre{max-height:240px;overflow:auto;margin:0 0 12px}
@media(max-width:560px){.wh-stats{grid-template-columns:1fr 1fr 1fr;gap:6px}.wh-stats b{font-size:1.05rem}}
`);

const PAYLOAD = `{
  "event": "invoice.paid",
  "invoice_id": "PFM3K9X2AB12",
  "status": "true",
  "provider": "mellat",
  "trx_id": "IR3F9A12",
  "amount": 4500280,
  "timestamp": "2026-10-06T10:22:31.000Z",
  "metadata": { "order_id": "1042" }
}`;

const SAMPLES = {
  php: `<?php
$secret = 'whsec_...';                       // کلید بالای همین صفحه
$body   = file_get_contents('php://input');   // بدنهٔ خام، قبل از json_decode
$header = $_SERVER['HTTP_X_BOLGRAM_SIGNATURE'] ?? '';

preg_match('/t=(\\d+)/', $header, $m);
preg_match_all('/v1=([0-9a-f]+)/', $header, $s);
$t = (int)($m[1] ?? 0);
if (!$t || abs(time() - $t) > 300) { http_response_code(400); exit; }

$expected = hash_hmac('sha256', $t . '.' . $body, $secret);
$valid = false;
foreach ($s[1] as $sig) { if (hash_equals($expected, $sig)) { $valid = true; } }
if (!$valid) { http_response_code(401); exit; }

$event = json_decode($body, true);
$delivery = $_SERVER['HTTP_X_BOLGRAM_DELIVERY'];
// اگر $event['invoice_id'] قبلاً تحویل شده، فقط 200 بدهید
http_response_code(200);`,
  node: `const crypto = require('crypto');
const express = require('express');
const app = express();
const SECRET = process.env.BOLGRAM_WEBHOOK_SECRET;

app.post('/hooks/bolgram', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-Bolgram-Signature') || '';
  const t = Number(/t=(\\d+)/.exec(header)?.[1]);
  const sigs = [...header.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return res.sendStatus(400);

  const expected = crypto.createHmac('sha256', SECRET).update(t + '.' + req.body.toString('utf8')).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString('utf8'));
  // با event.invoice_id یا هدر X-Bolgram-Delivery تکراری‌ها را نادیده بگیرید
  res.sendStatus(200);
});`,
  python: `import hmac, hashlib, re, time
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = 'whsec_...'

@app.post('/hooks/bolgram')
def bolgram_hook():
    body = request.get_data()                       # بایت‌های خام
    header = request.headers.get('X-Bolgram-Signature', '')
    t = re.search(r't=(\\d+)', header)
    sigs = re.findall(r'v1=([0-9a-f]+)', header)
    if not t or abs(time.time() - int(t.group(1))) > 300:
        abort(400)
    expected = hmac.new(SECRET.encode(), t.group(1).encode() + b'.' + body, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in sigs):
        abort(401)
    event = request.get_json()
    # event['invoice_id'] را فقط یک‌بار پردازش کنید
    return '', 200`,
};

const STATUS = { delivered: ['ok', 'تحویل شد'], failed: ['bad', 'ناموفق'], retrying: ['warn', 'در صف تلاش مجدد'] };
const FILTERS = [['all', 'همه'], ['delivered', 'موفق'], ['failed', 'ناموفق'], ['pending', 'در صف تلاش مجدد']];
const dur = (s) => (s >= 3600 ? `${faNum(s / 3600)} ساعت` : s >= 60 ? `${faNum(s / 60)} دقیقه` : `${faNum(s)} ثانیه`);
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || ''; } };

export async function render(page, { me, actor, query, sub, go } = {}) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const st = await api('/api/v2/webhooks/settings');
  const state = { status: 'all', page: 1, sample: 'php' };

  page.innerHTML = `
    <div class="page-head"><h1>وب‌هوک</h1></div>
    <p class="muted" style="margin:0">با هر پرداخت تأییدشده، بولگرام یک درخواست امضاشده به سرور شما می‌فرستد تا سفارش به‌صورت خودکار تحویل شود. اگر سرور شما پاسخ ۲xx ندهد، ارسال دوباره تکرار می‌شود.</p>
    <div class="grid g2">
      <section class="card"><div class="card-head"><h3>آدرس وب‌هوک</h3></div>
        <form id="wh-form" novalidate>
          <div class="field"><label for="wh-url">آدرس دریافت رویداد</label>
            <input class="input ltr" id="wh-url" type="url" inputmode="url" dir="ltr" maxlength="500" placeholder="https://shop.example/hooks/bolgram" value="${esc(st.webhook_url)}" aria-describedby="wh-url-hint wh-url-err">
            <div class="hint" id="wh-url-hint">باید https باشد (فقط در توسعه، http روی localhost). آدرس‌های شبکهٔ داخلی پذیرفته نمی‌شوند. فاکتورهایی که webhook_url خودشان را دارند، به همان آدرس می‌روند.</div>
            <div class="err" id="wh-url-err" role="alert"></div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" type="submit">ذخیره</button>
            <button class="btn" type="button" id="wh-test" ${st.webhook_url ? '' : 'disabled'}>${ICON.bolt} ارسال آزمایشی</button>
          </div>
          <div class="wh-result" id="wh-result" aria-live="polite"></div>
        </form>
      </section>
      <section class="card"><div class="card-head"><h3>کلید امضا</h3><span class="pill ${st.secret.kind === 'custom' ? 'ok' : ''}" style="margin-inline-start:auto">${st.secret.kind === 'custom' ? 'اختصاصی' : 'پیش‌فرض'}</span></div>
        <div class="wh-secret"><div class="code" id="wh-secret" aria-label="کلید امضا">${esc(st.secret.masked)}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-sm" type="button" id="sec-reveal">${ICON.eye} نمایش</button>
          <button class="btn btn-sm" type="button" id="sec-copy" disabled>کپی</button>
          <button class="btn btn-sm btn-danger" type="button" id="sec-rotate">چرخش کلید</button>
        </div>
        <p class="muted" id="sec-note" style="margin:10px 0 0;font-size:.85rem">${st.secret.previous_valid_until
          ? `کلید قبلی تا ${esc(jDateTime(st.secret.previous_valid_until))} هم معتبر است و هر ارسال با هر دو کلید امضا می‌شود.`
          : 'کلید را فقط سمت سرور نگه دارید. با «چرخش کلید» کلید جدید ساخته می‌شود و کلید قبلی ۲۴ ساعت هم معتبر می‌ماند.'}</p>
      </section>
    </div>
    <div class="wh-stats" role="group" aria-label="آمار ۲۴ ساعت اخیر">
      <div><span class="muted">موفق (۲۴ ساعت)</span><b class="num">${faNum(st.stats.delivered_24h)}</b></div>
      <div><span class="muted">ناموفق (۲۴ ساعت)</span><b class="num">${faNum(st.stats.failed_24h)}</b></div>
      <div><span class="muted">در صف تلاش مجدد</span><b class="num">${faNum(st.stats.pending_retries)}</b></div>
    </div>
    <section class="card"><div class="card-head"><h3>سابقهٔ ارسال</h3>
      <div class="seg" role="group" aria-label="فیلتر وضعیت" style="margin-inline-start:auto">${FILTERS.map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${v === 'all'}">${t}</button>`).join('')}</div></div>
      <div id="wh-list" aria-live="polite"></div></section>
    <details class="card wh-docs"><summary style="cursor:pointer;font-weight:700">راهنمای دریافت و تأیید وب‌هوک</summary>
      <h4>نمونهٔ بدنه</h4><pre class="code">${esc(PAYLOAD)}</pre>
      <p class="muted" style="font-size:.85rem">مبلغ <code>amount</code> به ریال و برابر مبلغ یکتای واریزشده است. <code>metadata</code> همان است که هنگام ساخت فاکتور فرستاده‌اید. رویداد آزمایشی <code>ping</code> با <code>status: "false"</code> می‌آید و هرگز به‌معنی پرداخت نیست.</p>
      <h4>هدرها</h4>
      <table><tbody>
        <tr><td><code>X-Bolgram-Signature</code></td><td><code>t=&lt;unix&gt;,v1=&lt;hex&gt;</code>؛ مقدار v1 برابر HMAC-SHA256 با کلید امضا روی رشتهٔ <code>t + "." + body</code>. در ۲۴ ساعت بعد از چرخش کلید، دو <code>v1</code> می‌آید؛ یکی کافی است.</td></tr>
        <tr><td><code>X-Bolgram-Delivery</code></td><td>شناسهٔ یکتای ارسال؛ در تلاش‌های مجدد همان است.</td></tr>
        <tr><td><code>X-Bolgram-Invoice-Id</code></td><td>شناسهٔ فاکتور.</td></tr>
        <tr><td><code>X-Bolgram-Event</code></td><td>نوع رویداد: <code>invoice.paid</code> یا <code>ping</code>.</td></tr>
      </tbody></table>
      <h4>تأیید امضا</h4>
      <div class="seg" role="group" aria-label="زبان نمونه کد" style="margin-bottom:8px">${[['php', 'PHP'], ['node', 'Node.js'], ['python', 'Python']].map(([v, t]) => `<button type="button" data-s="${v}" aria-pressed="${v === 'php'}">${t}</button>`).join('')}</div>
      <div style="position:relative"><button class="btn btn-sm" type="button" id="smp-copy" style="position:absolute;inset-block-start:8px;inset-inline-end:8px">کپی</button><pre class="code" id="smp"></pre></div>
      <h4>سیاست تلاش مجدد</h4>
      <p>اگر پاسخ ۲xx نرسد یا پاسخی در ۸ ثانیه نیاید، تا ${faNum(st.retry_policy.max_attempts)} بار تلاش می‌شود؛ فاصله‌ها بعد از هر شکست: ${st.retry_policy.delays_seconds.map(dur).join('، ')} (در مجموع حدود ۲۳ ساعت). ریدایرکت دنبال نمی‌شود. تلاش‌ها بعد از راه‌اندازی دوباره سرور هم ادامه پیدا می‌کنند و هر ارسال را می‌توانید از سابقه دستی دوباره بفرستید.</p>
      <h4>ایدمپوتنت باشید</h4>
      <ul><li>ممکن است یک رویداد بیش از یک‌بار برسد؛ <code>invoice_id</code> یا <code>X-Bolgram-Delivery</code> را ذخیره کنید و تکراری را فقط با ۲۰۰ پاسخ بدهید.</li><li>قبل از تحویل سفارش، مبلغ و وضعیت را با <code>POST /v1/payment/verify</code> هم بسنجید.</li><li>بدنهٔ خام را امضا کنید، نه JSON بازسازی‌شده.</li><li>درخواست‌های با اختلاف زمان بیش از ۵ دقیقه را رد کنید.</li></ul>
    </details>`;

  // --- settings form
  const urlInp = $('#wh-url', page), urlErr = $('#wh-url-err', page);
  $('#wh-form', page).addEventListener('submit', async (e) => {
    e.preventDefault();
    urlErr.textContent = ''; urlInp.removeAttribute('aria-invalid');
    const btn = $('button[type=submit]', page);
    setBusy(btn, true, 'در حال ذخیره…');
    try {
      const r = await api('/api/v2/webhooks/settings', { method: 'PUT', body: { webhook_url: urlInp.value.trim() } });
      urlInp.value = r.webhook_url;
      $('#wh-test', page).disabled = !r.webhook_url;
      toast(r.webhook_url ? 'آدرس وب‌هوک ذخیره شد' : 'وب‌هوک غیرفعال شد', 'ok');
    } catch (err) {
      urlErr.textContent = err.body?.errors?.webhook_url || err.message; urlInp.setAttribute('aria-invalid', 'true'); urlInp.focus();
    } finally { setBusy(btn, false); }
  });
  $('#wh-test', page).addEventListener('click', async (e) => {
    const btn = e.currentTarget, out = $('#wh-result', page);
    setBusy(btn, true, 'در حال ارسال…');
    try {
      const r = await api('/api/v2/webhooks/test', { method: 'POST' });
      const d = r.delivery;
      out.innerHTML = r.ok
        ? `<div class="alert alert-ok">ارسال موفق بود · پاسخ ${toFa(d.http_status)} در ${toFa(d.duration_ms)} میلی‌ثانیه</div>`
        : `<div class="alert alert-err">ارسال ناموفق: ${esc(d.error || '')}${d.http_status ? ` (پاسخ ${toFa(d.http_status)})` : ''}</div>`;
      loadList();
    } catch (err) { out.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`; }
    finally { setBusy(btn, false); }
  });

  // --- secret
  let revealed = null;
  $('#sec-reveal', page).addEventListener('click', async (e) => {
    const box = $('#wh-secret', page);
    if (revealed) { revealed = null; box.textContent = st.secret.masked; e.currentTarget.innerHTML = `${ICON.eye} نمایش`; $('#sec-copy', page).disabled = true; return; }
    try {
      const r = await api('/api/v2/webhooks/secret');
      revealed = r.secret; box.textContent = r.secret; e.currentTarget.innerHTML = 'پنهان کردن'; $('#sec-copy', page).disabled = false;
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#sec-copy', page).addEventListener('click', (e) => revealed && copy(revealed, e.currentTarget));
  $('#sec-rotate', page).addEventListener('click', async () => {
    const ok = await confirmDialog('چرخش کلید امضا', 'کلید جدید ساخته می‌شود. کلید فعلی تا ۲۴ ساعت دیگر هم معتبر می‌ماند؛ در این مدت کلید جدید را در سرور خود بگذارید.', 'ساخت کلید جدید', true);
    if (!ok) return;
    try { await api('/api/v2/webhooks/rotate-secret', { method: 'POST' }); toast('کلید جدید ساخته شد', 'ok'); render(page, { me, actor, query, sub, go }); }
    catch (err) { toast(err.message, 'err'); }
  });

  // --- docs samples
  const showSample = () => { $('#smp', page).textContent = SAMPLES[state.sample]; };
  showSample();
  $$('[data-s]', page).forEach((b) => b.addEventListener('click', () => { state.sample = b.dataset.s; $$('[data-s]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); showSample(); }));
  $('#smp-copy', page).addEventListener('click', (e) => copy(SAMPLES[state.sample], e.currentTarget));

  // --- deliveries
  const listEl = $('#wh-list', page);
  async function loadList() {
    listEl.innerHTML = '<div style="padding:16px"><span class="spinner"></span></div>';
    let r;
    try { r = await api(`/api/v2/webhooks/deliveries?status=${state.status}&page=${state.page}`); }
    catch (err) { listEl.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`; return; }
    if (!r.total && state.status === 'all') {
      listEl.innerHTML = emptyState('hook', 'هنوز ارسالی ثبت نشده', st.webhook_url ? 'با «ارسال آزمایشی» اتصال را بسنجید؛ با اولین پرداخت تأییدشده، ارسال واقعی هم اینجا ثبت می‌شود.' : 'آدرس وب‌هوک را ذخیره کنید؛ بعد از آن هر ارسال و پاسخ سرور شما اینجا دیده می‌شود.');
      return;
    }
    listEl.innerHTML = table([
      { title: 'وضعیت', render: (d) => `<span class="pill ${STATUS[d.status][0]}">${STATUS[d.status][1]}</span>` },
      { title: 'رویداد', render: (d) => `<span class="ltr">${esc(d.event)}</span>${d.invoice_id && d.invoice_id !== 'INV_TEST' ? `<div class="muted ltr" style="font-size:.78rem">${esc(d.invoice_id)}</div>` : ''}` },
      { title: 'پاسخ', render: (d) => (d.http_status ? `<span class="num">${toFa(d.http_status)}</span> · <span class="num muted">${toFa(d.duration_ms ?? 0)}ms</span>` : `<span class="muted">${esc(d.error || '—')}</span>`) },
      { title: 'تلاش', render: (d) => `<span class="num">${toFa(d.attempt)}/${toFa(d.max_attempts)}</span>${d.next_retry_at ? `<div class="muted" style="font-size:.78rem">بعدی ${esc(jDateTime(d.next_retry_at))}</div>` : ''}` },
      { title: 'زمان', render: (d) => `<span class="num">${esc(jDateTime(d.created_at))}</span>` },
      { title: '', render: (d) => `<button class="btn btn-sm" type="button" data-open="${esc(d.id)}">جزئیات</button>` },
    ], r.data, { empty: 'موردی با این فیلتر پیدا نشد' });
    if (r.total > r.per_page) listEl.appendChild(pager(r, (p) => { state.page = p; loadList(); }));
    $$('[data-open]', listEl).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.open)));
  }
  $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.f; state.page = 1;
    $$('[data-f]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadList();
  }));
  loadList();

  async function openDetail(id) {
    let r;
    try { r = await api(`/api/v2/webhooks/deliveries/${encodeURIComponent(id)}`); } catch (err) { toast(err.message, 'err'); return; }
    const d = r.delivery;
    const m = modal({
      title: 'جزئیات ارسال', wide: true,
      body: `<dl class="kv" style="margin-bottom:12px">
        <dt>وضعیت</dt><dd><span class="pill ${STATUS[d.status][0]}">${STATUS[d.status][1]}</span></dd>
        <dt>آدرس</dt><dd class="wh-url">${esc(d.url)}</dd>
        <dt>پاسخ سرور</dt><dd>${d.http_status ? `<span class="num">${toFa(d.http_status)}</span> در <span class="num">${toFa(d.duration_ms ?? 0)}</span> میلی‌ثانیه` : '—'}</dd>
        ${d.error ? `<dt>خطا</dt><dd>${esc(d.error)}</dd>` : ''}
        <dt>تلاش‌ها</dt><dd>${r.attempts.map((a) => `<span class="pill ${STATUS[a.status][0]}" title="${esc(jDateTime(a.created_at))}">${toFa(a.attempt)}: ${a.http_status ? toFa(a.http_status) : 'بدون پاسخ'}</span>`).join(' ')}</dd>
        ${d.next_retry_at ? `<dt>تلاش بعدی</dt><dd>${esc(jDateTime(d.next_retry_at))}</dd>` : ''}
        <dt>شناسهٔ ارسال</dt><dd class="ltr num" style="font-size:.8rem">${esc(d.delivery_id)}</dd></dl>
        <b>هدرهای ارسالی</b><pre class="code wh-pre">${esc(Object.entries(d.request_headers).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre>
        <b>بدنهٔ ارسالی</b><pre class="code wh-pre">${esc(pretty(d.request_body))}</pre>
        <b>پاسخ سرور شما</b><pre class="code wh-pre">${esc(d.response_body || '(خالی)')}</pre>`,
      actions: `<button class="btn" data-close>بستن</button><button class="btn btn-primary" id="d-resend">ارسال دوباره</button>`,
    });
    $('#d-resend', m.el).addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true, 'در حال ارسال…');
      try {
        const x = await api(`/api/v2/webhooks/deliveries/${encodeURIComponent(id)}/resend`, { method: 'POST' });
        toast(x.ok ? 'ارسال دوباره موفق بود' : `ارسال ناموفق: ${x.delivery.error || ''}`, x.ok ? 'ok' : 'err');
        m.close(); loadList();
      } catch (err) { toast(err.message, 'err'); setBusy(e.currentTarget, false); }
    });
  }
}
