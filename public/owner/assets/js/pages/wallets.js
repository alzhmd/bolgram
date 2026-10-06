import { faNum, toman, jDate, jDateTime, esc, emptyState, toast, modal, setBusy, useStyle, debounce, table, pager, $, $$ } from '/panel/assets/js/core.js';
import { rangeControl, preset } from '/panel/assets/js/jdate.js';
import { oapi, qs, errText, showError, head, pill, field, showErrors, storeCell } from '../ui.js';

useStyle('o-wallets', `
.ow-seg{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.ow-sum{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.neg{color:var(--red)}
`);

const TOPUP = { pending: ['در انتظار پرداخت', 'warn'], paid: ['پرداخت‌شده', 'ok'], expired: ['منقضی', 'bad'] };
const TABS = [['wallets', 'کیف پول‌ها'], ['topups', 'شارژها'], ['summary', 'خلاصهٔ مالی']];
const st = { tab: 'wallets', q: '', topupStatus: '', page: 1, tpage: 1 };

export async function render(page, { query }) {
  if (query.get('q') !== null) { st.q = query.get('q') || ''; st.page = 1; st.tab = 'wallets'; }
  page.innerHTML = `${head('کیف پول‌ها و شارژها')}
    <div class="tabs" role="tablist" aria-label="بخش‌ها">${TABS.map(([id, t]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${st.tab === id}">${t}</button>`).join('')}</div>
    <div id="ow-body" style="display:grid;gap:14px" role="tabpanel"></div>`;
  const body = $('#ow-body', page);
  const show = () => {
    $$('[data-tab]', page).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
    ({ wallets, topups, summary })[st.tab](body);
  };
  $$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; show(); }));
  show();
}

function wallets(body) {
  body.innerHTML = `<div class="toolbar" role="search"><label class="sr-only" for="ow-q">جستجو</label><input class="input grow" id="ow-q" type="search" placeholder="جستجو: آیدی، نام، موبایل یا شناسهٔ فروشگاه" value="${esc(st.q)}" autocomplete="off"></div><div id="ow-list" aria-live="polite"></div>`;
  const list = $('#ow-list', body);
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/wallets${qs({ q: st.q, page: st.page, per_page: 20 })}`); } catch (e) { return showError(list, e, load); }
    list.innerHTML = r.data.length ? table([
      { title: 'فروشگاه', render: (w) => `<a class="o-link" href="#/stores/${encodeURIComponent(w.merchant_id)}">${storeCell(w)}</a>` },
      { title: 'موجودی', cls: 'num nowrap', render: (w) => `<b class="${w.balance_rial < 0 ? 'neg' : ''}">${toman(w.balance_rial)}</b>` },
      { title: 'اعتبار منفی', cls: 'num nowrap', render: (w) => toman(w.credit_rial) },
      { title: 'پلن', render: (w) => `${esc(w.plan_name || w.plan_id || '')}${w.plan_expires_at ? `<br><span class="muted" style="font-size:.78rem">تا ${jDate(w.plan_expires_at)}</span>` : ''}` },
      { title: 'وضعیت', render: (w) => (w.blocked ? '<span class="pill bad">مسدود (کیف پول تمام شده)</span>' : w.status === 'SUSPENDED' ? '<span class="pill bad">معلق</span>' : '<span class="pill ok">عادی</span>') },
      { title: 'عملیات', render: (w) => `<button class="btn btn-sm" type="button" data-adj="${esc(w.merchant_id)}">اصلاح موجودی</button>` },
    ], r.data) : `<div class="card">${emptyState('wallet', 'کیف پولی پیدا نشد', st.q ? 'عبارت جستجو را تغییر دهید.' : 'هنوز فروشگاهی ثبت‌نام نکرده است.')}</div>`;
    list.appendChild(pager(r, (p) => { st.page = p; load(); }));
    const byId = Object.fromEntries(r.data.map((w) => [w.merchant_id, w]));
    $$('[data-adj]', list).forEach((b) => b.addEventListener('click', () => adjust(byId[b.dataset.adj], load)));
  };
  $('#ow-q', body).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350));
  load();
}

