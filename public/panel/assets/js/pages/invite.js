import { CONFIG, api, session, toFa, toLatin, passwordError, setBusy, ICON, esc, $, $$ } from '../core.js';

const frame = (inner) => `<main class="auth"><div style="width:min(460px,100%)">
  <div class="auth-top"><a class="logo" href="${CONFIG.SITE_URL}"><img src="/favicon.svg" alt="" width="32" height="32" onerror="this.remove()">${CONFIG.SERVICE_NAME}</a>
  <button class="icon-btn" type="button" data-theme-toggle aria-label="تغییر تم">${ICON.moon}</button></div>
  <div class="auth-card">${inner}</div></div></main>`;

const field = (id, label, input, hint = '') => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err" id="${id}-err" role="alert"></div></div>`;

function otpBoxes(container, n, onComplete) {
  container.innerHTML = `<div class="otp" role="group" aria-label="کد ${toFa(n)} رقمی">${Array.from({ length: n }, (_, i) => `<input inputmode="numeric" maxlength="1" aria-label="رقم ${toFa(i + 1)}" autocomplete="${i === 0 ? 'one-time-code' : 'off'}">`).join('')}</div>`;
  const boxes = $$('input', container);
  const value = () => boxes.map((b) => b.value).join('');
  const fill = (digits, from = 0) => {
    digits.split('').slice(0, n - from).forEach((d, i) => (boxes[from + i].value = d));
    (boxes.find((b) => !b.value) || boxes[n - 1]).focus();
    if (value().length === n) onComplete?.(value());
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const d = toLatin(b.value).replace(/\D/g, '');
      if (d.length > 1) { b.value = ''; return fill(d, i); }
      b.value = d;
      if (d && i < n - 1) boxes[i + 1].focus();
      if (value().length === n) onComplete?.(value());
    });
    b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus(); });
    b.addEventListener('paste', (e) => { e.preventDefault(); fill(toLatin(e.clipboardData.getData('text')).replace(/\D/g, ''), 0); });
  });
  return { value, clear: () => { boxes.forEach((b) => (b.value = '')); boxes[0].focus(); } };
}

function resendTimer(btn, seconds) {
  let s = seconds;
  btn.disabled = true;
  const t = setInterval(() => {
    if (!btn.isConnected || s <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = 'ارسال مجدد کد'; return; }
    btn.textContent = `ارسال مجدد کد (${toFa(Math.floor(s / 60))}:${toFa(String(s % 60).padStart(2, '0'))})`;
    s--;
  }, 1000);
}

const stateCard = (title, text) => frame(`<h1>${title}</h1><p class="lead">${text}</p><a class="btn btn-primary btn-block" href="#/login">رفتن به صفحهٔ ورود</a>`);

export async function render(root, { go, query }) {
  const token = query?.get('t') || '';
  root.innerHTML = frame('<p><span class="spinner"></span> در حال بررسی دعوت‌نامه…</p>');
  let info;
  try {
    info = await api(`/api/v2/team/invite/check?t=${encodeURIComponent(token)}`, { auth: false });
  } catch (e) {
    root.innerHTML = e.status === 404 || !token
      ? stateCard('دعوت‌نامه معتبر نیست', 'این پیوند اشتباه است، قبلاً استفاده شده یا لغو شده است. از مالک فروشگاه بخواهید دعوت‌نامهٔ جدید بفرستد.')
      : stateCard('خطا در بررسی دعوت‌نامه', esc(e.body?.message || e.message));
    return;
  }
  if (info.expired) {
    root.innerHTML = stateCard('مهلت دعوت‌نامه تمام شده است', `دعوت‌نامهٔ «${esc(info.store.name)}» منقضی شده. از مالک فروشگاه بخواهید «دعوت دوباره» بزند.`);
    return;
  }

  root.innerHTML = frame(`<h1>پیوستن به «${esc(info.store.name)}»</h1>
    <p class="lead">شما به‌عنوان <b>${esc(info.role_name)}</b> دعوت شده‌اید. کد پیامکی به شمارهٔ <span class="ltr" dir="ltr">${esc(toFa(info.mobile))}</span> ارسال می‌شود.</p>
    <form id="inv" novalidate><div class="form-alert" aria-live="polite"></div>
      ${field('name', 'نام شما', `<input class="input" id="name" maxlength="60" autocomplete="name" value="${esc(info.name || '')}">`)}
      ${field('password', 'رمز عبور', '<input class="input ltr" id="password" type="password" autocomplete="new-password" maxlength="64">', 'حداقل ۸ کاراکتر؛ با همین شماره و رمز بعداً وارد می‌شوید')}
      ${field('password2', 'تکرار رمز عبور', '<input class="input ltr" id="password2" type="password" autocomplete="new-password" maxlength="64">')}
      <div class="field"><label>کد تأیید پیامکی</label><div id="otp"></div><div class="err" id="code-err" role="alert"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 14px"><button class="btn btn-ghost btn-sm" id="resend" type="button">ارسال کد</button></div>
      <button class="btn btn-primary btn-block" type="submit">پیوستن و ورود</button></form>`);
  const f = $('#inv', root), alertBox = $('.form-alert', f), resend = $('#resend', f);
  const otp = otpBoxes($('#otp', f), 5);
  const err = (id, msg) => { const e = $(`#${id}-err`, f); if (e) e.textContent = msg || ''; return !msg; };

  const sendCode = async () => {
    setBusy(resend, true, 'در حال ارسال…');
    try {
      const r = await api('/api/v2/team/invite/accept', { auth: false, method: 'POST', body: { t: token, send_code: true } });
      alertBox.innerHTML = r.dev_code ? `<div class="alert alert-warn">حالت توسعه: کد ${toFa(r.dev_code)}</div>` : '<div class="alert alert-ok">کد برایتان پیامک شد.</div>';
      setBusy(resend, false); resendTimer(resend, r.resend_in || 120);
    } catch (e) {
      setBusy(resend, false);
      if (e.body?.retry_after) resendTimer(resend, e.body.retry_after);
      alertBox.innerHTML = `<div class="alert alert-err">${esc(e.body?.message || e.message)}</div>`;
    }
  };
  resend.addEventListener('click', sendCode);
  sendCode();

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('#name', f).value.trim(), pw = $('#password', f).value, code = otp.value();
    const ok = [err('name', name.length < 2 ? 'نام خود را وارد کنید' : ''), err('password', passwordError(pw, { mobile: '' })),
      err('password2', $('#password2', f).value !== pw ? 'تکرار رمز با رمز یکی نیست' : ''), err('code', code.length === 5 ? '' : 'کد ۵ رقمی را وارد کنید')].every(Boolean);
    if (!ok) return;
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ورود…');
    try {
      const r = await api('/api/v2/team/invite/accept', { auth: false, method: 'POST', body: { t: token, name, password: pw, code } });
      session.set(r.token, true);
      location.hash = '#/dashboard';
    } catch (e) {
      setBusy(btn, false);
      for (const [k, v] of Object.entries(e.body?.errors || {})) err(k === 'code' ? 'code' : k, v);
      if (e.status === 429) alertBox.innerHTML = `<div class="alert alert-warn">${esc(e.body?.message || 'تلاش زیاد؛ کمی بعد دوباره امتحان کنید')}</div>`;
      else if (!e.body?.errors) alertBox.innerHTML = `<div class="alert alert-err">${esc(e.body?.message || e.message)}</div>`;
      if (e.body?.errors?.code) otp.clear();
    }
  });
}
