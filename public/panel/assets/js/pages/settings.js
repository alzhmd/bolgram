import { api, session, esc, toFa, toLatin, fixArabic, normMobile, normEmail, passwordError, fileToDataUrl, download, toast, confirmDialog, setBusy, useStyle, ICON, $, $$ } from '../core.js';

useStyle('settings', `
.st-logo{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.st-logo .pv{width:72px;height:72px;border-radius:18px;border:1px solid var(--border);background:var(--surface-2);display:grid;place-items:center;overflow:hidden;color:var(--muted);flex:none}
.st-logo .pv img{width:100%;height:100%;object-fit:cover}
.st-form{max-width:560px}
.st-row{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.st-danger{border-color:color-mix(in srgb,var(--red) 40%,var(--border))}
.st-otp{display:none;margin-top:10px}.st-otp.on{display:block}
@media(max-width:560px){.st-row{grid-template-columns:1fr}}
`);

const TABS = [['profile', 'پروفایل فروشگاه'], ['security', 'امنیت'], ['account', 'حساب'], ['danger', 'داده‌ها']];

const field = (id, label, value, { hint = '', ltr = false, type = 'text', max = 100, ph = '', ac = '' } = {}) =>
  `<div class="field"><label for="${id}">${label}</label><input class="input ${ltr ? 'ltr' : ''}" id="${id}" type="${type}" ${ltr ? 'dir="ltr"' : ''} maxlength="${max}" placeholder="${esc(ph)}" value="${esc(value ?? '')}" ${ac ? `autocomplete="${ac}"` : ''} aria-describedby="${id}-err">${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err" id="${id}-err" role="alert"></div></div>`;

function showErrors(root, e, map = {}) {
  $$('.err', root).forEach((x) => (x.textContent = ''));
  const errs = e?.body?.errors;
  if (!errs) return false;
  for (const [k, msg] of Object.entries(errs)) {
    const el = $(`#${map[k] || k}-err`, root);
    if (el) el.textContent = msg;
  }
  return true;
}

