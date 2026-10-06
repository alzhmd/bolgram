import { CONFIG, payBase, api, session, toFa, toLatin, fixArabic, normMobile, normEmail, handleError, passwordError, passwordScore, debounce, setBusy, ICON, esc, $, $$ } from './core.js';

const themeBtn = () => `<button class="icon-btn" type="button" data-theme-toggle aria-label="تغییر تم">${ICON.moon}</button>`;

function frame(inner) {
  return `<main class="auth"><div style="width:min(460px,100%)">
    <div class="auth-top"><a class="logo" href="${CONFIG.SITE_URL}"><img src="/favicon.svg" alt="" width="32" height="32" onerror="this.remove()">${CONFIG.SERVICE_NAME}</a>
      <div style="display:flex;gap:8px;align-items:center">${themeBtn()}<a class="btn btn-ghost btn-sm" href="${CONFIG.SITE_URL}">بازگشت به سایت</a></div></div>
    <div class="auth-card">${inner}</div></div></main>`;
}

const field = (id, label, input, hint = '') => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<div class="hint" id="${id}-hint">${hint}</div>` : ''}<div class="err" id="${id}-err" role="alert"></div></div>`;
const pwInput = (id, ac, extra = '') => `<div class="input-wrap"><input class="input ltr" id="${id}" name="${id}" type="password" autocomplete="${ac}" maxlength="64" aria-describedby="${id}-err ${id}-warn" ${extra}>
  <button class="eye" type="button" data-eye="${id}" aria-label="نمایش رمز" aria-pressed="false">${ICON.eye}</button></div><div class="hint" id="${id}-warn" aria-live="polite"></div>`;

function setErr(form, id, msg) {
  const el = form.querySelector(`#${id}`);
  const box = form.querySelector(`#${id}-err`);
  if (box) box.textContent = msg || '';
  if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}
function focusFirstInvalid(form) {
  const bad = form.querySelector('[aria-invalid="true"]');
  bad?.focus();
}
function wirePasswordUX(form) {
  $$('[data-eye]', form).forEach((b) => b.addEventListener('click', () => {
    const inp = form.querySelector('#' + b.dataset.eye);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'مخفی کردن رمز' : 'نمایش رمز');
    b.innerHTML = show ? ICON.eyeOff : ICON.eye;
  }));
  $$('input[type="password"]', form).forEach((inp) => {
    const warn = form.querySelector(`#${inp.id}-warn`);
    const check = (e) => {
      const msgs = [];
      if (e?.getModifierState?.('CapsLock')) msgs.push('⚠️ Caps Lock روشن است');
      if (/[؀-ۿ]/.test(inp.value)) msgs.push('⚠️ رمز حروف یا ارقام فارسی دارد؛ کیبورد را بررسی کنید');
      if (warn) warn.textContent = msgs.join(' · ');
    };
    inp.addEventListener('keyup', check);
    inp.addEventListener('keydown', check);
    inp.addEventListener('input', () => check());
  });
}
function networkAlert(form, err, retry) {
  const box = form.querySelector('.form-alert');
  if (!box) return;
  if (err.status === 0 || err.status >= 500) {
    box.innerHTML = `<div class="alert alert-err">${esc(err.status === 0 ? err.message : 'خطای سرور؛ چند لحظه بعد دوباره تلاش کنید')} <button class="btn btn-sm" type="button" data-retry>تلاش دوباره</button></div>`;
    box.querySelector('[data-retry]').addEventListener('click', retry);
  } else box.innerHTML = '';
}
const safeNext = (n) => (n && /^\/[a-z0-9/_-]*$/i.test(n) && !n.startsWith('//') ? n : '/dashboard');

