import { api, can, esc, toFa, copy, toast, setBusy, useStyle, ICON, $, $$ } from '../core.js';

useStyle('app-page', `
.ap-hero{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.ap-hero .ap-ico{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,var(--brand),var(--accent));color:#040810;flex:none}
.ap-hero .ap-ico svg{width:32px;height:32px}
.ap-hero .grow{flex:1;min-width:220px}
.ap-hero h2{margin:0 0 4px;font-size:1.2rem}
.ap-sha{display:flex;gap:8px;align-items:stretch;margin-top:8px}
.ap-sha .code{flex:1;min-width:0;padding:8px 10px;white-space:nowrap}
.ap-steps{margin:0;padding-inline-start:22px;display:grid;gap:8px}
.ap-perm{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.ap-perm>div{border:1px solid var(--border);border-radius:14px;padding:12px 14px;background:var(--surface-2)}
.ap-perm b{display:block;margin-bottom:4px}
.ap-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}
.ap-field{display:flex;gap:8px;margin-top:6px}.ap-field .input{flex:1;min-width:0}
`);

const STEP_OS = {
  linux: 'sha256sum bolgram.apk',
  mac: 'shasum -a 256 bolgram.apk',
  win: 'certutil -hashfile bolgram.apk SHA256',
};

function downloadCard(app) {
  const ready = !!app.apk_url;
  return `<section class="card"><div class="ap-hero"><span class="ap-ico" aria-hidden="true">${ICON.phone}</span>
    <div class="grow"><h2>اپ اندروید بولگرام</h2>
      <p class="muted" style="margin:0">${ready ? `نسخهٔ ${app.version ? `<b class="ltr num">${esc(app.version)}</b>` : 'جدید'} · اندروید ${toFa(app.min_android || '6.0')} یا بالاتر` : 'فایل نصب هنوز در این سرور منتشر نشده است. پس از انتشار، لینک دانلود و اثر انگشت فایل همین‌جا نمایش داده می‌شود.'}</p></div>
    ${ready ? `<a class="btn btn-primary" href="${esc(app.apk_url)}" rel="noopener" download>دانلود فایل APK</a>` : '<span class="pill warn">به‌زودی</span>'}</div>
    ${app.sha256 ? `<div style="margin-top:14px"><b style="font-size:.9rem">اثر انگشت SHA-256 فایل</b><div class="ap-sha"><div class="code num" id="ap-sha" tabindex="0" aria-label="SHA-256">${esc(app.sha256)}</div><button class="btn" type="button" id="ap-sha-copy">کپی</button></div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">چطور مطمئن شوم فایل دست‌نخورده است؟</summary>
        <p class="muted">بعد از دانلود، اثر انگشت فایل را روی کامپیوتر حساب کنید و با مقدار بالا مقایسه کنید. هر حرف متفاوت یعنی فایل تغییر کرده؛ آن را نصب نکنید.</p>
        <div class="ap-tabs" role="tablist"><button class="btn btn-sm" type="button" data-os="win" aria-pressed="true">ویندوز</button><button class="btn btn-sm" type="button" data-os="mac" aria-pressed="false">مک</button><button class="btn btn-sm" type="button" data-os="linux" aria-pressed="false">لینوکس</button></div>
        <div class="code" id="ap-cmd">${STEP_OS.win}</div></details></div>` : ''}</section>`;
}

const permCard = (t, d) => `<div><b>${t}</b><span class="muted" style="font-size:.9rem">${d}</span></div>`;

