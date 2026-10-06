import { api, can, toFa, faNum, esc, ago, jDateTime, toman, modal, toast, confirmDialog, setBusy, copy, emptyState, useStyle, ICON, $, $$ } from '../core.js';

useStyle('devices', `
.dv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.dv-card{display:flex;flex-direction:column;gap:12px;min-width:0}
.dv-top{display:flex;align-items:center;gap:10px;min-width:0}
.dv-top h3{margin:0;font-size:1.02rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand);flex:none}
.dv-status{display:flex;align-items:center;gap:8px;font-size:.9rem}
.dv-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
.dv-dot.on{background:var(--green);box-shadow:0 0 0 4px var(--green-soft)}
.dv-dot.off{background:var(--red);box-shadow:0 0 0 4px var(--red-soft)}
.dv-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:0;font-size:.88rem}
.dv-meta dt{color:var(--muted);font-size:.78rem}.dv-meta dd{margin:2px 0 0;min-width:0;overflow-wrap:anywhere}
.dv-batt{display:flex;align-items:center;gap:8px}.dv-batt .progress{flex:1;min-width:48px}
.dv-batt .progress>i.low{background:var(--red)}
.dv-banks{display:flex;flex-wrap:wrap;gap:6px}
.dv-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto}
.dv-qr{width:min(260px,70vw);margin-inline:auto;background:#fff;border-radius:16px;padding:8px;line-height:0}
.dv-qr svg{width:100%;height:auto}
.dv-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.7rem;letter-spacing:.22em;text-align:center;direction:ltr;font-weight:700;margin:10px 0 2px}
.dv-pair{text-align:center}
.dv-ok{display:grid;place-items:center;gap:8px;padding:18px 0;text-align:center}
.dv-ok .big{width:64px;height:64px;border-radius:50%;background:var(--green-soft);color:var(--green);display:grid;place-items:center}
.dv-ok .big svg{width:32px;height:32px}
.dv-trouble ol,.dv-trouble ul{margin:6px 0 0;padding-inline-start:20px;display:grid;gap:6px}
.dv-trouble details{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-top:8px}
.dv-trouble summary{cursor:pointer;font-weight:600}
.dv-sms li{display:flex;gap:10px;align-items:center;min-width:0}
.dv-sms .grow{flex:1;min-width:0}
`);

const tip = (x) => (x ? `<span class="muted"> · ${x}</span>` : '');
const PAIR_POLL_MS = 2500;

function lastSeenText(d) {
  if (d.kind === 'ios_shortcut') return d.last_seen ? `آخرین پیامک ${ago(d.last_seen)}` : 'هنوز پیامکی نفرستاده';
  if (!d.last_seen) return 'هنوز متصل نشده';
  const min = Math.floor((d.seconds_since_seen || 0) / 60);
  return d.online ? 'آنلاین' : `آفلاین · ${min < 1 ? 'لحظاتی' : `${toFa(min)} دقیقه`} پیش`;
}

function card(d, manage) {
  const ios = d.kind === 'ios_shortcut';
  const dot = ios ? '' : d.online ? 'on' : 'off';
  const batt = d.battery_level;
  const sim = d.sim?.slots?.length ? d.sim.slots.map((s) => esc(s.carrier || s.name || `سیم ${toFa(s.slot ?? '')}`)).join('، ') : d.sim?.number ? `<span class="ltr num">${esc(d.sim.number)}</span>` : '—';
  return `<article class="card dv-card" data-id="${esc(d.id)}">
    <div class="dv-top"><span class="dv-ico" aria-hidden="true">${ios ? ICON.link : ICON.phone}</span>
      <div style="min-width:0;flex:1"><h3 title="${esc(d.name)}">${esc(d.name)}</h3><div class="muted" style="font-size:.8rem">${ios ? 'آیفون · شورتکات' : 'اندروید'}</div></div>
      ${ios ? '<span class="pill">شورتکات</span>' : `<span class="pill ${d.online ? 'ok' : 'bad'}">${d.online ? 'آنلاین' : 'آفلاین'}</span>`}</div>
    <div class="dv-status" aria-live="polite"><span class="dv-dot ${dot}" aria-hidden="true"></span><span>${esc(lastSeenText(d))}</span></div>
    <dl class="dv-meta">
      ${ios ? '' : `<div><dt>باتری</dt><dd>${batt === null ? '—' : `<div class="dv-batt"><div class="progress" role="img" aria-label="باتری ${toFa(batt)} درصد"><i class="${batt <= 15 ? 'low' : ''}" style="width:${batt}%"></i></div><span class="num">${toFa(batt)}٪${d.charging ? ' ⚡' : ''}</span></div>`}</dd></div>
      <div><dt>مدل</dt><dd class="ltr" style="text-align:start">${esc(d.model || '—')}${d.android_version ? tip('Android ' + esc(d.android_version)) : ''}</dd></div>
      <div><dt>سیم‌کارت</dt><dd>${sim}</dd></div>`}
      <div><dt>پیامک بانکی امروز</dt><dd class="num">${faNum(d.sms_today)}</dd></div>
      <div><dt>آخرین واریز</dt><dd>${d.last_sms_at ? `${esc(d.last_sms_bank_name || '')} · ${ago(d.last_sms_at)}` : '—'}</dd></div>
      ${ios || !d.app_version ? '' : `<div><dt>نسخهٔ اپ</dt><dd class="ltr num" style="text-align:start">${esc(d.app_version)}</dd></div>`}
    </dl>
    ${d.banks.length ? `<div class="dv-banks" aria-label="بانک‌های دیده‌شده">${d.banks.map((b) => `<span class="chip">${esc(b.name)}</span>`).join('')}</div>` : ''}
    <div class="dv-actions">
      <button class="btn btn-sm" type="button" data-sms>پیامک‌های اخیر</button>
      ${manage ? `<button class="btn btn-sm" type="button" data-rename>تغییر نام</button>${ios ? '<button class="btn btn-sm" type="button" data-shortcut>توکن و راهنما</button>' : ''}<button class="btn btn-sm btn-danger" type="button" data-revoke>قطع اتصال</button>` : ''}
    </div>
  </article>`;
}