// ------------------------------------------------------------------ register
export function renderRegister(root, { go, query }) {
  // Referral code from an invite link (#/register?ref=handle) is kept for the whole visit.
  const ref = query?.get('ref') || sessionStorage.getItem('bg_ref') || '';
  if (ref) sessionStorage.setItem('bg_ref', ref);
  root.innerHTML = frame(`<h1>ساخت حساب</h1><p class="lead">یک حساب برای وب، اپلیکیشن و ربات‌های تلگرام و بله.</p>
  <form id="reg" novalidate><div class="form-alert"></div>
    ${field('handle', 'نام فروشگاه (انگلیسی)', `<input class="input ltr" id="handle" name="handle" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="24" placeholder="bolgram_shop" aria-describedby="handle-hint handle-state handle-err">`, 'فقط یک بار و همین‌جا تعیین می‌شود و بعداً قابل تغییر نیست. هم اسم فروشگاه است هم آدرس صفحهٔ پرداخت. حروف کوچک انگلیسی، عدد و _')}
    <div class="state wait" id="handle-state" aria-live="polite" style="margin:-8px 0 6px"></div>
    <div class="hint ltr" id="handle-preview" style="margin:-4px 0 12px;text-align:right"></div>
    <div class="chips" id="handle-sugg" style="margin:-6px 0 12px"></div>
    ${field('mobile', 'شماره موبایل', `<input class="input ltr" id="mobile" name="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="۰۹۱۲۳۴۵۶۷۸۹" maxlength="20">`)}
    ${field('email', 'ایمیل (اختیاری)', `<input class="input ltr" id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" maxlength="120">`)}
    ${field('password', 'رمز عبور', pwInput('password', 'new-password'), '<div class="meter" aria-hidden="true"><i id="pw-meter"></i></div><span id="pw-label"></span>')}
    ${field('password2', 'تکرار رمز عبور', pwInput('password2', 'new-password'))}
    <label class="check"><input type="checkbox" id="terms"> <span><a href="${CONFIG.SITE_URL}/legal.html#terms" target="_blank" rel="noopener">قوانین استفاده</a> و <a href="${CONFIG.SITE_URL}/legal.html#privacy" target="_blank" rel="noopener">حریم خصوصی</a> را می‌پذیرم.</span></label>
    <div class="err" id="terms-err" role="alert"></div>
    <button class="btn btn-primary btn-block" style="margin-top:12px" type="submit">ساخت حساب</button>
  </form>
  <p class="auth-foot">حساب دارید؟ <a href="#/login">ورود</a></p>
  <p class="hint" style="text-align:center">بعد از ثبت‌نام در پنل این مسیر را می‌روید: اشتراک ← کارت بانکی ← اتصال SMS ← لینک فروش</p>`);
  const f = $('#reg', root);
  wirePasswordUX(f);
  let handleStatus = 'empty';
  const state = $('#handle-state', root), preview = $('#handle-preview', root), sugg = $('#handle-sugg', root);
  const showPreview = (h) => (preview.textContent = h ? `${payBase()}/${h}` : '');
  const check = debounce(async (h) => {
    try {
      const r = await api(`/api/v2/auth/handle-check?handle=${encodeURIComponent(h)}`, { auth: false });
      if ($('#handle', f).value.trim().toLowerCase() !== h) return;
      handleStatus = r.status;
      state.className = `state ${r.status === 'free' ? 'ok' : 'bad'}`;
      state.textContent = r.status === 'free' ? '✓ این نام آزاد است' : r.message || 'این نام قابل استفاده نیست';
      sugg.innerHTML = (r.suggestions || []).map((s) => `<button type="button" class="chip ltr" data-s="${esc(s)}">${esc(s)}</button>`).join('');
    } catch { state.className = 'state wait'; state.textContent = 'بررسی ممکن نشد؛ هنگام ثبت دوباره بررسی می‌شود'; handleStatus = 'unknown'; }
  }, 450);
  const onHandle = () => {
    const inp = $('#handle', f);
    const raw = inp.value;
    sugg.innerHTML = '';
    const err = handleError(raw);
    if (/[؀-ۿ]/.test(raw)) { handleStatus = 'invalid'; state.className = 'state bad'; state.textContent = 'کیبورد را انگلیسی کنید'; showPreview(''); return; }
    const h = raw.trim().toLowerCase();
    if (inp.value !== h && !err) inp.value = h;
    showPreview(err ? '' : h);
    if (!raw) { handleStatus = 'empty'; state.textContent = ''; return; }
    if (err) { handleStatus = 'invalid'; state.className = 'state bad'; state.textContent = err; return; }
    handleStatus = 'checking'; state.className = 'state wait'; state.innerHTML = '<span class="spinner"></span> در حال بررسی…';
    check(h);
  };
  $('#handle', f).addEventListener('input', onHandle);
  sugg.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { $('#handle', f).value = b.dataset.s; onHandle(); } });
  const pw = $('#password', f);
  pw.addEventListener('input', () => {
    const s = passwordScore(pw.value), colors = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'];
    $('#pw-meter', f).style.width = `${pw.value ? (s + 1) * 20 : 0}%`;
    $('#pw-meter', f).style.background = colors[s];
    $('#pw-label', f).textContent = pw.value ? ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'][s] : '';
  });

  const validators = {
    handle: () => setErr(f, 'handle', handleError($('#handle', f).value) || (handleStatus === 'taken' ? 'این نام قبلاً گرفته شده است' : handleStatus === 'empty' ? 'نام فروشگاه را وارد کنید' : '')),
    mobile: () => setErr(f, 'mobile', normMobile($('#mobile', f).value) ? '' : 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)'),
    email: () => { const v = $('#email', f).value.trim(); return setErr(f, 'email', v && !normEmail(v) ? 'ایمیل معتبر نیست' : ''); },
    password: () => setErr(f, 'password', passwordError(pw.value, { mobile: normMobile($('#mobile', f).value), handle: $('#handle', f).value.trim().toLowerCase() })),
    password2: () => setErr(f, 'password2', $('#password2', f).value !== pw.value ? 'تکرار رمز با رمز یکی نیست' : ''),
  };
  for (const [id, v] of Object.entries(validators)) $('#' + id, f).addEventListener('blur', () => { if ($('#' + id, f).value) v(); });
  $('#email', f).addEventListener('blur', (e) => (e.target.value = e.target.value.trim().toLowerCase()));

  const submit = async (e) => {
    e?.preventDefault();
    const ok = Object.values(validators).map((v) => v()).every(Boolean);
    const terms = setErr(f, 'terms', $('#terms', f).checked ? '' : 'برای ساخت حساب، قوانین را بپذیرید');
    if (!ok || !terms) return focusFirstInvalid(f) || (!terms && $('#terms', f).focus());
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ساخت حساب…');
    try {
      const r = await api('/api/v2/auth/register', {
        auth: false, method: 'POST',
        body: { handle: $('#handle', f).value.trim().toLowerCase(), mobile: normMobile($('#mobile', f).value), email: normEmail($('#email', f).value) || undefined, password: pw.value, terms: true, ...(ref ? { ref } : {}) },
      });
      session.set(r.token, true);
      localStorage.setItem('bg_quickstart', '1');
      go(r.verify_required && !r.merchant.mobile_verified ? '/verify' : '/dashboard');
    } catch (err) {
      setBusy(btn, false);
      for (const [k, msg] of Object.entries(err.body?.errors || {})) setErr(f, k, msg);
      if (err.body?.suggestions) sugg.innerHTML = err.body.suggestions.map((s) => `<button type="button" class="chip ltr" data-s="${esc(s)}">${esc(s)}</button>`).join('');
      networkAlert(f, err, submit);
      if (err.status === 429) f.querySelector('.form-alert').innerHTML = '<div class="alert alert-warn">تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کنید</div>';
      focusFirstInvalid(f);
    }
  };
  f.addEventListener('submit', submit);
}

// ------------------------------------------------------------------ login
export function renderLogin(root, { go, query }) {
  const expired = query.get('expired') === '1';
  root.innerHTML = frame(`<h1>ورود</h1><p class="lead">به پنل ${CONFIG.SERVICE_NAME} خوش برگشتید.</p>
  ${expired ? '<div class="alert alert-warn" style="margin-bottom:14px">نشست شما تمام شد؛ لطفاً دوباره وارد شوید.</div>' : ''}
  <form id="login" novalidate><div class="form-alert"></div>
    ${field('mobile', 'شماره موبایل', `<input class="input ltr" id="mobile" name="username" type="tel" inputmode="tel" autocomplete="username" placeholder="۰۹۱۲۳۴۵۶۷۸۹" maxlength="20">`)}
    ${field('email', 'ایمیل (اختیاری — مخصوص حساب قدیمی)', `<input class="input ltr" id="email" type="email" inputmode="email" autocomplete="email" maxlength="120">`, 'حداقل یکی از موبایل یا ایمیل لازم است.')}
    ${field('password', 'رمز عبور', pwInput('password', 'current-password'))}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <label class="check"><input type="checkbox" id="remember" checked> مرا به خاطر بسپار</label><a href="#/forgot">فراموشی رمز؟</a></div>
    <button class="btn btn-primary btn-block" type="submit">ورود</button>
  </form>
  <p class="auth-foot">حساب ندارید؟ <a href="#/register">ثبت‌نام</a></p>`);
  const f = $('#login', root);
  wirePasswordUX(f);
  let timer = null;
  const lockout = (sec) => {
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    const tick = () => {
      if (sec <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = 'ورود'; f.querySelector('.form-alert').innerHTML = ''; return; }
      f.querySelector('.form-alert').innerHTML = `<div class="alert alert-warn">به دلیل تلاش‌های ناموفق، ${toFa(sec)} ثانیه صبر کنید.</div>`;
      btn.textContent = `صبر کنید (${toFa(sec)})`;
      sec--;
    };
    clearInterval(timer); tick(); timer = setInterval(tick, 1000);
  };
  const submit = async (e) => {
    e?.preventDefault();
    const mobileRaw = $('#mobile', f).value.trim(), emailRaw = $('#email', f).value.trim();
    const mobile = mobileRaw ? normMobile(mobileRaw) : null, email = emailRaw ? normEmail(emailRaw) : null;
    let ok = setErr(f, 'mobile', mobileRaw && !mobile ? 'شماره موبایل معتبر نیست' : !mobileRaw && !emailRaw ? 'شماره موبایل یا ایمیل را وارد کنید' : '');
    ok = setErr(f, 'email', emailRaw && !email ? 'ایمیل معتبر نیست' : '') && ok;
    ok = setErr(f, 'password', $('#password', f).value ? '' : 'رمز عبور را وارد کنید') && ok;
    if (!ok) return focusFirstInvalid(f);
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ورود…');
    try {
      const r = await api('/api/v2/auth/login', { auth: false, method: 'POST', body: { mobile: mobile || undefined, email: mobile ? undefined : email, password: $('#password', f).value, remember: $('#remember', f).checked } });
      session.set(r.token, $('#remember', f).checked);
      go(safeNext(query.get('next')));
    } catch (err) {
      setBusy(btn, false);
      if (err.status === 429) return lockout(Number(err.body.retry_after) || 30);
      if (err.status === 401 || err.status === 422) f.querySelector('.form-alert').innerHTML = '<div class="alert alert-err">شماره یا رمز درست نیست</div>';
      else networkAlert(f, err, submit);
    }
  };
  f.addEventListener('submit', submit);
}

// ------------------------------------------------------------------ OTP boxes
function otpBoxes(container, n = 5, onComplete) {
  container.innerHTML = `<div class="otp" role="group" aria-label="کد ${toFa(n)} رقمی">${Array.from({ length: n }, (_, i) => `<input inputmode="numeric" maxlength="1" aria-label="رقم ${toFa(i + 1)}" ${i === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'}>`).join('')}</div>`;
  const boxes = $$('input', container);
  const value = () => boxes.map((b) => b.value).join('');
  const fill = (digits, from = 0) => {
    digits.split('').slice(0, n - from).forEach((d, i) => (boxes[from + i].value = d));
    const next = boxes.find((b) => !b.value);
    (next || boxes[n - 1]).focus();
    if (value().length === n) onComplete(value());
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const d = toLatin(b.value).replace(/\D/g, '');
      if (d.length > 1) { b.value = ''; return fill(d, i); }
      b.value = d;
      if (d && i < n - 1) boxes[i + 1].focus();
      if (value().length === n) onComplete(value());
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowLeft' && i < n - 1) boxes[i + 1].focus();
    });
    b.addEventListener('paste', (e) => { e.preventDefault(); fill(toLatin(e.clipboardData.getData('text')).replace(/\D/g, ''), 0); });
  });
  return { value, clear: () => { boxes.forEach((b) => (b.value = '')); boxes[0].focus(); } };
}
function resendTimer(btn, seconds, label = 'ارسال مجدد کد') {
  let s = seconds;
  btn.disabled = true;
  const t = setInterval(() => {
    if (s <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `${label} (${toFa(Math.floor(s / 60))}:${toFa(String(s % 60).padStart(2, '0'))})`;
    s--;
  }, 1000);
  btn.textContent = label;
}

// ------------------------------------------------------------------ verify mobile (after signup)
export function renderVerify(root, { go }) {
  root.innerHTML = frame(`<h1>تأیید شماره موبایل</h1><p class="lead">کد ۵ رقمی پیامک‌شده را وارد کنید.</p>
    <div class="form-alert"></div><div id="otp"></div>
    <div style="display:flex;justify-content:space-between;margin-top:16px"><button class="btn btn-ghost btn-sm" id="resend" type="button">ارسال کد</button><button class="btn btn-ghost btn-sm" id="skip" type="button">بعداً</button></div>`);
  const alertBox = $('.form-alert', root);
  const resend = $('#resend', root);
  const send = async () => {
    try {
      const r = await api('/api/v2/auth/otp/send', { method: 'POST', body: { purpose: 'verify' } });
      alertBox.innerHTML = r.dev_code ? `<div class="alert alert-warn">حالت توسعه: کد ${toFa(r.dev_code)}</div>` : '';
      resendTimer(resend, r.resend_in);
    } catch (err) {
      if (err.body?.retry_after) resendTimer(resend, err.body.retry_after);
      alertBox.innerHTML = `<div class="alert alert-err">${esc(err.body?.message || err.message)}</div>`;
    }
  };
  const otp = otpBoxes($('#otp', root), 5, async (code) => {
    try {
      await api('/api/v2/auth/otp/verify', { method: 'POST', body: { purpose: 'verify', code } });
      go('/dashboard');
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-err">${esc(err.body?.message || 'کد درست نیست')}</div>`;
      otp.clear();
    }
  });
  resend.addEventListener('click', send);
  $('#skip', root).addEventListener('click', () => go('/dashboard'));
  send();
}

