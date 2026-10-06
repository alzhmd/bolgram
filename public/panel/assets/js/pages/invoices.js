// Invoices: filterable list (filters live in the hash query), detail sheet with timeline, cancel, pay link and CSV export.
import { api, can, payBase, esc, toFa, toLatin, faNum, toman, jDateTime, jTime, ago, debounce, $, $$, toast, confirmDialog, setBusy, copy, emptyState, ICON, table, pager, useStyle, download } from '../core.js';
import { rangeControl, fmtJ, preset } from '../jdate.js';
import { quickInvoice } from '../shell.js';

export const STATUS = { PENDING: ['در انتظار پرداخت', 'warn'], PAID: ['پرداخت‌شده', 'ok'], EXPIRED: ['منقضی', ''], CANCELLED: ['لغوشده', 'bad'] };
export const CHANNELS = [['instagram', 'اینستاگرام'], ['telegram', 'تلگرام'], ['in_person', 'حضوری'], ['website', 'سایت'], ['other', 'سایر'], ['api', 'API و افزونه‌ها']];
const CHANNEL_NAME = Object.fromEntries(CHANNELS);
const STATUS_TABS = [['', 'همه'], ['pending', 'در انتظار'], ['paid', 'پرداخت‌شده'], ['expired', 'منقضی'], ['cancelled', 'لغوشده']];
const SORTS = [['newest', 'جدیدترین'], ['oldest', 'قدیمی‌ترین'], ['amount_desc', 'بیشترین مبلغ'], ['amount_asc', 'کمترین مبلغ']];
const PAY_SOURCE = { auto: 'خودکار — تطبیق مبلغ یکتا با پیامک بانک', manual: 'دستی — تأیید واریزی بی‌صاحب', customer: 'کد پیگیری ثبت‌شده توسط مشتری' };
const DEFAULTS = { range: 'all', from: '', to: '', status: '', channel: '', q: '', min: '', max: '', sort: 'newest', page: 1 };
const DL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

export const statusPill = (s) => { const [t, c] = STATUS[s] || [s, '']; return `<span class="pill ${c}">${t}</span>`; };
const card4 = (l4) => (l4 ? `<span class="ltr num">**** ${esc(l4)}</span>` : '—');
const digits = (s) => toLatin(s).replace(/\D/g, '');

const CSS = `
.inv-page{display:flex;flex-direction:column;gap:16px;min-width:0}
.inv-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.inv-seg{display:flex;width:max-content;max-width:100%;overflow-x:auto;scrollbar-width:none}
.inv-seg button{white-space:nowrap}
.inv-search{position:relative;flex:2 1 260px;display:flex}
.inv-search svg{position:absolute;inset-inline-start:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.inv-search .input{padding-inline-start:40px;width:100%}
.inv-amt{display:flex;align-items:center;gap:8px;flex:1 1 260px;min-width:0}
.inv-amt .input{width:0;min-width:0;flex:1 1 0}
.inv-totals{display:flex;flex-wrap:wrap;gap:10px}
.inv-totals .chip{cursor:default;display:inline-flex;gap:6px;align-items:center;padding:6px 14px}
.inv-totals b{font-weight:800}
.inv-list[aria-busy="true"] .table-wrap,.inv-list[aria-busy="true"] .table{opacity:.55;transition:opacity .15s}
.inv-id{font-weight:700;text-decoration:none;font-size:.85rem;letter-spacing:.02em}
.inv-note{font-size:.8rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inv-sub{font-size:.8rem}
body.inv-sheet-open .overlay{z-index:62}
body.inv-sheet-open{overflow:hidden}
.inv-sheet{display:flex;flex-direction:column;gap:16px;padding-bottom:calc(20px + env(safe-area-inset-bottom))}
.inv-sheet .sh-head{display:flex;align-items:flex-start;gap:10px}
.inv-sheet .sh-head .icon-btn{margin-inline-start:auto;flex:none}
.inv-sheet .sh-amount{font-size:1.9rem;font-weight:800;line-height:1.2}
.inv-sheet .sh-amount small{font-size:.9rem;font-weight:600;color:var(--muted)}
.inv-sheet .sh-link{display:flex;gap:8px}
.inv-sheet .sh-link .input{min-width:0;flex:1;font-size:.82rem}
.inv-sheet .sh-actions{display:flex;flex-wrap:wrap;gap:8px}
.inv-sheet .timeline li b{display:block;font-weight:600}
.inv-sheet .timeline li .muted{font-size:.8rem}
.inv-sheet .timeline li.tl-paid::before,.inv-sheet .timeline li.tl-deposit::before{background:var(--green)}
.inv-sheet .timeline li.tl-cancelled::before{background:var(--red)}
.inv-sheet .timeline li.tl-expired::before{background:var(--muted)}
.inv-sheet .timeline li.tl-deadline::before{background:transparent;border:2px solid var(--amber);width:7px;height:7px}
.inv-sheet .timeline li:not(:last-child)::after{content:"";position:absolute;inset-inline-start:8px;top:20px;bottom:-12px;width:1px;background:var(--border)}
.inv-sheet details summary{cursor:pointer;font-weight:600}
.sms-raw{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:10px 0 0;font-family:inherit;font-size:.88rem;line-height:1.9}
@media (max-width:640px){.inv-note{max-width:180px}.inv-sheet .sh-amount{font-size:1.6rem}}
@media (max-width:480px){.inv-seg button{padding:8px 9px;font-size:.84rem}}
`;

