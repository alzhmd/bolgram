import { api, CONFIG, esc, toFa, faNum, jDateTime, toast, modal, confirmDialog, setBusy, copy, download, emptyState, useStyle, ICON, $, $$ } from '../core.js';

useStyle('plugins', `
.pl-key{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pl-key .grow{flex:1;min-width:180px}
.pl-key code{direction:ltr;unicode-bidi:isolate}
.pl-secret{direction:ltr;text-align:left;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:10px 0}
.pl-steps{margin:8px 0 0;padding-inline-start:20px}.pl-steps li{margin-bottom:4px}
.pl-snip{position:relative}.pl-snip .btn{position:absolute;inset-block-start:8px;inset-inline-end:8px}
.pl-snip pre{margin:0;padding-top:44px}
`);

const snippets = (url) => ({
  curl: `curl -X POST "${url}/api/v1/payment/create" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 450000, "currency": "IRT",
       "redirect_url": "https://shop.example/thanks",
       "webhook_url": "https://shop.example/hooks/bolgram",
       "metadata": {"order_id": "1042"}}'`,
  node: `const res = await fetch('${url}/api/v1/payment/create', {
  method: 'POST',
  headers: { 'x-api-key': process.env.BOLGRAM_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 450000, currency: 'IRT', // تومان
    redirect_url: 'https://shop.example/thanks',
    webhook_url: 'https://shop.example/hooks/bolgram',
    metadata: { order_id: '1042' },
  }),
});
const { invoice_id, payment_url } = await res.json();
// مشتری را به payment_url بفرستید`,
  php: `<?php
$ch = curl_init('${url}/api/v1/payment/create');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('BOLGRAM_API_KEY'), 'Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'amount' => 450000, 'currency' => 'IRT', // تومان
        'redirect_url' => 'https://shop.example/thanks',
        'webhook_url' => 'https://shop.example/hooks/bolgram',
        'metadata' => ['order_id' => '1042'],
    ]),
]);
$res = json_decode(curl_exec($ch), true);
header('Location: ' . $res['payment_url']);`,
  python: `import os, requests

res = requests.post(
    '${url}/api/v1/payment/create',
    headers={'x-api-key': os.environ['BOLGRAM_API_KEY']},
    json={
        'amount': 450000, 'currency': 'IRT',  # تومان
        'redirect_url': 'https://shop.example/thanks',
        'webhook_url': 'https://shop.example/hooks/bolgram',
        'metadata': {'order_id': '1042'},
    },
    timeout=20,
).json()
print(res['payment_url'])`,
});

