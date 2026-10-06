// Shared helpers for the panel: config, formatting, normalisation, API, UI primitives.
export const CONFIG = {
  SERVICE_NAME: 'بولگرام',
  // Payment page base URL (placeholder domain — set your real one before launch).
  PAY_BASE_URL: 'https://pay.bolgram.example',
  SITE_URL: 'https://bolgram.ir',
  SUPPORT_TELEGRAM: 'https://t.me/bolgram_support',
  ANDROID_APK_URL: '',
  IOS_SHORTCUT_URL: '',
};
/** Real payment links: the placeholder domain is swapped for the current origin while developing locally. */
export function payBase() {
  return /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) ? location.origin : CONFIG.PAY_BASE_URL;
}

// ---------- digits, text, money, dates
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
export const toFa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
export const toLatin = (s) => String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => String(FA.indexOf(d) >= 0 ? FA.indexOf(d) : AR.indexOf(d)));
export const fixArabic = (s) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
export const faNum = (n) => toFa(Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, '٬'));
export const rialToToman = (rial) => Math.round(Number(rial || 0) / 10);
export const toman = (rial) => `${faNum(rialToToman(rial))} تومان`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TZ = 'Asia/Tehran';
export const jDate = (d, opts = {}) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', ...opts }).format(new Date(d));
export const jTime = (d) => new Intl.DateTimeFormat('fa-IR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const jDateTime = (d) => `${jDate(d, { month: 'numeric' })} · ${jTime(d)}`;
export function tehranHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(d)) % 24;
}
export function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'همین الان';
  if (s < 3600) return `${toFa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${toFa(Math.floor(s / 3600))} ساعت پیش`;
  return jDate(d);
}