// ---------- hash query <-> filter state
function readState(query) {
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (query.has(k)) s[k] = query.get(k);
  s.page = Math.max(1, Number(s.page) || 1);
  if (!['all', 'custom', ...['today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'year']].includes(s.range)) s.range = 'all';
  if (s.range === 'custom' && !(s.from && s.to && !isNaN(Date.parse(s.from)) && !isNaN(Date.parse(s.to)))) s.range = 'all';
  if (s.range !== 'custom') { s.from = ''; s.to = ''; }
  if (!SORTS.some(([v]) => v === s.sort)) s.sort = 'newest';
  if (!STATUS_TABS.some(([v]) => v === s.status)) s.status = '';
  s.min = digits(s.min); s.max = digits(s.max);
  return s;
}
function hashQuery(s) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (String(v) !== String(DEFAULTS[k]) && v !== '') p.set(k, v);
  return p.toString();
}
function apiQuery(s, extra = {}) {
  const p = new URLSearchParams();
  const r = s.range === 'custom' ? { from: new Date(s.from), to: new Date(s.to) } : s.range !== 'all' ? preset(s.range) : null;
  if (r) { p.set('from', r.from.toISOString()); p.set('to', r.to.toISOString()); }
  for (const k of ['status', 'channel', 'q', 'min', 'max', 'sort']) if (s[k]) p.set(k, s[k]);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}
const listUrl = (s) => { const q = hashQuery(s); return `#/invoices${q ? '?' + q : ''}`; };

// ---------- module state (survives the router's re-render when the sheet closes)
let saved = null; // { key, root, scrollY, who }
let sheet = null; // { id, close }
window.addEventListener('hashchange', () => {
  if (!/^#\/invoices(\/|\?|$)/.test(location.hash)) { sheet?.close({ silent: true }); saved = null; }
});

export async function render(page, { query, sub = [], actor }) {
  useStyle('invoices', CSS);
  sheet?.close({ silent: true });
  const state = readState(query);
  const who = `${actor?.kind}:${actor?.id}`;
  const key = hashQuery(state);
  // Coming back from an open invoice: reuse the list as it was (data, scroll) instead of rebuilding it.
  if (saved && saved.key === key && saved.who === who && !sub[0]) {
    const { root, scrollY, reload } = saved;
    saved = null;
    page.replaceChildren(root);
    window.scrollTo(0, scrollY);
    reload();
    return;
  }
  saved = null;

  const root = document.createElement('div');
  root.className = 'inv-page';
  page.replaceChildren(root);
  root.innerHTML = `
    <div class="page-head"><h1>فاکتورها</h1><span class="muted" id="inv-count"></span>
      <div class="actions">
        ${can('invoices:manage') ? `<button class="btn" type="button" id="inv-csv">${DL} خروجی اکسل</button>` : ''}
        ${can('invoices:create') ? `<button class="btn btn-primary" type="button" id="inv-new">${ICON.plus} فاکتور جدید</button>` : ''}
      </div></div>
    <section class="card inv-filters" aria-label="فیلتر فاکتورها">
      <div class="seg inv-seg" role="group" aria-label="وضعیت فاکتور">${STATUS_TABS.map(([v, t]) => `<button type="button" data-status="${v}" aria-pressed="${state.status === v}">${t}</button>`).join('')}</div>
      <div class="toolbar">
        <div class="inv-search">${ICON.search}<label class="sr-only" for="inv-q">جستجو</label><input class="input" type="search" id="inv-q" maxlength="80" autocomplete="off" placeholder="شمارهٔ فاکتور، بابت، نام مشتری یا مبلغ" value="${esc(state.q)}"></div>
        <span id="inv-range"></span>
        <label class="sr-only" for="inv-ch">کانال فروش</label>
        <select class="input select" id="inv-ch"><option value="">همهٔ کانال‌ها</option>${CHANNELS.map(([v, t]) => `<option value="${v}" ${state.channel === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label class="sr-only" for="inv-sort">ترتیب</label>
        <select class="input select" id="inv-sort">${SORTS.map(([v, t]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <div class="inv-amt"><label class="sr-only" for="inv-min">حداقل مبلغ (تومان)</label><input class="input ltr num" id="inv-min" inputmode="numeric" autocomplete="off" placeholder="از مبلغ (تومان)" value="${state.min ? faNum(state.min) : ''}">
          <span class="muted">تا</span><label class="sr-only" for="inv-max">حداکثر مبلغ (تومان)</label><input class="input ltr num" id="inv-max" inputmode="numeric" autocomplete="off" placeholder="تا مبلغ" value="${state.max ? faNum(state.max) : ''}"></div>
        <button class="btn btn-ghost btn-sm hidden" type="button" id="inv-clear">${ICON.x} پاک کردن فیلترها</button>
      </div>
    </section>
    <div class="inv-totals" id="inv-totals" aria-live="polite"></div>
    <section class="card inv-list" id="inv-list" aria-live="polite"><span class="spinner"></span> در حال بارگذاری…</section>`;

  const listEl = $('#inv-list', root), totalsEl = $('#inv-totals', root), countEl = $('#inv-count', root);
  const clearBtn = $('#inv-clear', root);
  let seq = 0;
  let last = null;

  const isFiltered = () => ['status', 'channel', 'q', 'min', 'max'].some((k) => state[k]) || state.range !== 'all';
  const commit = (mode = 'push') => {
    const url = listUrl(state);
    if (url !== location.hash) history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    clearBtn.classList.toggle('hidden', !isFiltered());
    load();
  };

  async function load() {
    const my = ++seq;
    listEl.setAttribute('aria-busy', 'true');
    try {
      const r = await api(`/api/v2/invoices?${apiQuery(state, { page: state.page, per_page: 20 })}`);
      if (my !== seq) return;
      last = r;
      if (!r.data.length && r.total && state.page > 1) { state.page = 1; return commit('replace'); }
      paint(r);
    } catch (e) {
      if (my !== seq) return;
      listEl.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.body?.message || e.message)}</div><div style="margin-top:12px"><button class="btn" type="button" id="inv-retry">تلاش دوباره</button></div>`;
      $('#inv-retry', listEl).addEventListener('click', load);
    } finally {
      if (my === seq) listEl.removeAttribute('aria-busy');
    }
  }

  function paint(r) {
    const t = r.totals;
    countEl.textContent = isFiltered() ? `${faNum(t.count)} فاکتور با این فیلترها` : `${faNum(t.count)} فاکتور`;
    totalsEl.innerHTML = t.count
      ? `<span class="chip"><span class="muted">فاکتورها</span><b class="num">${faNum(t.count)}</b></span>
         <span class="chip"><span class="muted">پرداخت‌شده</span><b class="num">${faNum(t.paid_count)}</b><span class="muted num">(${toFa(Math.round((t.paid_count / t.count) * 100))}٪)</span></span>
         <span class="chip"><span class="muted">جمع دریافتی</span><b class="num">${toman(t.paid_sum_rial)}</b></span>`
      : '';
    if (!r.data.length) {
      listEl.innerHTML = isFiltered()
        ? emptyState('search', 'فاکتوری با این فیلترها پیدا نشد', 'فیلترها را تغییر دهید یا پاک کنید.', '<button class="btn" type="button" data-clear>پاک کردن فیلترها</button>')
        : emptyState('receipt', 'هنوز فاکتوری نساخته‌اید', 'برای هر فروش یک فاکتور بسازید و لینکش را برای مشتری بفرستید؛ پرداخت با پیامک بانک خودکار تأیید می‌شود.', can('invoices:create') ? '<button class="btn btn-primary" type="button" data-new>ساخت اولین فاکتور</button>' : '');
      $('[data-clear]', listEl)?.addEventListener('click', clearAll);
      $('[data-new]', listEl)?.addEventListener('click', newInvoice);
      return;
    }
    const qs = hashQuery({ ...state, page: DEFAULTS.page });
    const cols = [
      { key: 'id', title: 'فاکتور', render: (x) => `<a class="inv-id ltr" href="#/invoices/${encodeURIComponent(x.id)}${qs ? '?' + qs : ''}" data-open="${esc(x.id)}">${esc(x.id)}</a>${x.note || x.customer_name ? `<div class="muted inv-note" title="${esc(x.note || x.customer_name)}">${esc(x.note || x.customer_name)}</div>` : ''}` },
      { key: 'amount', title: 'مبلغ', render: (x) => `<b class="num">${faNum(x.amount_toman)}</b> <span class="muted inv-sub">تومان</span>` },
      { key: 'status', title: 'وضعیت', render: (x) => statusPill(x.status) },
      { key: 'channel', title: 'کانال', render: (x) => esc(CHANNEL_NAME[x.channel] || 'سایر') },
      { key: 'created', title: 'ساخته‌شده', render: (x) => `<span class="num">${jDateTime(x.created_at)}</span>` },
      { key: 'pay', title: 'پرداخت', render: (x) => x.status === 'PAID'
          ? `<span class="num">${x.paid_at ? jTime(x.paid_at) : ''}</span> ${x.bank_name ? `<span class="muted inv-sub">${esc(x.bank_name)}</span>` : ''} ${x.payer_last4 ? `<span class="muted inv-sub">${card4(x.payer_last4)}</span>` : ''}`
          : x.status === 'PENDING' ? `<span class="muted inv-sub">مهلت تا ${jTime(x.expires_at)}</span>` : '<span class="muted">—</span>' },
    ];
    listEl.innerHTML = table(cols, r.data, { rowAttr: (x) => `data-id="${esc(x.id)}"` });
    listEl.appendChild(pager(r, (p) => { state.page = p; commit(); window.scrollTo({ top: root.offsetTop, behavior: 'smooth' }); }));
  }

  // ---------- filter controls
  $$('[data-status]', root).forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status; state.page = 1;
    $$('[data-status]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    commit();
  }));
  const rc = rangeControl(state.range === 'all' || state.range === 'custom' ? '7d' : state.range, (r) => {
    state.range = r.id; state.page = 1;
    if (r.id === 'custom') { state.from = r.from.toISOString(); state.to = r.to.toISOString(); } else { state.from = ''; state.to = ''; }
    commit();
  });
  const sel = $('select', rc);
  sel.insertAdjacentHTML('afterbegin', '<option value="all">همهٔ زمان‌ها</option>');
  sel.value = state.range;
  if (state.range === 'custom') {
    $('.rng-custom', rc).classList.remove('hidden');
    $('#rng-f', rc).value = fmtJ(new Date(state.from));
    $('#rng-t', rc).value = fmtJ(new Date(new Date(state.to).getTime() - 1));
  }
  $('#inv-range', root).replaceWith(rc);
  $('#inv-ch', root).addEventListener('change', (e) => { state.channel = e.target.value; state.page = 1; commit(); });
  $('#inv-sort', root).addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; commit(); });
  const q = $('#inv-q', root);
  const onSearch = debounce(() => { const v = q.value.trim(); if (v === state.q) return; state.q = v; state.page = 1; commit('replace'); }, 350);
  q.addEventListener('input', onSearch);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(); } });
  for (const k of ['min', 'max']) {
    const el = $(`#inv-${k}`, root);
    const apply = debounce(() => { const v = digits(el.value); if (v === state[k]) return; state[k] = v; state.page = 1; commit('replace'); }, 600);
    el.addEventListener('input', () => { const d = digits(el.value); el.value = d ? faNum(Number(d)) : ''; apply(); });
  }
  function clearAll() {
    Object.assign(state, DEFAULTS);
    q.value = ''; $('#inv-min', root).value = ''; $('#inv-max', root).value = '';
    $('#inv-ch', root).value = ''; $('#inv-sort', root).value = 'newest'; sel.value = 'all'; $('.rng-custom', rc).classList.add('hidden');
    $$('[data-status]', root).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.status === '')));
    commit();
  }
  clearBtn.addEventListener('click', clearAll);
  clearBtn.classList.toggle('hidden', !isFiltered());

  // ---------- actions
  function newInvoice() { quickInvoice(); }
  $('#inv-new', root)?.addEventListener('click', newInvoice);
  $('#inv-csv', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setBusy(b, true, 'در حال آماده‌سازی…');
    try {
      await download(`/api/v2/invoices/export.csv?${apiQuery(state)}`, `bolgram-invoices-${toLatin(fmtJ(new Date())).replace(/\//g, '-')}.csv`);
      toast(last?.totals?.count > 10000 ? 'فقط ۱۰٬۰۰۰ فاکتور اول در فایل آمده؛ بازهٔ زمانی را کوچک‌تر کنید' : 'فایل اکسل دانلود شد', last?.totals?.count > 10000 ? '' : 'ok');
    } catch (er) { toast(er.body?.message || 'دریافت فایل ممکن نشد', 'err'); }
    finally { setBusy(b, false); }
  });
  const onData = () => { if (!root.isConnected) return window.removeEventListener('data-changed', onData); load(); };
  window.addEventListener('data-changed', onData);

  // ---------- rows → detail sheet
  listEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open]');
    const tr = e.target.closest('tr[data-id]');
    if (!a && !tr) return;
    if (a && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
    e.preventDefault();
    openSheet((a || tr).dataset.open || tr.dataset.id, { push: true, trigger: a || tr.querySelector('[data-open]') });
  });

  function openSheet(id, { push, trigger }) {
    if (push) {
      saved = { key: hashQuery(state), root, scrollY: window.scrollY, who, reload: load };
      const qs = hashQuery({ ...state });
      history.pushState({ invSheet: id }, '', `#/invoices/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`);
    }
    showSheet(id, {
      trigger,
      onClose: (silent) => {
        if (silent) return;
        if (history.state?.invSheet === id) history.back();
        else { saved = null; history.replaceState(null, '', listUrl(state)); }
      },
      onChanged: load,
    });
  }

  await load();
  if (sub[0]) openSheet(decodeURIComponent(sub[0]), { push: false });
}