function androidSections() {
  return `<section class="card"><div class="card-head"><h3>نصب روی اندروید</h3></div><ol class="ap-steps">
      <li>فایل APK را با مرورگر گوشی دانلود کنید (یا از کامپیوتر به گوشی منتقل کنید).</li>
      <li>فایل را باز کنید. اگر اندروید پرسید، «اجازهٔ نصب از این منبع» را برای مرورگر یا مدیر فایل روشن کنید؛ این اجازه فقط برای نصب بولگرام لازم است و بعدش می‌توانید خاموشش کنید.</li>
      <li>اپ را باز کنید و مجوزهای خواسته‌شده را بدهید (جدول پایین).</li>
      <li>در پنل، <a href="#/devices">دستگاه‌ها ← اتصال گوشی اندروید</a> را بزنید و QR را اسکن کنید یا کد ۸ حرفی را وارد کنید.</li>
      <li>تنظیم باتری را روی «بدون محدودیت» بگذارید؛ در گوشی‌های شیائومی، هواوی و سامسونگ «شروع خودکار» هم لازم است (راهنما در صفحهٔ دستگاه‌ها).</li></ol></section>
    <section class="card"><div class="card-head"><h3>مجوزهایی که اپ می‌خواهد و دلیلش</h3></div><div class="ap-perm">
      ${permCard('دریافت و خواندن پیامک', 'تا پیامک واریز بانک در لحظهٔ رسیدن شناسایی شود. فقط پیامک فرستنده‌های بانکی ارسال می‌شود و پیامک‌های رمز، رمز پویا و کد یکبارمصرف هرگز.')}
      ${permCard('اعلان‌ها', 'اندروید برای اجرای دائمی در پس‌زمینه یک اعلان ثابت می‌خواهد؛ همچنین خطای اتصال را از همین راه می‌بینید.')}
      ${permCard('نادیده گرفتن بهینه‌سازی باتری', 'بدون آن، اندروید اپ را می‌بندد و پیامک‌ها با تأخیر یا اصلاً نمی‌رسند.')}
      ${permCard('دوربین', 'فقط برای اسکن QR اتصال. اگر کد را دستی وارد کنید لازم نیست.')}
      ${permCard('اینترنت', 'ارسال امن پیامک بانکی و وضعیت گوشی به سرور بولگرام. هنگام قطعی، پیامک‌ها در گوشی صف می‌شوند و بعداً فرستاده می‌شوند.')}
    </div></section>
    <section class="card"><div class="card-head"><h3>مایکت و کافه‌بازار</h3></div><p class="muted" style="margin:0">اگر نسخه‌ای از بولگرام در مایکت یا کافه‌بازار منتشر شده باشد، نصب از همان‌جا هم معتبر است و به‌روزرسانی‌اش خودکار انجام می‌شود. فروشگاه‌های داخلی ممکن است برای اپ‌هایی که پیامک می‌خوانند محدودیت داشته باشند؛ در این صورت از فایل APK همین صفحه استفاده کنید. بعد از هر نصب، شمارهٔ نسخه در صفحهٔ دستگاه‌ها دیده می‌شود.</p></section>`;
}

function iosSection(manage) {
  return `<section class="card" id="ios"><div class="card-head"><h3>آیفون: ارسال پیامک با شورتکات</h3></div>
    <div class="alert alert-warn" style="margin-bottom:12px">آیفون به هیچ اپی اجازهٔ خواندن پیامک نمی‌دهد، پس اپ اندرویدی برای iOS ممکن نیست. تنها راه رسمی، «اتوماسیون شخصی» برنامهٔ <b>Shortcuts</b> است که با رسیدن پیامک از بانک اجرا می‌شود و متن آن را به بولگرام می‌فرستد.</div>
    <ol class="ap-steps">
      <li>در این صفحه یک دستگاه شورتکات بسازید تا آدرس و توکن اختصاصی بگیرید.</li>
      <li>برنامهٔ <b>Shortcuts</b> ← تب <b>Automation</b> ← <b>+</b> ← <b>Create Personal Automation</b> ← <b>Message</b>.</li>
      <li>در <b>Sender</b> نام یا شمارهٔ پیامک بانک را اضافه کنید (مثلاً <span class="ltr">Bank Mellat</span> یا <span class="ltr">700717</span>؛ برای هر بانک یک اتوماسیون یا چند فرستنده را با هم انتخاب کنید). <b>Message Contains</b> را خالی بگذارید.</li>
      <li>گزینهٔ <b>Run Immediately</b> را انتخاب کنید و «Notify When Run» را خاموش کنید ← Next.</li>
      <li>اکشن <b>Get Contents of URL</b> را اضافه کنید:
        <ul style="margin:6px 0 0;padding-inline-start:18px;display:grid;gap:4px"><li>URL: آدرس بالا</li><li>Method: <b>POST</b></li><li>Headers: کلید <span class="ltr">X-Device-Token</span> و مقدار توکن</li><li>Request Body: <b>JSON</b> با دو فیلد متنی: <span class="ltr">sender</span> = <b>Sender</b> (از ورودی «Shortcut Input») و <span class="ltr">body</span> = <b>Message</b> (متن پیام)</li></ul></li>
      <li>ذخیره کنید. با یک واریز آزمایشی بررسی کنید که در <a href="#/devices">دستگاه‌ها</a> شمارندهٔ «پیامک امروز» بالا می‌رود.</li></ol>
    <p class="muted" style="margin-bottom:0">فقط پیامک واریز بانکی ارسال کنید؛ پیامک رمز و کد یکبارمصرف را در شرط اتوماسیون قرار ندهید (بولگرام آن‌ها را به‌هر حال نادیده می‌گیرد). اتوماسیون شورتکات به‌خاطر محدودیت iOS گاهی با تأخیر اجرا می‌شود.</p>
    <div id="ios-box" style="margin-top:14px" aria-live="polite"><span class="spinner"></span></div></section>`;
}