// ------------------------------------------------------------------ forgot password (3 steps)
export function renderForgot(root, { go }) {
  let mobile = null, resetToken = null;
  const step1 = () => {
    root.innerHTML = frame(`<h1>فراموشی رمز</h1><p class="lead">مرحلهٔ ۱ از ۳ — شماره موبایل حساب را وارد کنید.</p>
      <form id="f1" novalidate><div class="form-alert"></div>
      ${field('mobile', 'شماره موبایل', `<input class="input ltr" id="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="۰۹۱۲۳۴۵۶۷۸۹" maxlength="20">`)}
      <button class="btn btn-primary btn-block" type="submit">ارسال کد</button></form>
      <p class="auth-foot"><a href="#/login">بازگشت به ورود</a></p>`);
    const f = $('#f1', root);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      mobile = normMobile($('#mobile', f).value);
      if (!setErr(f, 'mobile', mobile ? '' : 'شماره موبایل معتبر نیست')) return focusFirstInvalid(f);
      const btn = f.querySelector('[type="submit"]');
      setBusy(btn, true, 'در حال ارسال…');
      try {
        const r = await api('/api/v2/auth/otp/send', { auth: false, method: 'POST', body: { mobile, purpose: 'reset' } });
        step2(r.resend_in, r.dev_code);
      } catch (err) {
        setBusy(btn, false);
        if (err.status === 429 && err.body.error === 'otp_wait') return step2(err.body.retry_after);
        f.querySelector('.form-alert').innerHTML = `<div class="alert alert-err">${esc(err.body?.message || err.message)}</div>`;
      }
    });
  };
  const step2 = (resendIn, devCode) => {
    root.innerHTML = frame(`<h1>کد پیامکی</h1><p class="lead">مرحلهٔ ۲ از ۳ — کد ارسال‌شده به <span class="ltr num">${toFa(mobile)}</span> را وارد کنید.</p>
      <div class="form-alert">${devCode ? `<div class="alert alert-warn">حالت توسعه: کد ${toFa(devCode)}</div>` : ''}</div><div id="otp"></div>
      <div style="display:flex;justify-content:space-between;margin-top:16px"><button class="btn btn-ghost btn-sm" id="resend" type="button"></button><button class="btn btn-ghost btn-sm" id="back" type="button">تغییر شماره</button></div>`);
    const alertBox = $('.form-alert', root);
    const resend = $('#resend', root);
    resendTimer(resend, resendIn || 120);
    resend.addEventListener('click', async () => {
      try { const r = await api('/api/v2/auth/otp/send', { auth: false, method: 'POST', body: { mobile, purpose: 'reset' } }); resendTimer(resend, r.resend_in); alertBox.innerHTML = r.dev_code ? `<div class="alert alert-warn">حالت توسعه: کد ${toFa(r.dev_code)}</div>` : ''; }
      catch (err) { if (err.body?.retry_after) resendTimer(resend, err.body.retry_after); alertBox.innerHTML = `<div class="alert alert-err">${esc(err.body?.message || err.message)}</div>`; }
    });
    $('#back', root).addEventListener('click', step1);
    const otp = otpBoxes($('#otp', root), 5, async (code) => {
      try {
        const r = await api('/api/v2/auth/otp/verify', { auth: false, method: 'POST', body: { mobile, code, purpose: 'reset' } });
        resetToken = r.reset_token;
        step3();
      } catch (err) {
        alertBox.innerHTML = `<div class="alert alert-err">${esc(err.body?.message || 'کد درست نیست')}</div>`;
        otp.clear();
      }
    });
  };
  const step3 = () => {
    root.innerHTML = frame(`<h1>رمز جدید</h1><p class="lead">مرحلهٔ ۳ از ۳ — رمز تازه را وارد کنید. با این کار از همهٔ دستگاه‌ها خارج می‌شوید.</p>
      <form id="f3" novalidate><div class="form-alert"></div>
      ${field('password', 'رمز جدید', pwInput('password', 'new-password'))}${field('password2', 'تکرار رمز جدید', pwInput('password2', 'new-password'))}
      <button class="btn btn-primary btn-block" type="submit">ذخیرهٔ رمز</button></form>`);
    const f = $('#f3', root);
    wirePasswordUX(f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#password', f).value;
      let ok = setErr(f, 'password', passwordError(pw, { mobile }));
      ok = setErr(f, 'password2', $('#password2', f).value !== pw ? 'تکرار رمز با رمز یکی نیست' : '') && ok;
      if (!ok) return focusFirstInvalid(f);
      const btn = f.querySelector('[type="submit"]');
      setBusy(btn, true, 'در حال ذخیره…');
      try {
        await api('/api/v2/auth/reset', { auth: false, method: 'POST', body: { reset_token: resetToken, password: pw } });
        root.innerHTML = frame(`<h1>رمز تغییر کرد</h1><p class="lead">حالا با رمز جدید وارد شوید.</p><a class="btn btn-primary btn-block" href="#/login">ورود</a>`);
      } catch (err) {
        setBusy(btn, false);
        for (const [k, msg] of Object.entries(err.body?.errors || {})) setErr(f, k, msg);
        if (!err.body?.errors) f.querySelector('.form-alert').innerHTML = `<div class="alert alert-err">${esc(err.body?.message || err.message)}</div>`;
      }
    });
  };
  step1();
}
export { fixArabic };