function troubleshooting() {
  return `<section class="card dv-trouble" id="trouble"><div class="card-head"><h3>گوشی آفلاین است؟ این موارد را بررسی کنید</h3></div>
    <p class="muted" style="margin:0">گوشی‌های اندرویدی اپ‌های پس‌زمینه را برای صرفه‌جویی در باتری می‌بندند. تا این‌ها تنظیم نشود، پیامک بانک دیر یا هرگز نمی‌رسد.</p>
    <details open><summary>۱. بهینه‌سازی باتری را برای بولگرام خاموش کنید</summary><ol><li>تنظیمات ← باتری ← «بهینه‌سازی باتری» (یا «Battery optimization»).</li><li>برنامهٔ «بولگرام» را پیدا کنید و روی <b>بدون محدودیت</b> / «Don't optimize» بگذارید.</li><li>اپ هنگام نخستین اجرا هم این اجازه را می‌پرسد.</li></ol></details>
    <details><summary>۲. شروع خودکار (Xiaomi / Huawei / Samsung / Oppo)</summary><ul>
      <li><b>شیائومی (MIUI/HyperOS):</b> تنظیمات ← برنامه‌ها ← مدیریت برنامه‌ها ← بولگرام ← «Autostart» را روشن کنید و «Battery saver» را روی «No restrictions» بگذارید. در صفحهٔ برنامه‌های اخیر، کارت بولگرام را قفل (📌) کنید.</li>
      <li><b>هواوی (EMUI):</b> تنظیمات ← باتری ← راه‌اندازی برنامه‌ها ← بولگرام ← «مدیریت دستی» و هر سه گزینه (شروع خودکار، شروع ثانویه، اجرا در پس‌زمینه) روشن.</li>
      <li><b>سامسونگ (One UI):</b> تنظیمات ← باتری ← محدودیت‌های پس‌زمینه ← «برنامه‌های هرگز در خواب» ← افزودن بولگرام. گزینهٔ «Put unused apps to sleep» را خاموش کنید.</li>
      <li><b>اوپو/ریلمی/وان‌پلاس:</b> تنظیمات ← باتری ← بولگرام ← «اجازهٔ فعالیت در پس‌زمینه» و «شروع خودکار».</li></ul></details>
    <details><summary>۳. صرفه‌جویی داده (Data Saver)</summary><p style="margin:6px 0 0">تنظیمات ← شبکه و اینترنت ← صرفه‌جویی داده را خاموش کنید یا بولگرام را در «دسترسی نامحدود به داده» بگذارید. حالت «صرفه‌جویی باتری» گوشی هم باید خاموش باشد.</p></details>
    <details><summary>۴. اجازهٔ اعلان و پیامک</summary><ul><li>تنظیمات ← برنامه‌ها ← بولگرام ← مجوزها: «پیامک» (دریافت و خواندن) و «اعلان‌ها» باید مجاز باشند.</li><li>اعلان دائمی «بولگرام فعال است» نباید خاموش شود؛ همان سرویس پس‌زمینه است.</li></ul></details>
    <details><summary>۵. اینترنت و ساعت گوشی</summary><p style="margin:6px 0 0">گوشی باید به اینترنت وصل باشد (سیم‌کارت یا وای‌فای). اگر اینترنت قطع شود پیامک‌ها در گوشی صف می‌شوند و با برگشت اینترنت ارسال می‌شوند؛ چیزی از دست نمی‌رود.</p></details>
  </section>`;
}