// ---------- detail sheet
function showSheet(id, { trigger, onClose, onChanged }) {
  const prev = trigger || document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const el = document.createElement('aside');
  el.className = 'sheet inv-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sh-title');
  el.innerHTML = `<div class="sh-head"><div><div class="muted">فاکتور</div><h2 id="sh-title" class="ltr">${esc(id)}</h2></div><button class="icon-btn" type="button" data-x aria-label="بستن">${ICON.x}</button></div><div aria-live="polite"><span class="spinner"></span> در حال بارگذاری…</div>`;
  document.body.append(back, el);
  document.body.classList.add('inv-sheet-open');
  let closed = false;
  const close = ({ silent = false } = {}) => {
    if (closed) return;
    closed = true;
    back.remove(); el.remove();
    document.body.classList.remove('inv-sheet-open');
    document.removeEventListener('keydown', onKey);
    if (sheet?.el === el) sheet = null;
    if (!silent) { prev?.isConnected && prev.focus?.(); onClose?.(false); }
  };
  const onKey = (e) => {
    if (document.querySelector('.overlay')) return; // a confirm dialog on top handles its own keys
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = $$('button,a[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])', el).filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', () => close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) close(); });
  $('[data-x]', el).focus();
  sheet = { id, el, close };

  const fill = async () => {
    let d;
    try { d = await api(`/api/v2/invoices/${encodeURIComponent(id)}`); }
    catch (e) {
      if (closed) return;
      if (e.status === 404) { toast('این فاکتور پیدا نشد', 'err'); return close(); }
      el.lastElementChild.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.body?.message || e.message)}</div>`;
      return;
    }
    if (closed) return;
    const v = d.invoice, p = d.payment;
    const link = payBase() + v.pay_path;
    const diff = p ? p.difference_rial : 0;
    const kv = [
      ['بابت', v.note ? esc(v.note) : '<span class="muted">—</span>'],
      v.customer_name ? ['مشتری', esc(v.customer_name)] : null,
      ['کانال فروش', esc(CHANNEL_NAME[v.channel] || 'سایر')],
      ['زمان ساخت', `<span class="num">${jDateTime(v.created_at)}</span>`],
      v.status === 'PENDING' ? ['مهلت پرداخت', `<span class="num">${jTime(v.expires_at)}</span> <span class="muted">(${remaining(v.expires_at)})</span>`] : null,
      p ? ['زمان واریز', `<span class="num">${p.at ? jDateTime(p.at) : '—'}</span>`] : null,
      p ? ['بانک مقصد', esc(p.bank_name || '—')] : null,
      p ? ['کارت پرداخت‌کننده', card4(p.payer_last4)] : null,
      p?.trx_id ? ['کد پیگیری', `<span class="ltr num">${esc(p.trx_id)}</span>`] : null,
      p?.source ? ['روش تأیید', esc(PAY_SOURCE[p.source] || p.source) + (p.approved_by ? ` · ${esc(p.approved_by)}` : '')] : null,
      p?.device_name ? ['گوشی دریافت‌کننده', esc(p.device_name)] : null,
    ].filter(Boolean);
    el.lastElementChild.outerHTML = `<div class="inv-sheet-body" style="display:grid;gap:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${statusPill(v.status)}${v.status === 'PAID' && v.paid_at ? `<span class="muted" style="font-size:.85rem">${ago(v.paid_at)}</span>` : ''}</div>
      <div class="sh-amount num">${faNum(v.amount_toman)} <small>تومان</small></div>
      ${p && diff ? `<div class="alert alert-warn">مبلغ واریزشده <b class="num">${toman(p.amount_rial)}</b> است؛ ${faNum(Math.abs(diff) / 10)} تومان ${diff < 0 ? 'کمتر' : 'بیشتر'} از مبلغ فاکتور.</div>` : ''}
      ${v.status === 'PENDING' ? `<div class="alert alert-ok" style="background:var(--brand-soft);color:var(--fg)">مشتری باید <b>دقیقاً همین مبلغ</b> را به کارت شما واریز کند تا پرداخت خودکار تأیید شود.</div>` : ''}
      <dl class="kv">${kv.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
      ${v.status === 'PENDING' ? `<div><label class="sr-only" for="sh-link">لینک پرداخت</label><div class="muted" style="font-size:.85rem;margin-bottom:6px">لینک پرداخت</div>
        <div class="sh-link"><input class="input ltr" id="sh-link" readonly value="${esc(link)}"><button class="btn" type="button" data-copy>کپی</button></div></div>` : ''}
      <div class="sh-actions">
        ${v.status === 'PENDING' ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">باز کردن صفحهٔ پرداخت</a>` : ''}
        ${d.can_cancel && can('invoices:manage') ? '<button class="btn btn-danger" type="button" data-cancel>لغو فاکتور</button>' : ''}
      </div>
      <section aria-labelledby="sh-tl"><h3 id="sh-tl" style="margin-bottom:12px">تاریخچه</h3>
        <ol class="timeline">${d.timeline.map((t) => `<li class="tl-${esc(t.type)}"><b>${esc(t.title)}</b><div class="muted num">${t.at ? (t.upcoming ? 'تا ' : '') + jDateTime(t.at) : ''}</div>${t.detail ? `<div style="font-size:.88rem">${esc(t.detail)}</div>` : ''}</li>`).join('')}</ol></section>
      ${d.raw_sms ? `<details><summary>متن پیامک بانک</summary><pre class="sms-raw">${esc(d.raw_sms)}</pre></details>` : ''}
    </div>`;
    $('[data-copy]', el)?.addEventListener('click', (e) => copy(link, e.currentTarget));
    $('[data-cancel]', el)?.addEventListener('click', async (e) => {
      const ok = await confirmDialog('لغو فاکتور', `فاکتور <b class="num">${faNum(v.amount_toman)} تومان</b> لغو شود؟ بعد از لغو، لینک پرداخت از کار می‌افتد و واریز با این مبلغ خودکار تأیید نمی‌شود.`, 'لغو فاکتور', true);
      if (!ok || closed) return;
      const b = e.target.closest('button');
      setBusy(b, true, 'در حال لغو…');
      try {
        await api(`/api/v2/invoices/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
        toast('فاکتور لغو شد', 'ok');
        onChanged?.();
        await fill();
      } catch (er) {
        setBusy(b, false);
        toast(er.body?.message || er.message, 'err');
        if (er.status === 409) { onChanged?.(); await fill(); }
      }
    });
  };
  fill();
}

function remaining(iso) {
  const m = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 60000));
  if (m < 1) return 'کمتر از یک دقیقه مانده';
  if (m < 60) return `${toFa(m)} دقیقه مانده`;
  const h = Math.floor(m / 60);
  return `${toFa(h)} ساعت و ${toFa(m % 60)} دقیقه مانده`;
}