export async function render(page, ctx = {}) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const d = await api('/api/v2/api-keys');
  const active = d.data.filter((k) => k.status === 'active');
  const snip = snippets(d.server_url);
  let lang = 'curl';

  page.innerHTML = `
    <div class="page-head"><h1>افزونه‌ها و API</h1><div class="actions"><a class="btn" href="${esc(CONFIG.SITE_URL)}/docs.html" target="_blank" rel="noopener">${ICON.book} مستندات API</a></div></div>
    <p class="muted" style="margin:0">کلید API بسازید، افزونهٔ ووکامرس را نصب کنید یا مستقیم از سایت و اپ خودتان فاکتور بسازید. آدرس سرور: <span class="ltr num">${esc(d.server_url)}</span></p>

    <section class="card"><div class="card-head"><h3>کلیدهای API</h3><button class="btn btn-primary btn-sm" type="button" id="k-new" style="margin-inline-start:auto" ${active.length >= d.max_active ? 'disabled' : ''}>${ICON.plus} کلید جدید</button></div>
      <p class="muted" style="margin-top:0;font-size:.88rem">کلید فقط یک‌بار نمایش داده می‌شود و در سرور به‌صورت هش ذخیره است. آن را فقط سمت سرور نگه دارید، نه در مرورگر یا اپ. «آزمایشی» فقط برچسب جداسازی است؛ فاکتورها همیشه واقعی‌اند.</p>
      ${d.data.length || d.legacy ? `<ul class="list" id="k-list">
        ${d.data.map((k) => `<li class="pl-key" data-id="${esc(k.id)}"><div class="grow"><b>${esc(k.name)}</b> <span class="pill ${k.environment === 'live' ? 'ok' : 'warn'}">${k.environment === 'live' ? 'واقعی' : 'آزمایشی'}</span>${k.status === 'revoked' ? ' <span class="pill bad">باطل‌شده</span>' : ''}
            <div class="muted" style="font-size:.82rem"><code>${esc(k.prefix)}…</code> · ساخته‌شده ${esc(jDateTime(k.created_at))} · ${k.last_used_at ? `آخرین استفاده ${esc(jDateTime(k.last_used_at))}` : 'هنوز استفاده نشده'}</div></div>
          ${k.status === 'active' ? '<button class="btn btn-sm btn-danger" type="button" data-revoke>ابطال</button>' : ''}</li>`).join('')}
        ${d.legacy ? `<li class="pl-key" data-legacy><div class="grow"><b>کلید قدیمی</b> <span class="pill">ساخته‌شده با حساب</span>
            <div class="muted" style="font-size:.82rem"><code id="lg-val">${esc(d.legacy.masked)}</code> · ${d.legacy.last_used_at ? `آخرین استفاده ${esc(jDateTime(d.legacy.last_used_at))}` : 'هنوز استفاده نشده'}</div></div>
          <button class="btn btn-sm" type="button" id="lg-show">نمایش</button><button class="btn btn-sm" type="button" id="lg-rotate">چرخش</button><button class="btn btn-sm btn-danger" type="button" id="lg-revoke">ابطال</button></li>` : ''}
      </ul>` : emptyState('plug', 'هنوز کلیدی نساخته‌اید', 'برای اتصال سایت یا افزونه یک کلید بسازید.', '<button class="btn btn-primary" type="button" data-newkey>ساخت کلید</button>')}
    </section>

    <div class="grid g2">
      <section class="card"><div class="card-head">${ICON.plug}<h3>افزونهٔ ووکامرس</h3><span class="pill ok" style="margin-inline-start:auto">نسخهٔ ۱٫۰٫۰</span></div>
        <p class="muted" style="margin-top:0">درگاه کارت‌به‌کارت با تأیید خودکار برای ووکامرس. آدرس سرور شما از قبل داخل افزونه گذاشته شده است.</p>
        <ol class="pl-steps"><li>فایل zip را دانلود و در وردپرس از «افزونه‌ها > افزودن > بارگذاری» نصب کنید.</li><li>در ووکامرس > تنظیمات > پرداخت > «بولگرام»، کلید API را بگذارید.</li><li>در صفحهٔ <a href="#/webhooks">وب‌هوک</a>، کلید امضا را نمایش دهید و در همان تنظیمات بگذارید.</li><li>درگاه را فعال و یک سفارش آزمایشی ثبت کنید.</li></ol>
        <div style="margin-top:12px"><button class="btn btn-primary" type="button" id="woo-dl">${ICON.inbox} دانلود افزونه (zip)</button></div>
        <p class="muted" style="font-size:.82rem;margin-bottom:0">واحد پول فروشگاه: ریال یا تومان. وب‌هوک https و عمومی لازم است.</p>
      </section>
      <section class="card"><div class="card-head"><h3>ساخت فاکتور با API</h3></div>
        <div class="seg" role="group" aria-label="زبان" style="margin-bottom:8px">${[['curl', 'curl'], ['node', 'Node.js'], ['php', 'PHP'], ['python', 'Python']].map(([v, t]) => `<button type="button" data-l="${v}" aria-pressed="${v === 'curl'}">${t}</button>`).join('')}</div>
        <div class="pl-snip"><button class="btn btn-sm" type="button" id="sn-copy">کپی</button><pre class="code" id="sn"></pre></div>
        <p class="muted" style="font-size:.82rem;margin-bottom:0"><code>amount</code> پیش‌فرض ریال است؛ با <code>currency: "IRT"</code> تومان می‌دهید. جزئیات پاسخ و وضعیت‌ها در <a href="${esc(CONFIG.SITE_URL)}/docs.html#create" target="_blank" rel="noopener">مستندات</a>.</p>
      </section>
    </div>`;

  const reload = () => render(page, ctx);

  // snippets
  const show = () => { $('#sn', page).textContent = snip[lang]; };
  show();
  $$('[data-l]', page).forEach((b) => b.addEventListener('click', () => { lang = b.dataset.l; $$('[data-l]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); show(); }));
  $('#sn-copy', page).addEventListener('click', (e) => copy(snip[lang], e.currentTarget));

  // woo
  $('#woo-dl', page).addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'در حال آماده‌سازی…');
    try { await download('/api/v2/plugins/woocommerce.zip', 'bolgram-gateway-1.0.0.zip'); } catch (err) { toast(err.message, 'err'); }
    setBusy(e.currentTarget, false);
  });

  // create key
  const secretModal = (title, secret, note) => {
    const m = modal({
      title, body: `<p class="muted" style="margin-top:0">${note}</p><div class="pl-secret" id="sk-val">${esc(secret)}</div>`,
      actions: `<button class="btn" data-close>بستن</button><button class="btn btn-primary" id="sk-copy">کپی کلید</button>`,
    });
    $('#sk-copy', m.el).addEventListener('click', (e) => copy(secret, e.currentTarget));
  };
  const newKey = () => {
    let env = 'live';
    const m = modal({
      title: 'کلید API جدید',
      body: `<div class="field"><label for="nk-name">نام کلید</label><input class="input" id="nk-name" maxlength="40" placeholder="مثلاً فروشگاه ووکامرس" aria-describedby="nk-err"><div class="err" id="nk-err" role="alert"></div></div>
        <div class="field"><span class="sr-only" id="nk-env-l">محیط</span><div class="seg" role="group" aria-labelledby="nk-env-l"><button type="button" data-e="live" aria-pressed="true">واقعی</button><button type="button" data-e="test" aria-pressed="false">آزمایشی</button></div><div class="hint">فقط برچسب است تا کلیدها را از هم جدا کنید.</div></div>`,
      actions: `<button class="btn" data-close>انصراف</button><button class="btn btn-primary" id="nk-ok">ساخت کلید</button>`,
    });
    $$('[data-e]', m.el).forEach((b) => b.addEventListener('click', () => { env = b.dataset.e; $$('[data-e]', m.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    $('#nk-ok', m.el).addEventListener('click', async (e) => {
      const name = $('#nk-name', m.el).value.trim();
      if (name.length < 2) { $('#nk-err', m.el).textContent = 'نام کلید را بنویسید (حداقل ۲ حرف)'; return; }
      setBusy(e.currentTarget, true, 'در حال ساخت…');
      try {
        const r = await api('/api/v2/api-keys', { method: 'POST', body: { name, environment: env } });
        m.close();
        secretModal('کلید ساخته شد', r.secret, 'این کلید را همین حالا کپی و در جای امن ذخیره کنید؛ بعداً دیگر نمایش داده نمی‌شود.');
        reload();
      } catch (err) { $('#nk-err', m.el).textContent = err.body?.errors?.name || err.message; setBusy(e.currentTarget, false); }
    });
  };
  $('#k-new', page).addEventListener('click', newKey);
  $$('[data-newkey]', page).forEach((b) => b.addEventListener('click', newKey));

  $$('[data-revoke]', page).forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('li');
    if (!(await confirmDialog('ابطال کلید', 'هر سایت یا افزونه‌ای که از این کلید استفاده می‌کند از همین لحظه کار نمی‌کند. ادامه می‌دهید؟', 'ابطال کلید', true))) return;
    try { await api(`/api/v2/api-keys/${encodeURIComponent(li.dataset.id)}`, { method: 'DELETE' }); toast('کلید باطل شد', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
  }));

  // legacy
  if (d.legacy) {
    $('#lg-show', page).addEventListener('click', async () => {
      try { const r = await api('/api/v2/api-keys/legacy/reveal'); secretModal('کلید قدیمی', r.key, 'این کلید همراه حساب ساخته شده است. اگر جایی لو رفته، آن را بچرخانید یا باطل کنید.'); } catch (err) { toast(err.message, 'err'); }
    });
    $('#lg-rotate', page).addEventListener('click', async () => {
      if (!(await confirmDialog('چرخش کلید قدیمی', 'کلید قدیمی با یک کلید تازه جایگزین می‌شود و سایت‌هایی که کلید قبلی را دارند از کار می‌افتند.', 'بچرخان', true))) return;
      try { const r = await api('/api/v2/api-keys/legacy/rotate', { method: 'POST' }); secretModal('کلید قدیمی تازه', r.key, 'کلید قبلی دیگر کار نمی‌کند. کلید تازه را در سایت خود بگذارید.'); reload(); } catch (err) { toast(err.message, 'err'); }
    });
    $('#lg-revoke', page).addEventListener('click', async () => {
      if (!(await confirmDialog('ابطال کلید قدیمی', 'کلید قدیمی برای همیشه باطل می‌شود. برای اتصال دوباره، کلید جدید بسازید.', 'ابطال کلید', true))) return;
      try { await api('/api/v2/api-keys/legacy', { method: 'DELETE' }); toast('کلید قدیمی باطل شد', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
    });
  }
}
