// Owner panel helpers: own session + API wrapper (token key bg_owner_token), forms, sheet, labels.
import { ApiError, esc, ICON, emptyState, $, $$ } from '/panel/assets/js/core.js';

const KEY = 'bg_owner_token';
export const session = {
  get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } },
  set(token, remember) { this.clear(); try { (remember ? localStorage : sessionStorage).setItem(KEY, token); } catch { /* storage blocked */ } },
  clear() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

async function send(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = session.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: 'network', message: 'اتصال به سرور برقرار نشد' });
  }
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.error === 'session_expired') { session.clear(); window.dispatchEvent(new CustomEvent('owner-session-expired')); }
  }
  return res;
}
/** JSON call to /api/owner/*; throws ApiError. */
export async function oapi(path, opts) {
  const res = await send(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
/** Authenticated file fetch (documents, attachments) → Blob. */
export async function ofile(path) {
  const res = await send(path);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return res.blob();
}
export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const errText = (e) => e?.body?.message || Object.values(e?.body?.errors || {})[0] || e?.message || 'خطا';

// ---------- page chrome
export const loading = (page) => { page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>'; };
export function showError(page, e, retry) {
  page.innerHTML = `<section class="card">${emptyState('alert', 'بارگذاری انجام نشد', esc(errText(e)), '<button class="btn btn-primary" type="button" data-retry>تلاش دوباره</button>')}</section>`;
  $('[data-retry]', page)?.addEventListener('click', retry);
}
export const head = (title, actions = '') => `<div class="page-head"><h1>${title}</h1>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
export const pill = (map, key) => { const [t, c] = map[key] || [key ?? '—', '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
export const stars = (n) => `<span aria-label="${n} از ۵" role="img" style="color:var(--amber);letter-spacing:2px;direction:ltr;display:inline-block">${'★'.repeat(n)}<span style="color:var(--border)">${'★'.repeat(5 - n)}</span></span>`;

// ---------- forms
export function clearErrors(root) {
  $$('[data-err]', root).forEach((e) => { e.textContent = ''; });
  $$('[aria-invalid="true"]', root).forEach((i) => i.removeAttribute('aria-invalid'));
}
/** Puts server field errors under inputs: `[data-err="key"]` + `[name="key"]`. Returns the keys that had no field. */
export function showErrors(root, errors = {}) {
  clearErrors(root);
  const orphan = [];
  let first = null;
  for (const [k, msg] of Object.entries(errors)) {
    const slot = root.querySelector(`[data-err="${CSS.escape(k)}"]`);
    if (!slot) { orphan.push(msg); continue; }
    slot.textContent = msg;
    const inp = root.querySelector(`[name="${CSS.escape(k)}"]`);
    inp?.setAttribute('aria-invalid', 'true');
    first ||= inp || slot;
  }
  first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  if (first?.focus) first.focus({ preventScroll: true });
  return orphan;
}
export const field = (name, label, control, hint = '') =>
  `<div class="field"><label for="f-${name}">${label}</label>${control}${hint ? `<span class="hint">${hint}</span>` : ''}<span class="err" data-err="${name}" role="alert"></span></div>`;
export const input = (name, value = '', attrs = '') => `<input class="input" id="f-${name}" name="${name}" value="${esc(value)}" ${attrs}>`;

// ---------- side sheet (store detail etc.)
const openSheets = new Set();
/** Closes every open sheet without firing onClose (used when the route changes). */
export function closeSheets() { for (const s of [...openSheets]) s.close(true); }
export function sheet({ title, body, onClose }) {
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const el = document.createElement('aside');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><h2 style="flex:1;min-width:0;overflow-wrap:anywhere">${title}</h2><button class="icon-btn" type="button" data-close aria-label="بستن">${ICON.x}</button></div><div data-body>${body}</div>`;
  const handle = { el, body: el.querySelector('[data-body]'), close: null };
  handle.close = (silent) => {
    if (!openSheets.has(handle)) return;
    openSheets.delete(handle);
    document.removeEventListener('keydown', onKey);
    back.remove(); el.remove();
    if (!silent) { prev?.focus?.(); onClose?.(); }
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) handle.close(); };
  back.addEventListener('click', () => handle.close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) handle.close(); });
  document.addEventListener('keydown', onKey);
  openSheets.add(handle);
  document.body.append(back, el);
  el.querySelector('[data-close]').focus();
  return handle;
}