export async function render(page, { me, actor, query, sub } = {}) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const r = await api('/api/v2/settings/profile');
  let p = r.profile;
  const manage = r.can_manage;
  const tabs = TABS.filter(([id]) => manage || id === 'security');
  let tab = tabs.some(([id]) => id === sub) ? sub : tabs[0][0];
  const remember = () => !!localStorage.getItem('bg_token');

  page.innerHTML = `
    <div class="page-head"><h1>تنظیمات و پروفایل</h1></div>
    <div class="tabs" role="tablist" aria-label="بخش‌های تنظیمات">${tabs.map(([id, t]) => `<button type="button" role="tab" id="t-${id}" aria-controls="st-body" data-tab="${id}" aria-selected="${id === tab}">${t}</button>`).join('')}</div>
    <div id="st-body" role="tabpanel"></div>`;
  const body = $('#st-body', page);

  const views = {
    profile() {
      body.innerHTML = `<section class="card st-form"><div class="card-head"><h3>مشخصات فروشگاه</h3></div>
        <p class="muted" style="margin-top:0">نام، لوگو و راه‌های تماس در صفحهٔ پرداخت به مشتری نمایش داده می‌شود.</p>
        <form id="pf" novalidate>
          ${field('pf-name', 'نام فروشگاه', p.name, { max: 60, ac: 'organization' })}
          <div class="field"><label for="pf-logo">لوگو</label>
            <div class="st-logo"><span class="pv" id="pf-pv">${p.logo_url ? `<img src="${esc(p.logo_url)}" alt="لوگوی فعلی">` : ICON.user}</span>
              <div><input type="file" id="pf-logo" accept="image/png,image/jpeg,image/webp" aria-describedby="pf-logo-hint pf-logo-err"><div class="hint" id="pf-logo-hint">PNG، JPG یا WebP، حداکثر ۱ مگابایت؛ مربعی بهتر دیده می‌شود.</div>
              ${p.logo_url ? '<button class="btn btn-sm btn-ghost" type="button" id="pf-rm" style="margin-top:6px">حذف لوگو</button>' : ''}</div></div>
            <div class="err" id="pf-logo-err" role="alert"></div></div>
          <div class="st-row">
            ${field('pf-phone', 'تلفن پشتیبانی', p.support_phone, { ltr: true, max: 20, ph: '09123456789', type: 'tel' })}
            ${field('pf-tg', 'تلگرام', p.support_telegram, { ltr: true, max: 80, ph: 'my_shop' })}
            ${field('pf-ig', 'اینستاگرام', p.support_instagram, { ltr: true, max: 80, ph: 'my.shop' })}
            ${field('pf-web', 'وب‌سایت', p.website, { ltr: true, max: 200, ph: 'myshop.ir', type: 'url' })}
          </div>
          <div class="hint" style="margin-bottom:12px">شناسهٔ فروشگاه (<span class="ltr">${esc(p.handle)}</span>) بعد از ثبت‌نام تغییر نمی‌کند.</div>
          <button class="btn btn-primary" type="submit">ذخیرهٔ تغییرات</button>
        </form></section>`;
      let logoData = null, removeLogo = false;
      const f = $('#pf', body);
      $('#pf-logo', body).addEventListener('change', async (e) => {
        const file = e.target.files[0], err = $('#pf-logo-err', body);
        err.textContent = ''; logoData = null;
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { err.textContent = 'فقط PNG، JPG یا WebP'; e.target.value = ''; return; }
        if (file.size > 1024 * 1024) { err.textContent = 'حجم فایل باید کمتر از ۱ مگابایت باشد'; e.target.value = ''; return; }
        logoData = await fileToDataUrl(file); removeLogo = false;
        $('#pf-pv', body).innerHTML = `<img src="${logoData}" alt="پیش‌نمایش لوگو">`;
      });
      $('#pf-rm', body)?.addEventListener('click', (e) => { removeLogo = true; logoData = null; $('#pf-pv', body).innerHTML = ICON.user; e.currentTarget.remove(); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', f);
        const payload = { name: fixArabic($('#pf-name', f).value.trim()), support_phone: toLatin($('#pf-phone', f).value.trim()), support_telegram: $('#pf-tg', f).value.trim(), support_instagram: $('#pf-ig', f).value.trim(), website: $('#pf-web', f).value.trim() };
        if (logoData) payload.logo_data_url = logoData; else if (removeLogo) payload.remove_logo = true;
        setBusy(btn, true, 'در حال ذخیره…');
        try {
          const x = await api('/api/v2/settings/profile', { method: 'PUT', body: payload });
          p = x.profile; toast('تغییرات ذخیره شد', 'ok'); views.profile();
        } catch (err) {
          if (!showErrors(f, err, { support_phone: 'pf-phone', support_telegram: 'pf-tg', support_instagram: 'pf-ig', website: 'pf-web', name: 'pf-name', logo: 'pf-logo' })) toast(err.message, 'err');
          setBusy(btn, false);
        }
      });
    },

    security() {
      body.innerHTML = `<div class="grid g2">
        <section class="card st-form"><div class="card-head"><h3>تغییر رمز عبور</h3></div>
          ${actor?.kind === 'staff' ? '<p class="muted" style="margin-top:0">این رمز فقط برای ورود خود شماست.</p>' : ''}
          <form id="pw" novalidate>
            ${field('pw-cur', 'رمز فعلی', '', { type: 'password', ltr: true, ac: 'current-password', max: 128 })}
            ${field('pw-new', 'رمز جدید', '', { type: 'password', ltr: true, ac: 'new-password', max: 128, hint: 'حداقل ۸ نویسه؛ ساده و شبیه شمارهٔ موبایل یا نام فروشگاه نباشد.' })}
            ${field('pw-rep', 'تکرار رمز جدید', '', { type: 'password', ltr: true, ac: 'new-password', max: 128 })}
            <button class="btn btn-primary" type="submit">تغییر رمز</button>
            <p class="muted" style="font-size:.82rem;margin-bottom:0">بعد از تغییر، همهٔ دستگاه‌های دیگر خارج می‌شوند.</p>
          </form></section>
        <section class="card"><div class="card-head"><h3>نشست‌ها</h3></div>
          <p class="muted" style="margin-top:0">${actor?.kind === 'staff' ? 'ورود شما از همهٔ دستگاه‌ها، از جمله این دستگاه، باطل و دوباره وارد می‌شوید.' : 'اگر گوشی یا رایانه‌ای گم شده یا رمز را جایی لو داده‌اید، همهٔ دستگاه‌ها (و همکاران) از حساب خارج می‌شوند. همین دستگاه وارد می‌ماند.'}</p>
          <button class="btn btn-danger" type="button" id="lo-all">${ICON.out} خروج از همهٔ دستگاه‌ها</button></section></div>`;
      const f = $('#pw', body);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        $$('.err', f).forEach((x) => (x.textContent = ''));
        const cur = $('#pw-cur', f).value, nw = $('#pw-new', f).value, rep = $('#pw-rep', f).value;
        const bad = !cur ? ['pw-cur', 'رمز فعلی را وارد کنید'] : passwordError(nw, { mobile: p.mobile, handle: p.handle }) ? ['pw-new', passwordError(nw, { mobile: p.mobile, handle: p.handle })] : nw !== rep ? ['pw-rep', 'تکرار رمز با رمز جدید یکی نیست'] : null;
        if (bad) { $(`#${bad[0]}-err`, f).textContent = bad[1]; $(`#${bad[0]}`, f).focus(); return; }
        const btn = $('button[type=submit]', f);
        setBusy(btn, true, 'در حال تغییر…');
        try {
          const x = await api('/api/v2/settings/password', { method: 'POST', body: { current_password: cur, new_password: nw, remember: remember() } });
          session.set(x.token, remember());
          toast('رمز تغییر کرد', 'ok'); f.reset();
        } catch (err) {
          if (!showErrors(f, err, { current_password: 'pw-cur', new_password: 'pw-new' })) toast(err.message, 'err');
        }
        setBusy(btn, false);
      });
      $('#lo-all', body).addEventListener('click', async (e) => {
        if (!(await confirmDialog('خروج از همهٔ دستگاه‌ها', 'همهٔ نشست‌های باز، به‌جز همین دستگاه، بسته می‌شوند. ادامه می‌دهید؟', 'خروج از همه', true))) return;
        setBusy(e.currentTarget, true);
        try { const x = await api('/api/v2/settings/logout-all', { method: 'POST', body: { remember: remember() } }); session.set(x.token, remember()); toast('از همهٔ دستگاه‌های دیگر خارج شدید', 'ok'); }
        catch (err) { toast(err.message, 'err'); }
        setBusy(e.currentTarget, false);
      });
    },

    account() {
      body.innerHTML = `<div class="grid g2">
        <section class="card st-form"><div class="card-head"><h3>شمارهٔ موبایل</h3><span class="pill ${p.mobile_verified ? 'ok' : 'warn'}" style="margin-inline-start:auto">${p.mobile_verified ? 'تأییدشده' : 'تأییدنشده'}</span></div>
          <p style="margin-top:0">شمارهٔ فعلی: <b class="ltr num">${esc(p.mobile || '—')}</b></p>
          <form id="mb" novalidate>
            ${field('mb-new', 'شمارهٔ جدید', '', { ltr: true, type: 'tel', max: 20, ph: '09123456789', hint: 'کد تأیید به همین شمارهٔ جدید پیامک می‌شود.', ac: 'tel' })}
            <button class="btn" type="submit" id="mb-send">ارسال کد تأیید</button>
            <div class="st-otp" id="mb-otp" aria-live="polite">
              ${field('mb-code', 'کد پنج‌رقمی', '', { ltr: true, max: 5, ac: 'one-time-code' })}
              <button class="btn btn-primary" type="button" id="mb-ok">تأیید و تغییر شماره</button>
              <div class="hint" id="mb-dev" style="margin-top:6px"></div>
            </div>
          </form></section>
        <section class="card st-form"><div class="card-head"><h3>ایمیل</h3></div>
          <p style="margin-top:0">ایمیل فعلی: <b class="ltr">${esc(p.email || 'ثبت نشده')}</b></p>
          <form id="em" novalidate>
            ${field('em-new', 'ایمیل جدید', '', { ltr: true, type: 'email', max: 120, ph: 'name@example.com', hint: 'برای حذف ایمیل، خالی بگذارید.', ac: 'email' })}
            ${field('em-pw', 'رمز عبور فعلی', '', { ltr: true, type: 'password', max: 128, ac: 'current-password' })}
            <button class="btn btn-primary" type="submit">ذخیرهٔ ایمیل</button>
          </form></section></div>`;
      const mb = $('#mb', body);
      let target = null;
      mb.addEventListener('submit', async (e) => {
        e.preventDefault();
        $$('.err', mb).forEach((x) => (x.textContent = ''));
        const m = normMobile($('#mb-new', mb).value);
        if (!m) { $('#mb-new-err', mb).textContent = 'شمارهٔ موبایل معتبر نیست'; return; }
        const btn = $('#mb-send', mb);
        setBusy(btn, true, 'در حال ارسال…');
        try {
          const x = await api('/api/v2/settings/mobile/send', { method: 'POST', body: { mobile: m } });
          target = m; $('#mb-otp', mb).classList.add('on'); $('#mb-code', mb).focus();
          $('#mb-dev', mb).textContent = x.dev_code ? `محیط توسعه: کد ${toFa(x.dev_code)}` : `کد به ${toFa(m)} پیامک شد.`;
          toast('کد تأیید ارسال شد', 'ok');
        } catch (err) {
          if (!showErrors(mb, err, { mobile: 'mb-new' })) $('#mb-new-err', mb).textContent = err.message;
        }
        setBusy(btn, false);
      });
      $('#mb-code', mb).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#mb-ok', mb).click(); } });
      $('#mb-ok', mb).addEventListener('click', async (e) => {
        const code = toLatin($('#mb-code', mb).value).trim();
        if (!/^\d{5}$/.test(code)) { $('#mb-code-err', mb).textContent = 'کد پنج‌رقمی را وارد کنید'; return; }
        setBusy(e.currentTarget, true, 'در حال بررسی…');
        try { const x = await api('/api/v2/settings/mobile/verify', { method: 'POST', body: { mobile: target, code } }); p = x.profile; toast('شمارهٔ موبایل تغییر کرد', 'ok'); views.account(); }
        catch (err) { $('#mb-code-err', mb).textContent = err.message; setBusy(e.currentTarget, false); }
      });
      const em = $('#em', body);
      em.addEventListener('submit', async (e) => {
        e.preventDefault();
        $$('.err', em).forEach((x) => (x.textContent = ''));
        const raw = $('#em-new', em).value.trim();
        const email = raw ? normEmail(raw) : '';
        if (raw && !email) { $('#em-new-err', em).textContent = 'ایمیل معتبر نیست'; return; }
        if (!$('#em-pw', em).value) { $('#em-pw-err', em).textContent = 'رمز عبور را وارد کنید'; return; }
        const btn = $('button[type=submit]', em);
        setBusy(btn, true, 'در حال ذخیره…');
        try { const x = await api('/api/v2/settings/email', { method: 'PUT', body: { email, password: $('#em-pw', em).value } }); p = x.profile; toast('ایمیل ذخیره شد', 'ok'); views.account(); }
        catch (err) { if (!showErrors(em, err, { email: 'em-new', password: 'em-pw' })) toast(err.message, 'err'); setBusy(btn, false); }
      });
    },

    danger() {
      body.innerHTML = `<section class="card st-danger st-form"><div class="card-head"><h3>خروجی داده‌های من</h3></div>
        <p style="margin-top:0">یک فایل JSON از اطلاعات فروشگاه، کارت‌ها (فقط ۴ رقم آخر)، فاکتورها، تراکنش‌ها، دستگاه‌ها، همکاران و کلیدها (بدون مقدار کلید) دریافت کنید. رمزها و کلیدهای مخفی در خروجی نیست.</p>
        <button class="btn" type="button" id="ex">${ICON.inbox} دریافت خروجی JSON</button>
        <p class="muted" style="font-size:.82rem;margin-bottom:0">برای حذف حساب از طریق «پشتیبانی» درخواست دهید؛ پیش از آن، خروجی بگیرید.</p></section>`;
      $('#ex', body).addEventListener('click', async (e) => {
        setBusy(e.currentTarget, true, 'در حال آماده‌سازی…');
        try { await download('/api/v2/settings/export', `bolgram-export-${p.handle || 'store'}.json`); } catch (err) { toast(err.message, 'err'); }
        setBusy(e.currentTarget, false);
      });
    },
  };

  const open = (id) => {
    tab = id;
    $$('[data-tab]', page).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    views[id]();
  };
  $$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));
  $('.tabs', page).addEventListener('keydown', (e) => {
    const els = $$('[data-tab]', page), i = els.indexOf(document.activeElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const n = els[(i + (e.key === 'ArrowLeft' ? 1 : -1) + els.length) % els.length];
    n.focus(); n.click();
  });
  open(tab);
}