function adjust(w, done) {
  let sign = 1;
  const m = modal({
    title: `اصلاح موجودی «${esc(w.name || w.handle)}»`,
    body: `<p class="muted" style="margin-top:0">موجودی فعلی: <b class="num">${toman(w.balance_rial)}</b>. این تغییر در دفتر کیف پول و گزارش فعالیت ثبت می‌شود و فروشنده آن را می‌بیند.</p>
      <form id="adj" novalidate>
        <div class="field"><span style="font-weight:600;font-size:.92rem" id="adj-l">نوع اصلاح</span><div class="seg" role="group" aria-labelledby="adj-l"><button type="button" data-s="1" aria-pressed="true">افزایش موجودی</button><button type="button" data-s="-1" aria-pressed="false">کاهش موجودی</button></div></div>
        ${field('amount', 'مبلغ (تومان)', '<input class="input num ltr" id="f-amount" name="amount" inputmode="numeric" autocomplete="off" placeholder="۵۰٬۰۰۰">')}
        ${field('note', 'دلیل (برای گزارش)', '<input class="input" id="f-note" name="note" maxlength="200" autocomplete="off">', 'حداقل ۳ نویسه')}
      </form>`,
    actions: '<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-primary" type="button" id="adj-ok">ثبت اصلاح</button>',
  });
  $$('[data-s]', m.el).forEach((b) => b.addEventListener('click', () => { sign = Number(b.dataset.s); $$('[data-s]', m.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#adj-ok', m.el).addEventListener('click', async (e) => {
    const raw = $('#f-amount', m.el).value.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[,٬\s]/g, '');
    const note = $('#f-note', m.el).value.trim();
    const amount = Number(raw);
    const errors = {};
    if (!/^\d+$/.test(raw) || amount < 1) errors.amount = 'مبلغ را به‌صورت عدد صحیح و مثبت وارد کنید';
    if (note.length < 3) errors.note = 'دلیل را بنویسید (حداقل ۳ نویسه)';
    if (Object.keys(errors).length) return showErrors(m.el, errors);
    setBusy(e.target.closest('button'), true);
    try {
      const r = await oapi(`/api/owner/wallets/${encodeURIComponent(w.merchant_id)}/adjust`, { method: 'POST', body: { amount_toman: sign * amount, note } });
      m.close(); toast(`موجودی جدید: ${faNum(r.balance_toman)} تومان`, 'ok'); done();
    } catch (err) {
      setBusy(e.target.closest('button'), false);
      const orphan = showErrors(m.el, { ...(err.body?.errors || {}), ...(err.body?.errors?.amount_toman ? { amount: err.body.errors.amount_toman } : {}) });
      if (orphan.length || !err.body?.errors) toast(errText(err), 'err');
    }
  });
}

function topups(body) {
  body.innerHTML = `<div class="ow-seg" role="group" aria-label="وضعیت شارژ"><div class="seg">${[['', 'همه'], ['pending', 'در انتظار'], ['paid', 'پرداخت‌شده'], ['expired', 'منقضی']].map(([v, t]) => `<button type="button" data-ts="${v}" aria-pressed="${st.topupStatus === v}">${t}</button>`).join('')}</div></div><div id="ow-list" aria-live="polite"></div>`;
  const list = $('#ow-list', body);
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/topups${qs({ status: st.topupStatus, page: st.tpage, per_page: 20 })}`); } catch (e) { return showError(list, e, load); }
    list.innerHTML = r.data.length ? table([
      { title: 'فروشگاه', render: (t) => `<a class="o-link" href="#/stores/${encodeURIComponent(t.merchant_id)}">${storeCell(t)}</a>` },
      { title: 'مبلغ', cls: 'num nowrap', render: (t) => toman(t.amount_rial) },
      { title: 'هدیه', cls: 'num nowrap', render: (t) => (t.bonus_rial ? toman(t.bonus_rial) : '—') },
      { title: 'پاداش دعوت', cls: 'num nowrap', render: (t) => (t.referral_rial ? toman(t.referral_rial) : '—') },
      { title: 'وضعیت', render: (t) => pill(TOPUP, t.status) },
      { title: 'ساخت', cls: 'nowrap', render: (t) => jDateTime(t.created_at) },
      { title: 'پرداخت', cls: 'nowrap', render: (t) => (t.paid_at ? jDateTime(t.paid_at) : '—') },
    ], r.data) : `<div class="card">${emptyState('wallet', 'شارژی ثبت نشده', 'وقتی فروشنده‌ای کیف پولش را شارژ کند، اینجا دیده می‌شود.')}</div>`;
    list.appendChild(pager(r, (p) => { st.tpage = p; load(); }));
  };
  $$('[data-ts]', body).forEach((b) => b.addEventListener('click', () => { st.topupStatus = b.dataset.ts; st.tpage = 1; $$('[data-ts]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  load();
}

function summary(body) {
  let range = { id: '30d', ...preset('30d') };
  body.innerHTML = '<div id="ow-rng"></div><div id="ow-sum" style="display:grid;gap:14px"></div>';
  const box = $('#ow-sum', body);
  const load = async () => {
    box.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/billing/summary${qs({ from: range.from.toISOString(), to: new Date(range.to.getTime() - 1).toISOString() })}`); } catch (e) { return showError(box, e, load); }
    const k = (title, rial, sub = '') => `<div class="card stat"><span>${title}</span><b class="num ${rial < 0 ? 'neg' : ''}">${toman(rial)}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    box.innerHTML = `<div class="ow-sum">
      ${k('درآمد کارمزد', r.fees_rial, `${faNum(r.fees_count)} تراکنش`)}${k('فروش پلن', r.plan_sales_rial, `${faNum(r.plan_sales_count)} اشتراک`)}
      ${k('شارژهای پرداخت‌شده', r.topups_rial, `${faNum(r.topups_count)} شارژ`)}${k('هدیهٔ شارژ', r.bonus_rial)}${k('پاداش دعوت', r.referral_rial)}${k('هدیهٔ عضویت', r.signup_bonus_rial)}
      ${k('اصلاح‌های دستی', r.adjust_rial)}${k('بازگشت وجه', r.refund_rial)}${k('مجموع موجودی کیف پول‌ها', r.wallets_total_rial, 'بدهی فعلی به فروشندگان (در کل زمان)')}</div>
      <p class="muted" style="font-size:.82rem;margin:0">بازه: ${jDate(r.from)} تا ${jDate(r.to)}. مبلغ‌ها به تومان‌اند.</p>`;
  };
  $('#ow-rng', body).appendChild(rangeControl('30d', (r) => { range = r; load(); }));
  load();
}