function shortcutBox(s) {
  const row = (label, val, id) => `<div class="field" style="margin-bottom:10px"><label for="${id}">${label}</label><div class="ap-field"><input class="input ltr" id="${id}" readonly value="${esc(val)}" onfocus="this.select()"><button class="btn" type="button" data-copy="${id}">کپی</button></div></div>`;
  return `${row('آدرس (URL)', s.ingest_url, 'ap-url')}${row('توکن (مقدار هدر X-Device-Token)', s.token, 'ap-token')}
    <div class="muted" style="font-size:.85rem">نمونهٔ بدنهٔ JSON:</div><div class="code">${esc(JSON.stringify(s.body_example, null, 2))}</div>`;
}

export async function render(page) {
  const manage = can('devices:manage');
  page.innerHTML = `<div class="page-head"><h1>اپلیکیشن بولگرام</h1></div>
    <p class="muted" style="margin:0">اپ بولگرام روی گوشی شما می‌ماند، پیامک واریز بانک را می‌خواند و به پنل می‌فرستد؛ پول همیشه مستقیم به کارت خودتان می‌نشیند و بولگرام به حساب شما دسترسی ندارد.</p>
    <div id="ap-dl"><div class="card"><span class="spinner"></span> در حال بارگذاری…</div></div>
    ${androidSections()}${iosSection(manage)}`;

  // Android build info (public)
  api('/api/pub/app/latest', { auth: false }).then((app) => {
    $('#ap-dl', page).innerHTML = downloadCard(app);
    $('#ap-sha-copy', page)?.addEventListener('click', (e) => copy(app.sha256, e.currentTarget));
    $$('[data-os]', page).forEach((b) => b.addEventListener('click', () => {
      $$('[data-os]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#ap-cmd', page).textContent = STEP_OS[b.dataset.os];
    }));
  }).catch((e) => { $('#ap-dl', page).innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; });

  // iPhone: existing shortcut device(s) or create one
  const box = $('#ios-box', page);
  const showDevice = async (id) => {
    const s = await api(`/api/v2/devices/${id}/shortcut`);
    box.innerHTML = shortcutBox(s);
    $$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => copy($('#' + b.dataset.copy, box).value, b)));
  };
  const offerCreate = () => {
    box.innerHTML = manage
      ? '<button class="btn btn-primary" type="button" id="ios-create">ساخت توکن آیفون</button>'
      : '<p class="muted" style="margin:0">برای ساخت توکن آیفون، از مالک فروشگاه بخواهید دسترسی «اتصال دستگاه» را به شما بدهد.</p>';
    $('#ios-create', box)?.addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true, 'در حال ساخت…');
      try {
        const s = await api('/api/v2/devices/shortcut', { method: 'POST', body: {} });
        box.innerHTML = shortcutBox(s);
        $$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => copy($('#' + b.dataset.copy, box).value, b)));
        toast('دستگاه شورتکات ساخته شد', 'ok');
      } catch (err) { setBusy(e.currentTarget, false); toast(err.message, 'err'); }
    });
  };
  try {
    const { data } = await api('/api/v2/devices');
    const ios = data.filter((d) => d.kind === 'ios_shortcut');
    if (ios.length && manage) await showDevice(ios[0].id);
    else if (ios.length) box.innerHTML = `<p class="muted" style="margin:0">${toFa(ios.length)} آیفون متصل است. توکن فقط برای مدیر فروشگاه نمایش داده می‌شود.</p>`;
    else offerCreate();
  } catch (e) { box.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; }
}