// ---------- labels
export const TICKET_STATUS = { open: ['در انتظار پاسخ', 'warn'], answered: ['پاسخ داده شد', 'ok'], waiting: ['در حال بررسی', ''], closed: ['بسته شده', ''] };
export const PRIORITY = { normal: ['عادی', ''], high: ['مهم', 'warn'], urgent: ['فوری', 'bad'] };
export const CATEGORY = { payment: 'پرداخت و واریزی', technical: 'مشکل فنی', billing: 'مالی و صورت‌حساب', account: 'حساب کاربری', other: 'سایر' };
export const INVOICE_STATUS = { PAID: ['پرداخت‌شده', 'ok'], PENDING: ['در انتظار', 'warn'], EXPIRED: ['منقضی', 'bad'], CANCELLED: ['لغوشده', 'bad'], FAILED: ['ناموفق', 'bad'] };
export const STORE_STATUS = { ACTIVE: ['فعال', 'ok'], SUSPENDED: ['معلق', 'bad'] };
export const CHANNEL = { instagram: 'اینستاگرام', telegram: 'تلگرام', in_person: 'حضوری', website: 'وب‌سایت', other: 'سایر', api: 'API' };
export const storeLink = (id, label) => `<a href="#/stores/${encodeURIComponent(id)}">${esc(label)}</a>`;
export const storeCell = (s) => `<b>${esc(s?.name || s?.store_name || '—')}</b><br><span class="muted ltr" style="font-size:.8rem">@${esc(s?.handle || s?.store_handle || '')}</span>`;

/** Persian names for audit_log actions (unknown ones are shown as-is). */
export const ACTION = {
  'owner.suspend': 'تعلیق فروشگاه', 'owner.activate': 'فعال‌سازی فروشگاه', 'owner.revoke_sessions': 'خروج همهٔ نشست‌ها', 'owner.site.update': 'ویرایش محتوای سایت',
  'billing.plan_created': 'ساخت پلن', 'billing.plan_updated': 'ویرایش پلن', 'billing.plan_deleted': 'حذف پلن', 'billing.settings_updated': 'ویرایش تنظیمات مالی',
  'wallet.adjusted': 'اصلاح موجودی کیف پول', 'wallet.topup_created': 'ساخت شارژ کیف پول', 'plan.subscribed': 'خرید پلن',
  'notification.broadcast': 'ارسال اعلان همگانی', 'review.moderated': 'مدیریت نظر', 'ticket.admin_reply': 'پاسخ پشتیبانی', 'ticket.created': 'ثبت تیکت',
  'trust.submitted': 'ارسال درخواست نماد اعتماد', 'trust.approved': 'تأیید نماد اعتماد', 'trust.rejected': 'رد نماد اعتماد',
  'deposit.approved': 'تأیید واریزی بی‌صاحب', 'deposit.rejected': 'رد واریزی بی‌صاحب', 'invoice.cancelled': 'لغو فاکتور',
  'device.revoked': 'ابطال دستگاه', 'device.pair_code': 'کد اتصال دستگاه', 'device.renamed': 'تغییر نام دستگاه',
  'apikey.created': 'ساخت کلید API', 'apikey.revoked': 'ابطال کلید API', 'webhook.url_set': 'تنظیم آدرس وب‌هوک', 'webhook.resent': 'ارسال دوبارهٔ وب‌هوک',
  'team.invited': 'دعوت همکار', 'team.removed': 'حذف همکار', 'team.accepted': 'پذیرش دعوت', 'settings.password_changed': 'تغییر رمز عبور', 'settings.logout_all': 'خروج از همهٔ دستگاه‌ها',
  'link.created': 'ساخت لینک پرداخت', 'link.deleted': 'حذف لینک پرداخت',
};
export const actionName = (a) => ACTION[a] || a;