// ---------- validation (mirrors the server rules)
export function normMobile(input) {
  let d = toLatin(input).replace(/[\s\-()+.]/g, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}
export const normEmail = (s) => {
  const e = String(s ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
};
const RESERVED = new Set('admin api panel support pay payment login logout register signup auth www app root help docs blog status mail ftp static assets checkout dashboard billing invoice invoices webhook webhooks test null undefined settings account team about contact terms privacy owner bolgram bot system security'.split(' '));
export function handleError(raw) {
  if (/[؀-ۿ]/.test(raw)) return 'کیبورد را انگلیسی کنید؛ فقط حروف انگلیسی، عدد و _ مجاز است';
  const h = raw.trim().toLowerCase();
  if (h.length < 3 || h.length > 24) return 'نام فروشگاه باید بین ۳ تا ۲۴ کاراکتر باشد';
  if (!/^[a-z]/.test(h)) return 'نام فروشگاه باید با یک حرف انگلیسی شروع شود';
  if (!/^[a-z0-9_]+$/.test(h)) return 'فقط حروف کوچک انگلیسی، عدد و _ مجاز است';
  if (h.includes('__') || h.endsWith('_')) return '«__» پشت‌سرهم و _ در انتها مجاز نیست';
  if (RESERVED.has(h)) return 'این نام رزرو شده است';
  return null;
}
const OBVIOUS = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'qwerty123', 'qwertyui', '1q2w3e4r', 'iloveyou', 'abcd1234', '12341234', 'aa123456', 'asdfghjk']);
export function passwordError(pw, ctx = {}) {
  if (!pw) return 'رمز عبور را وارد کنید';
  if (pw.length < 8) return 'رمز عبور باید حداقل ۸ کاراکتر باشد';
  if (pw.length > 64) return 'رمز عبور حداکثر ۶۴ کاراکتر است';
  const l = toLatin(pw).toLowerCase();
  if (OBVIOUS.has(l) || /^(\d)\1+$/.test(l)) return 'این رمز خیلی ساده است';
  if (ctx.mobile && (l === ctx.mobile || l === ctx.mobile.slice(1))) return 'رمز عبور نباید با شماره موبایل یکی باشد';
  if (ctx.handle && l === ctx.handle) return 'رمز عبور نباید با نام فروشگاه یکی باشد';
  return null;
}
export function passwordScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
export function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = +num[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return num.length === 16 && sum % 10 === 0;
}
export const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- session & API
const KEY = 'bg_token';
export const session = {
  get: () => localStorage.getItem(KEY) || sessionStorage.getItem(KEY),
  set(token, remember) { this.clear(); (remember ? localStorage : sessionStorage).setItem(KEY, token); },
  clear() { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); },
};
export class ApiError extends Error {
  constructor(status, body) { super(body?.message || body?.error || 'error'); this.status = status; this.body = body || {}; }
}
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = session.get();
  if (auth && t) headers.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: 'network', message: 'اتصال اینترنت برقرار نیست یا سرور در دسترس نیست' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && data.error === 'session_expired') {
    session.clear();
    window.dispatchEvent(new CustomEvent('session-expired'));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- UI primitives
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function toast(msg, type = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
export function modal({ title, body, actions = '', onClose, wide }) {
  const prev = document.activeElement;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title" style="${wide ? 'width:min(720px,100%)' : ''}">
    <div class="modal-head"><h2 id="m-title">${title}</h2><button class="icon-btn" type="button" data-close aria-label="بستن">${ICON.x}</button></div>
    <div class="m-body">${body}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = $$('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', ov).filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  (ov.querySelector('input,select,textarea') || ov.querySelector('[data-close]')).focus();
  return { el: ov, close };
}
export function confirmDialog(title, text, okLabel = 'تأیید', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: `<p>${text}</p>`,
      actions: `<button class="btn" data-close>انصراف</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okLabel}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}
export function setBusy(btn, busy, label) {
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label || 'لطفاً صبر کنید…'}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
export async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  if (btn) { const o = btn.textContent; btn.textContent = 'کپی شد ✓'; setTimeout(() => (btn.textContent = o), 1500); } else toast('کپی شد', 'ok');
}
export function emptyState(icon, title, text, cta = '') {
  return `<div class="empty">${ICON[icon] || ICON.inbox}<b>${title}</b><p>${text}</p>${cta}</div>`;
}

// Line icons (24px, stroke)
const I = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'), eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: I('<path d="M3 3l18 18M10.6 5.1A10 10 0 0122 12s-1 2-3 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'),
  home: I('<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>'), receipt: I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'), link: I('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  wallet: I('<path d="M3 7a2 2 0 012-2h14v4"/><path d="M3 7v11a2 2 0 002 2h16V9H5a2 2 0 01-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>'), card: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'),
  crown: I('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>'), phone: I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'), app: I('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  bot: I('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>'), plug: I('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0zM12 18v4"/>'), hook: I('<path d="M18 16a4 4 0 11-6.9-2.8L14 10M6 8a4 4 0 117.4 2"/><path d="M6 16h8"/>'),
  shield: I('<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>'), users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M16 4a3.5 3.5 0 010 7M22 20c0-2.5-1.5-4.5-4-5.5"/>'), gift: I('<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M12 8S10 3 7.5 4 9 8 12 8zM12 8s2-5 4.5-4S15 8 12 8z"/>'),
  help: I('<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 4M12 17h.01"/>'), book: I('<path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/>'), star: I('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  bell: I('<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0"/>'), cog: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'), moon: I('<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'), sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'), plus: I('<path d="M12 5v14M5 12h14"/>'), out: I('<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l-5-5 5-5M5 12h11"/>'), user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  chev: I('<path d="M15 6l-6 6 6 6"/>'), inbox: I('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v7a1 1 0 01-1 1H3a1 1 0 01-1-1v-7z"/>'), bolt: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'), clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  alert: I('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'), check: I('<path d="M5 12l5 5 9-10"/>'), lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
};

// ---------- session context & permissions (filled by app.js from /api/v2/me)
export const CTX = { me: null, actor: null, roles: {}, permNames: {} };
/** True when the signed-in person (owner or team member) has the permission. */
export const can = (perm) => !!CTX.actor?.perms?.includes(perm);

/** Page-scoped CSS, injected once: useStyle('invoices', `.inv-x{...}`). */
export function useStyle(id, css) {
  if (document.getElementById(`css-${id}`)) return;
  const s = document.createElement('style');
  s.id = `css-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}

/** Reads a File as a data URL (uploads go to the API as JSON). */
export const fileToDataUrl = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });

/** Authenticated file download (CSV exports etc.). */
export async function download(path, filename) {
  const res = await fetch(path, { headers: session.get() ? { Authorization: `Bearer ${session.get()}` } : {} });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** <table> markup inside a horizontal scroller; cols: [{ key, title, render?(row), cls? }]. */
export function table(cols, rows, { empty = 'موردی پیدا نشد', rowAttr } = {}) {
  if (!rows.length) return `<div class="empty" style="padding:24px">${esc(empty)}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th scope="col" class="${c.cls || ''}">${c.title}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.title)}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

/** Pager for { page, per_page, total } responses. */
export function pager(p, onGo) {
  const pages = Math.max(1, Math.ceil((p.total || 0) / (p.per_page || 20)));
  const wrap = document.createElement('div');
  wrap.className = 'pager';
  wrap.innerHTML = `<button class="btn btn-sm" type="button" data-p="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>قبلی</button><span class="muted">صفحهٔ ${toFa(p.page)} از ${toFa(pages)} · ${faNum(p.total || 0)} مورد</span><button class="btn btn-sm" type="button" data-p="${p.page + 1}" ${p.page >= pages ? 'disabled' : ''}>بعدی</button>`;
  wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) onGo(Number(b.dataset.p)); });
  return wrap;
}