export async function render(page, ctx) {
  const manage = can('devices:manage');
  let timer = null;
  let list = [];
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const draw = () => {
    const anyOffline = list.some((d) => d.kind === 'android' && !d.online);
    page.innerHTML = `
      <div class="page-head"><h1>دستگاه‌ها</h1><div class="actions">${manage ? `<button class="btn" type="button" id="dv-shortcut">${ICON.link} آیفون (شورتکات)</button><button class="btn btn-primary" type="button" id="dv-pair">${ICON.plus} اتصال گوشی اندروید</button>` : ''}</div></div>
      <p class="muted" style="margin:0">گوشی شما پیامک بانکی را مستقیم به بولگرام می‌فرستد و مبلغ واریزی با فاکتور تطبیق داده می‌شود. پیامک رمز و کد یکبارمصرف هرگز ارسال نمی‌شود.</p>
      ${list.length ? `<div class="dv-grid" id="dv-list">${list.map((d) => card(d, manage)).join('')}</div>`
        : `<section class="card">${emptyState('phone', 'هنوز گوشی‌ای وصل نشده', 'اپ بولگرام را روی گوشی اندروید نصب کنید و با کد یا QR وصل کنید؛ برای آیفون از شورتکات استفاده کنید.', `<a class="btn" href="#/app">راهنمای نصب اپ</a> ${manage ? '<button class="btn btn-primary" type="button" data-pair>اتصال گوشی</button>' : ''}`)}</section>`}
      ${anyOffline || !list.length ? troubleshooting() : `<section class="card"><details><summary style="cursor:pointer;font-weight:600">راهنمای عیب‌یابی گوشی آفلاین</summary><div style="margin-top:10px">${troubleshooting().replace(/^<section[^>]*>/, '<div>').replace(/<\/section>$/, '</div>')}</div></details></section>`}`;
    $('#dv-pair', page)?.addEventListener('click', () => pairModal(refresh));
    $$('[data-pair]', page).forEach((b) => b.addEventListener('click', () => pairModal(refresh)));
    $('#dv-shortcut', page)?.addEventListener('click', () => createShortcut(refresh));
    $$('.dv-card', page).forEach((el) => {
      const d = list.find((x) => x.id === el.dataset.id);
      $('[data-sms]', el)?.addEventListener('click', () => smsSheet(d));
      $('[data-rename]', el)?.addEventListener('click', () => rename(d, refresh));
      $('[data-shortcut]', el)?.addEventListener('click', () => showShortcut(d));
      $('[data-revoke]', el)?.addEventListener('click', async () => {
        const ok = await confirmDialog('قطع اتصال دستگاه', `«${esc(d.name)}» از حساب شما جدا می‌شود و دیگر پیامکی از آن پذیرفته نمی‌شود. برای وصل دوباره باید از اول جفت شود. ادامه می‌دهید؟`, 'قطع اتصال', true);
        if (!ok) return;
        try { await api(`/api/v2/devices/${d.id}`, { method: 'DELETE' }); toast('اتصال دستگاه قطع شد', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
      });
    });
  };
  const refresh = async (quiet) => {
    try { list = (await api('/api/v2/devices')).data; draw(); }
    catch (e) { if (!quiet) toast(e.message, 'err'); }
  };
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  await refresh();
  // keep "n minutes ago" and the online dot fresh while the page is open
  timer = setInterval(() => { if (!page.isConnected) return stop(); if (!document.querySelector('.overlay, .sheet')) refresh(true); }, 30_000);
}

function rename(d, done) {
  const m = modal({
    title: 'تغییر نام دستگاه',
    body: `<form id="rn" novalidate><div class="field"><label for="rn-name">نام دستگاه</label><input class="input" id="rn-name" maxlength="60" value="${esc(d.name)}"><div class="err" id="rn-err" role="alert"></div></div><button class="btn btn-primary btn-block" type="submit">ذخیره</button></form>`,
  });
  $('#rn', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setBusy(btn, true, 'در حال ذخیره…');
    try { await api(`/api/v2/devices/${d.id}`, { method: 'PATCH', body: { name: $('#rn-name', m.el).value } }); m.close(); toast('نام ذخیره شد', 'ok'); done(); }
    catch (err) { setBusy(btn, false); $('#rn-err', m.el).textContent = err.errors?.name || err.message; }
  });
}

function pairModal(done) {
  let stopped = false, poll = null, tick = null;
  const m = modal({ title: 'اتصال گوشی اندروید', body: '<div class="dv-pair"><span class="spinner"></span> در حال ساخت کد…</div>', onClose: () => { stopped = true; clearInterval(poll); clearInterval(tick); done(true); } });
  const target = $('.m-body', m.el);
  const make = async () => {
    target.innerHTML = '<div class="dv-pair"><span class="spinner"></span> در حال ساخت کد…</div>';
    let r;
    try { r = await api('/api/v2/devices/pair', { method: 'POST', body: {} }); }
    catch (e) { target.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>${e.status === 402 ? '<a class="btn btn-primary btn-block" style="margin-top:12px" href="#/plans" data-close>ارتقای پلن</a>' : ''}`; return; }
    if (stopped) return;
    let left = r.expires_in;
    target.innerHTML = `<div class="dv-pair">
      <ol style="text-align:start;margin:0 0 12px;padding-inline-start:20px;display:grid;gap:4px"><li>اپ «بولگرام» را روی گوشی باز کنید (<a href="#/app" data-close>نصب اپ</a>).</li><li>در صفحهٔ اتصال، QR را اسکن کنید یا کد زیر را وارد کنید.</li></ol>
      <div class="dv-qr" role="img" aria-label="QR اتصال دستگاه">${r.qr_svg}</div>
      <div class="dv-code num" id="pc" dir="ltr">${esc(r.code.slice(0, 4))}&#8209;${esc(r.code.slice(4))}</div>
      <div style="display:flex;gap:8px;justify-content:center;margin:8px 0"><button class="btn btn-sm" type="button" id="pc-copy">کپی کد</button></div>
      <p class="muted" id="pc-left" aria-live="polite" style="margin:6px 0 0"></p>
      <p class="muted" style="margin:6px 0 0;font-size:.82rem">منتظر اتصال گوشی…</p></div>`;
    $('#pc-copy', m.el).addEventListener('click', (e) => copy(r.code, e.currentTarget));
    const paint = () => { const mm = Math.floor(left / 60), ss = left % 60; $('#pc-left', m.el).textContent = left > 0 ? `اعتبار کد: ${toFa(mm)}:${toFa(String(ss).padStart(2, '0'))}` : 'کد منقضی شد'; };
    paint();
    tick = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) { clearInterval(tick); clearInterval(poll); target.querySelector('.dv-pair').insertAdjacentHTML('beforeend', '<button class="btn btn-primary" type="button" id="pc-new" style="margin-top:10px">ساخت کد جدید</button>'); $('#pc-new', m.el).addEventListener('click', make); }
    }, 1000);
    poll = setInterval(async () => {
      if (stopped) return;
      try {
        const s = await api(`/api/v2/devices/pair/${r.code}`);
        if (s.status === 'paired') {
          clearInterval(poll); clearInterval(tick);
          target.innerHTML = `<div class="dv-ok" role="status"><span class="big">${ICON.check}</span><b>گوشی با موفقیت وصل شد</b><span class="muted">${esc(s.device?.name || '')}</span><button class="btn btn-primary" type="button" data-close>تمام</button></div>`;
          toast('دستگاه جدید وصل شد', 'ok');
        } else if (s.status === 'expired') { left = 0; paint(); }
      } catch { /* transient */ }
    }, PAIR_POLL_MS);
  };
  make();
}

const kvRow = (label, val, id) => `<div class="field"><label for="${id}">${label}</label><div style="display:flex;gap:8px"><input class="input ltr" id="${id}" readonly value="${esc(val)}" style="flex:1;min-width:0" onfocus="this.select()"><button class="btn" type="button" data-copy="${id}">کپی</button></div></div>`;

function shortcutBody(s) {
  return `${kvRow('آدرس (URL)', s.ingest_url, 'sc-url')}${kvRow(`مقدار هدر ${esc(s.header_name)}`, s.token, 'sc-token')}
    <p class="muted" style="margin:0 0 8px">توکن را با کسی در میان نگذارید؛ هر کس آن را داشته باشد می‌تواند پیامک به حساب شما بفرستد. در صورت لو رفتن، دستگاه را قطع و دوباره بسازید.</p>
    <div class="alert alert-warn" style="margin-bottom:10px">آیفون پیامک را به‌صورت خودکار در اختیار هیچ اپی نمی‌گذارد؛ اتوماسیون «پیام» در برنامهٔ شورتکات این کار را انجام می‌دهد. مراحل کامل در صفحهٔ <a href="#/app" data-close>اپلیکیشن</a> است.</div>
    <ol style="margin:0;padding-inline-start:20px;display:grid;gap:4px"><li>شورتکات ← Automation ← Personal ← <b>Message</b></li><li>Sender: نام یا شمارهٔ بانک (مثلاً Bank Mellat) ← Run Immediately</li><li>اکشن <b>Get Contents of URL</b>: متد POST، قالب JSON</li><li>هدر <span class="ltr">${esc(s.header_name)}</span> با مقدار توکن بالا و فیلدهای <span class="ltr">sender</span> و <span class="ltr">body</span> (ورودی پیام)</li></ol>`;
}
function wireCopy(el) { $$('[data-copy]', el).forEach((b) => b.addEventListener('click', () => copy($('#' + b.dataset.copy, el).value, b))); }

async function createShortcut(done) {
  const m = modal({
    title: 'افزودن آیفون با شورتکات',
    body: `<form id="sc" novalidate><p class="muted" style="margin-top:0">یک «دستگاه شورتکات» با توکن اختصاصی ساخته می‌شود تا آیفون پیامک‌های بانکی را با اتوماسیون شورتکات بفرستد.</p><div class="field"><label for="sc-name">نام دستگاه</label><input class="input" id="sc-name" maxlength="60" value="آیفون فروشگاه"></div><button class="btn btn-primary btn-block" type="submit">ساخت توکن</button></form>`,
    onClose: () => done(true),
  });
  $('#sc', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setBusy(btn, true, 'در حال ساخت…');
    try {
      const s = await api('/api/v2/devices/shortcut', { method: 'POST', body: { name: $('#sc-name', m.el).value } });
      e.target.outerHTML = `<div class="alert alert-ok" style="margin-bottom:10px" role="status">دستگاه ساخته شد.</div>${shortcutBody(s)}`;
      wireCopy(m.el);
    } catch (err) { setBusy(btn, false); toast(err.message, 'err'); }
  });
}

async function showShortcut(d) {
  try {
    const s = await api(`/api/v2/devices/${d.id}/shortcut`);
    const m = modal({ title: `شورتکات · ${esc(d.name)}`, body: shortcutBody(s) });
    wireCopy(m.el);
  } catch (e) { toast(e.message, 'err'); }
}

async function smsSheet(d) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sh = document.createElement('aside');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-label', 'پیامک‌های اخیر');
  sh.innerHTML = `<div class="card-head"><h3>پیامک‌های اخیر · ${esc(d.name)}</h3><button class="icon-btn" type="button" data-x aria-label="بستن" style="margin-inline-start:auto">${ICON.x}</button></div><div id="sms-body" aria-live="polite"><span class="spinner"></span> در حال بارگذاری…</div>`;
  const close = () => { back.remove(); sh.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  back.addEventListener('click', close);
  $('[data-x]', sh).addEventListener('click', close);
  document.body.append(back, sh);
  $('[data-x]', sh).focus();
  try {
    const { data } = await api(`/api/v2/devices/${d.id}/sms?limit=40`);
    $('#sms-body', sh).innerHTML = data.length
      ? `<ul class="list dv-sms">${data.map((x) => `<li><div class="grow"><b class="num">${toman(x.amount_rial)}</b> <span class="muted">${esc(x.bank_name || '')}</span><div class="muted" style="font-size:.8rem">${jDateTime(x.at)}${x.invoice_id ? ` · <a href="#/invoices/${esc(x.invoice_id)}">${esc(x.invoice_id)}</a>` : ''}</div></div><span class="pill ${x.kind === 'matched' ? 'ok' : 'warn'}">${x.kind === 'matched' ? 'تطبیق خورد' : x.status === 'assigned' ? 'تخصیص یافت' : x.status === 'rejected' ? 'رد شد' : 'در انتظار بررسی'}</span></li>`).join('')}</ul><p class="muted" style="font-size:.8rem">متن پیامک برای حفظ حریم خصوصی نمایش داده نمی‌شود. واریزهای در انتظار را از صفحهٔ <a href="#/deposits">واریزها</a> بررسی کنید.</p>`
      : emptyState('inbox', 'هنوز واریزی از این دستگاه نرسیده', 'وقتی پیامک واریز بانک به این گوشی برسد، اینجا دیده می‌شود.');
  } catch (e) { $('#sms-body', sh).innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; }
}
