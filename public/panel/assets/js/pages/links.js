// Payment links: reusable links (fixed / open / multiple-choice amounts, Toman or foreign currency) with a public pay page at /l/<slug>.
import { api, can, CTX, esc, faNum, toFa, toLatin, fixArabic, toast, modal, confirmDialog, setBusy, copy, emptyState, ICON, useStyle, session, ago, jDate, jDateTime, debounce, download, pager, $, $$ } from '../core.js';
import { fmtJ, parseJ, fromJ, toJ } from '../jdate.js';

const CURRENCIES = [['IRT', 'تومان'], ['USD', 'دلار آمریکا'], ['EUR', 'یورو'], ['AED', 'درهم امارات'], ['USDT', 'تتر'], ['TRY', 'لیر ترکیه']];
const CUR_NAME = Object.fromEntries(CURRENCIES);
const MODES = [['fixed', 'قیمت ثابت'], ['open', 'مبلغ دلخواه'], ['choice', 'چند گزینه']];
const FIELDS = [['name', 'نام'], ['mobile', 'موبایل'], ['email', 'ایمیل'], ['address', 'آدرس'], ['note', 'توضیحات خریدار']];
const FIELD_STATES = [['off', 'نپرس'], ['optional', 'اختیاری'], ['required', 'الزامی']];
const CHANNELS = [['instagram', 'اینستاگرام'], ['telegram', 'تلگرام'], ['website', 'سایت'], ['in_person', 'حضوری'], ['other', 'سایر']];
const STATUS_PILL = { active: 'ok', inactive: '', expired: 'warn', sold_out: 'warn', archived: '', no_rate: 'bad' };
const FILTERS = [['current', 'همه'], ['active', 'فعال'], ['inactive', 'غیرفعال'], ['archived', 'بایگانی']];
const STALE_MS = 24 * 3600_000;
const COPY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/></svg>';

const TEMPLATES = {
  bio: { title: 'پرداخت سفارش', amount_mode: 'open', currency: 'IRT', channel: 'instagram', collect: { name: 'required', mobile: 'required', email: 'off', address: 'off', note: 'optional' } },
  product: { title: '', amount_mode: 'fixed', currency: 'IRT', channel: 'other', collect: { name: 'required', mobile: 'required', email: 'off', address: 'optional', note: 'off' } },
  donate: { title: 'حمایت مالی', amount_mode: 'choice', currency: 'IRT', channel: 'other', choices: [{ amount: 50000, label: 'حمایت کوچک' }, { amount: 100000, label: 'حمایت متوسط' }, { amount: 250000, label: 'حمایت ویژه' }], collect: { name: 'optional', mobile: 'off', email: 'off', address: 'off', note: 'optional' } },
  fx: { title: '', amount_mode: 'fixed', currency: 'USD', channel: 'website', collect: { name: 'required', mobile: 'required', email: 'optional', address: 'off', note: 'off' } },
};

const CSS = `
.lk-lead{margin:0;max-width:760px}
.lk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:16px}
.lk-card{display:flex;flex-direction:column;gap:12px;position:relative}
.lk-card.is-off{opacity:.78}
.lk-top{display:flex;gap:12px;align-items:flex-start}
.lk-ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand);flex:none}
.lk-ico.fx{background:var(--green-soft);color:var(--green);font-weight:800;font-size:.8rem}
.lk-tt{flex:1;min-width:0}
.lk-tt h3{overflow-wrap:anywhere}
.lk-tt h3 button{all:unset;cursor:pointer;border-radius:6px}
.lk-tt h3 button:hover{color:var(--brand)}
.lk-tt h3 button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.lk-url{display:block;direction:ltr;unicode-bidi:isolate;font-size:.78rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;text-decoration:none}
.lk-amt{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.lk-amt b{font-size:1.2rem;font-weight:800}
.lk-amt span{font-size:.82rem;color:var(--muted)}
.lk-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)}
.lk-stats dt{font-size:.74rem;color:var(--muted)}
.lk-stats dd{margin:0;font-weight:700;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lk-tags{display:flex;flex-wrap:wrap;gap:6px}
.lk-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;align-items:center}
.lk-actions .lk-more{margin-inline-start:auto}
.lk-menu{position:absolute;bottom:58px;inset-inline-end:14px;width:220px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--sh);padding:6px;z-index:15}
.lk-menu button{display:flex;width:100%;gap:10px;align-items:center;padding:9px 10px;border-radius:10px;background:none;border:0;color:var(--fg);cursor:pointer;text-align:start;font-size:.9rem}
.lk-menu button:hover,.lk-menu button:focus-visible{background:var(--surface-2)}
.lk-menu button.danger{color:var(--red)}
.lk-menu svg{width:18px;height:18px;color:var(--muted)}
.lk-uses{display:grid;gap:4px;font-size:.8rem;color:var(--muted)}
.lk-tpl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px;margin-top:6px;text-align:start}
.lk-tpl button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2);cursor:pointer;color:var(--fg)}
.lk-tpl button:hover{border-color:var(--brand)}
.lk-tpl button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.lk-tpl b{font-size:.95rem}.lk-tpl span{font-size:.82rem;color:var(--muted);line-height:1.7}
.lk-tpl i{font-style:normal;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand)}
.lk-tpl i svg{width:18px;height:18px}
.lk-fx-d>summary{list-style:none;cursor:pointer;margin:0}
.lk-fx-d>summary::-webkit-details-marker{display:none}
.lk-fx-d[open]>summary{margin-bottom:12px}
.lk-fx-d .lk-chev{margin-inline-start:auto;color:var(--muted);display:grid;transition:transform .2s;transform:rotate(-90deg)}
.lk-fx-d[open] .lk-chev{transform:rotate(90deg)}
.lk-fx-d .lk-chev svg{width:18px;height:18px}
.lk-fx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:12px}
.lk-fx-row{border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--surface-2);display:grid;gap:6px}
.lk-fx-row .t{display:flex;align-items:center;gap:8px;justify-content:space-between}
.lk-fx-row .t b{font-size:.92rem}
.lk-fx-row .meta{font-size:.78rem;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-height:26px}
.lk-money{position:relative}
.lk-money .input.ltr{text-align:right;padding-left:96px;padding-right:14px}
.lk-money .unit{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:.82rem;pointer-events:none;max-width:84px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lk-ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;align-items:start}
.lk-pv{position:sticky;top:0}
.lk-phone{border:1px solid var(--border);border-radius:30px;padding:10px;background:var(--surface-2);box-shadow:var(--sh)}
.lk-phone iframe{display:block;width:100%;height:620px;border:0;border-radius:22px;background:#f4f6fb}
.lk-pv p{font-size:.78rem;text-align:center;margin:8px 0 0}
.lk-sec{border-top:1px solid var(--border);padding-top:16px;margin-top:4px}
.lk-sec>h4{margin:0 0 12px;font-size:.95rem;display:flex;align-items:center;gap:8px}
.lk-ed .seg{display:flex;width:100%}
.lk-ed .seg button{flex:1;padding:8px 6px}
.lk-rows{display:grid;gap:8px;margin-bottom:8px}
.lk-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,170px) 40px;gap:8px;align-items:start}
.lk-row .icon-btn{width:40px;height:46px}
.lk-fields{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.lk-fields li{display:flex;justify-content:space-between;align-items:center;gap:8px 12px;flex-wrap:wrap}
.lk-fields li .seg{width:auto;display:inline-flex}
.lk-fields li .seg button{flex:none;padding:6px 12px;font-size:.85rem}
.lk-slug{display:flex;direction:ltr;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);overflow:hidden}
.lk-slug span{display:flex;align-items:center;padding:0 10px;color:var(--muted);font-size:.8rem;background:var(--surface);border-inline-end:1px solid var(--border);white-space:nowrap;max-width:46%;overflow:hidden;text-overflow:ellipsis}
.lk-slug .input{border:0;border-radius:0;min-width:0}
.lk-slug:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px rgb(64 144 255/.2)}
.lk-exp{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px}
.lk-rate{display:grid;gap:8px;padding:12px;border-radius:12px;border:1px dashed var(--border);margin-bottom:14px}
.lk-rate .r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lk-rate .r .lk-money{flex:1 1 180px}
.lk-ed>.lk-switch{display:none;margin-bottom:12px}
details.lk-more-sec summary{cursor:pointer;font-weight:600;padding:6px 0;list-style:none;display:flex;align-items:center;gap:8px}
details.lk-more-sec summary::-webkit-details-marker{display:none}
details.lk-more-sec summary svg{width:16px;height:16px;transition:transform .2s;transform:rotate(-90deg)}
details.lk-more-sec[open] summary svg{transform:rotate(90deg)}
.lk-sheet-qr{display:grid;place-items:center;padding:14px;border-radius:16px;background:#fff;border:1px solid var(--border);width:min(240px,100%);margin:0 auto}
.lk-sheet-qr svg{width:100%;height:auto;display:block}
.lk-share{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.lk-share a,.lk-share button{justify-content:center}
.lk-urlbox{display:flex;gap:8px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:6px 6px 6px 12px;background:var(--surface-2)}
.lk-urlbox code{flex:1;min-width:0;direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.85rem}
.lk-sheet-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.lk-sheet-head .icon-btn{margin-inline-start:auto}
.lk-sheet section{margin-bottom:18px}
.lk-sheet h4{margin:0 0 10px;font-size:.92rem}
@media (max-width:900px){
  .lk-ed{grid-template-columns:1fr}
  .lk-pv{display:none;position:static}
  .lk-ed>.lk-switch{display:flex}
  .lk-ed.show-pv .lk-form{display:none}
  .lk-ed.show-pv .lk-pv{display:block}
  .lk-phone iframe{height:560px}
}
@media (max-width:760px){
  .grid.lk-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .lk-kpis .kpi{padding:14px}
  .lk-kpis .kpi .k-val{font-size:1.2rem}
  .lk-kpis .kpi .ico{width:32px;height:32px}
}
@media (max-width:520px){
  .lk-row{grid-template-columns:minmax(0,1fr) 40px}
  .lk-row .lk-money{grid-column:1/2;grid-row:2}
  .lk-row .icon-btn{grid-row:1/3;grid-column:2;height:100%}
  .lk-fields li .seg{width:100%}
  .lk-fields li .seg button{flex:1}
}
`;

// ------------------------------------------------------------------ formatting

const fnum = (n, frac = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: frac }).format(Number(n) || 0);
const parseMoney = (v, dec) => {
  let s = toLatin(v).replace(/[\s٬,،']/g, '').replace(/[٫/]/g, '.');
  if (!dec) return s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  s = s.replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return s.replace(/^0+(?=\d)/, '');
};
const fmtMoney = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return '';
  const [a, b] = String(raw).split('.');
  const g = a ? faNum(Number(a)) : '۰';
  return b !== undefined ? `${g}٫${toFa(b)}` : g;
};
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد'];
function words(n) {
  n = Math.floor(Number(n) || 0);
  if (!n) return '';
  const parts = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++, n = Math.floor(n / 1000)) {
    const c = n % 1000;
    if (!c) continue;
    const h = Math.floor(c / 100), t = Math.floor((c % 100) / 10), o = c % 10, w = [];
    if (h) w.push(HUNDS[h]);
    if (t === 1) w.push(TEENS[o]); else { if (t) w.push(TENS[t]); if (o) w.push(ONES[o]); }
    parts.unshift(w.join(' و ') + (SCALES[i] ? ' ' + SCALES[i] : ''));
  }
  return parts.join(' و ');
}

let rates = [];
const rateOf = (cur) => rates.find((r) => r.currency === cur) || null;
const isStale = (r) => !!r?.updated_at && Date.now() - new Date(r.updated_at).getTime() > STALE_MS;
const toToman = (price, cur) => {
  if (price === '' || price === null || price === undefined || !Number.isFinite(Number(price))) return null;
  if (cur === 'IRT') return Math.round(Number(price));
  const r = rateOf(cur);
  return r?.rate_toman ? Math.ceil(Math.round(Number(price) * r.rate_toman * 100) / 100) : null;
};
const tomanTxt = (t) => (t === null || t === undefined ? '—' : `${faNum(t)} تومان`);
const priceTxt = (n, cur) => (cur === 'IRT' ? `${faNum(n)} تومان` : `${fnum(n)} ${CUR_NAME[cur]}`);

function amountSummary(l) {
  const cur = l.currency;
  if (l.amount_mode === 'fixed') {
    if (cur === 'IRT') return `<b>${faNum(l.amount)}</b><span>تومان</span>`;
    return `<b>${fnum(l.amount)} ${esc(CUR_NAME[cur])}</b><span>${l.amount_toman ? `≈ ${faNum(l.amount_toman)} تومان` : 'نرخ ارز ثبت نشده'}</span>`;
  }
  if (l.amount_mode === 'choice') {
    const vals = l.choices.map((c) => c.amount);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return `<b>${toFa(l.choices.length)} گزینه</b><span>${lo === hi ? priceTxt(lo, cur) : `از ${priceTxt(lo, cur)} تا ${priceTxt(hi, cur)}`}</span>`;
  }
  const range = l.min_amount && l.max_amount ? `از ${priceTxt(l.min_amount, cur)} تا ${priceTxt(l.max_amount, cur)}` : l.min_amount ? `حداقل ${priceTxt(l.min_amount, cur)}` : l.max_amount ? `حداکثر ${priceTxt(l.max_amount, cur)}` : 'هر مبلغی که مشتری وارد کند';
  return `<b>مبلغ دلخواه</b><span>${range}</span>`;
}

const authFetchText = async (path) => {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session.get()}` } });
  if (!res.ok) throw new Error('بارگذاری QR ممکن نشد');
  return res.text();
};

// ------------------------------------------------------------------ page

const state = { status: 'current', q: '', page: 1 };

export async function render(page, { query, sub, go } = {}) {
  useStyle('links', CSS);
  const manage = can('links:manage');
  const [list, fx] = await Promise.all([
    api(`/api/v2/links?status=${state.status}&page=${state.page}&per_page=24${state.q ? `&q=${encodeURIComponent(state.q)}` : ''}`),
    api('/api/v2/links/fx-rates'),
  ]);
  rates = fx.data;
  const s = list.summary;
  const fresh = !s.links && !s.archived;
  const reload = () => render(page, { query: new URLSearchParams(), sub: [], go });

  page.innerHTML = `
    <div class="page-head"><h1>لینک‌های پرداخت</h1><div class="actions">
      ${!fresh ? `<a class="btn" href="#fx-card" id="go-fx">${ICON.wallet} نرخ ارز</a>` : ''}
      ${manage ? `<button class="btn btn-primary" type="button" id="new-link">${ICON.plus} لینک جدید</button>` : ''}</div></div>
    <p class="muted lk-lead">یک لینک بسازید و در بیو اینستاگرام، کانال تلگرام یا سایت بگذارید. هر کسی که با آن پرداخت کند فاکتور جدا با مبلغ یکتا می‌گیرد و واریزش با پیامک بانک خودکار تأیید می‌شود.</p>
    ${fresh ? `<section class="card">${emptyState('link', 'هنوز لینک پرداختی نساخته‌اید', 'یک لینک یک بار ساخته می‌شود و بارها پرداخت می‌گیرد. از یکی از الگوهای زیر شروع کنید:')}
        <div class="lk-tpl">${[
          ['bio', 'link', 'لینک بیو اینستاگرام', 'مشتری مبلغ سفارش را خودش وارد می‌کند؛ مناسب پیج‌هایی که سفارش را در دایرکت نهایی می‌کنند.'],
          ['product', 'receipt', 'محصول با قیمت ثابت', 'برای یک محصول، کلاس یا خدمت مشخص؛ با سقف تعداد فروش و تاریخ انقضا.'],
          ['donate', 'gift', 'حمایت مالی و نذری', 'چند مبلغ پیشنهادی بگذارید تا پرداخت‌کننده یکی را انتخاب کند.'],
          ['fx', 'wallet', 'قیمت ارزی', 'قیمت را به دلار، یورو، درهم، تتر یا لیر بگذارید؛ هنگام پرداخت با نرخ شما به تومان تبدیل می‌شود.'],
        ].map(([k, ic, t, d]) => `<button type="button" data-tpl="${k}" ${manage ? '' : 'disabled aria-disabled="true"'}><i>${ICON[ic]}</i><b>${t}</b><span>${d}</span></button>`).join('')}</div>
        ${manage ? '' : '<p class="muted" style="text-align:center;margin:14px 0 0">ساخت لینک با مالک یا مدیر فروشگاه است.</p>'}</section>`
      : `<div class="grid g4 lk-kpis">
          ${kpi('link', 'لینک‌های فعال', faNum(s.active), `از ${faNum(s.links)} لینک`)}
          ${kpi('eye', 'بازدید', faNum(s.views), 'بازدیدکنندهٔ یکتا در روز')}
          ${kpi('check', 'پرداخت موفق', faNum(s.paid), `${faNum(s.invoices)} فاکتور ساخته شده`)}
          ${kpi('chart', 'درآمد از لینک‌ها', `${faNum(s.revenue_toman)}`, 'تومان')}
        </div>
        <div class="toolbar">
          <label class="sr-only" for="lk-q">جست‌وجو</label><input class="input grow" id="lk-q" type="search" placeholder="جست‌وجو در عنوان یا آدرس لینک" value="${esc(state.q)}" maxlength="60">
          <div class="seg" role="group" aria-label="فیلتر وضعیت">${FILTERS.map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${state.status === v}">${t}${v === 'archived' && s.archived ? ` (${toFa(s.archived)})` : ''}</button>`).join('')}</div>
        </div>
        <div id="lk-list" aria-live="polite">${list.data.length ? `<div class="lk-grid">${list.data.map((l) => cardHtml(l, manage)).join('')}</div>` : `<section class="card">${emptyState('search', state.q ? 'لینکی با این عبارت پیدا نشد' : 'در این دسته لینکی نیست', state.q ? 'عبارت دیگری را جست‌وجو کنید.' : 'فیلتر «همه» را انتخاب کنید.')}</section>`}</div>`}
    ${fxCard(manage, rates.some((r) => r.rate_toman) || list.data.some((l) => l.currency !== 'IRT'))}`;

  if (!fresh && list.total > list.per_page) $('#lk-list', page).appendChild(pager(list, (p) => { state.page = p; reload(); }));

  const openEditor = (link, tpl) => editor(link, tpl, reload);
  $('#new-link', page)?.addEventListener('click', () => openEditor(null));
  $$('[data-tpl]', page).forEach((b) => b.addEventListener('click', () => manage && openEditor(null, TEMPLATES[b.dataset.tpl])));
  $('#go-fx', page)?.addEventListener('click', (e) => { e.preventDefault(); $('#fx-card details', page).open = true; $('#fx-card', page).scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#fx-card input', page)?.focus({ preventScroll: true }); });
  $('#lk-q', page)?.addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload(); }, 450));
  $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => { state.status = b.dataset.f; state.page = 1; reload(); }));
  wireFx(page, manage, reload);

  const byId = (id) => list.data.find((l) => l.id === id);
  $('#lk-list', page)?.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const l = byId(card.dataset.id);
    const act = e.target.closest('[data-a]')?.dataset.a;
    if (!act) return;
    if (act === 'menu') return toggleMenu(card, l, manage, reload, openEditor);
    if (act === 'share' || act === 'open') return shareSheet(l);
    if (act === 'copy') return copy(l.url);
    if (act === 'edit') return openEditor(l);
    if (act === 'restore') return patch(l, { archived: false }, 'لینک از بایگانی برگشت', reload);
  });

  // #/links/new or #/links?new=1 opens the editor directly (dashboard shortcuts).
  if (manage && (sub?.[0] === 'new' || query?.get?.('new'))) {
    history.replaceState(null, '', '#/links');
    openEditor(null, TEMPLATES[query?.get?.('tpl')] || null);
  }
}

function kpi(icon, title, val, subTxt) {
  return `<div class="card kpi" style="padding-bottom:18px"><div class="k-top"><span class="ico">${ICON[icon]}</span><span class="k-title">${title}</span></div><div class="k-val num">${val}</div><div class="k-sub">${subTxt}</div></div>`;
}

function cardHtml(l, manage) {
  const fx = l.currency !== 'IRT';
  const tags = [];
  if (l.expires_at && l.status !== 'expired') tags.push(`<span class="pill">${ICON.clock.replace('width="20" height="20"', 'width="13" height="13"')} تا ${esc(jDate(l.expires_at))}</span>`);
  if (fx && l.fx?.stale) tags.push('<span class="pill warn">نرخ ارز قدیمی است</span>');
  if (l.channel && l.channel !== 'other') tags.push(`<span class="pill">${esc(Object.fromEntries(CHANNELS)[l.channel] || '')}</span>`);
  const uses = l.max_uses ? `<div class="lk-uses"><span>${faNum(l.stats.paid)} از ${faNum(l.max_uses)} فروش${l.stats.pending ? ` · ${faNum(l.stats.pending)} در حال پرداخت` : ''}</span><div class="progress" role="progressbar" aria-label="ظرفیت فروش" aria-valuemin="0" aria-valuemax="${l.max_uses}" aria-valuenow="${l.stats.paid}"><i style="width:${Math.min(100, (l.stats.paid / l.max_uses) * 100)}%"></i></div></div>` : '';
  const off = l.status !== 'active';
  return `<article class="card lk-card ${off ? 'is-off' : ''}" data-id="${esc(l.id)}">
    <div class="lk-top"><span class="lk-ico ${fx ? 'fx' : ''}" aria-hidden="true">${fx ? esc(l.currency) : ICON.link}</span>
      <div class="lk-tt"><h3><button type="button" data-a="open">${esc(l.title)}</button></h3><a class="lk-url" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url.replace(/^https?:\/\//, ''))}</a></div>
      <span class="pill ${STATUS_PILL[l.status] ?? ''}">${esc(l.status_label)}</span></div>
    <div class="lk-amt">${amountSummary(l)}</div>
    <dl class="lk-stats"><div><dt>بازدید</dt><dd class="num">${faNum(l.stats.views)}</dd></div><div><dt>پرداخت موفق</dt><dd class="num">${faNum(l.stats.paid)}</dd></div><div><dt>درآمد (تومان)</dt><dd class="num" title="${faNum(l.stats.revenue_toman)} تومان">${faNum(l.stats.revenue_toman)}</dd></div></dl>
    ${uses}${tags.length ? `<div class="lk-tags">${tags.join('')}</div>` : ''}
    <div class="lk-actions">
      ${l.archived ? (manage ? '<button class="btn btn-sm" type="button" data-a="restore">بازگردانی از بایگانی</button>' : '')
        : `<button class="btn btn-sm btn-primary" type="button" data-a="share">اشتراک‌گذاری</button>${manage ? '<button class="btn btn-sm" type="button" data-a="edit">ویرایش</button>' : ''}<button class="icon-btn" type="button" data-a="copy" aria-label="کپی لینک ${esc(l.title)}" title="کپی لینک">${COPY_ICON}</button>`}
      ${manage ? `<button class="icon-btn lk-more" type="button" data-a="menu" aria-haspopup="menu" aria-expanded="false" aria-label="کارهای بیشتر برای ${esc(l.title)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>` : ''}
    </div></article>`;
}

async function patch(l, body, okMsg, done) {
  try { await api(`/api/v2/links/${l.id}`, { method: 'PATCH', body }); toast(okMsg, 'ok'); done(); }
  catch (e) { toast(e.message, 'err'); }
}

let closeMenu = null;
function toggleMenu(card, l, manage, reload, openEditor) {
  const had = card.querySelector('.lk-menu');
  closeMenu?.();
  if (had) return;
  const btn = card.querySelector('[data-a="menu"]');
  const menu = document.createElement('div');
  menu.className = 'lk-menu';
  menu.setAttribute('role', 'menu');
  const items = [];
  if (!l.archived) {
    items.push(['dup', 'تکثیر لینک', ICON.plus]);
    items.push(['toggle', l.active ? 'غیرفعال کردن' : 'فعال کردن', l.active ? ICON.lock : ICON.check]);
    items.push(['view', 'باز کردن صفحهٔ پرداخت', ICON.eye]);
  }
  items.push(['del', l.stats.invoices ? 'بایگانی' : 'حذف', ICON.x, 'danger']);
  menu.innerHTML = items.map(([a, t, ic, cls]) => `<button type="button" role="menuitem" data-m="${a}" class="${cls || ''}">${ic}<span>${t}</span></button>`).join('');
  card.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { closeMenu?.(); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = $$('button', menu), i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  };
  closeMenu = () => { menu.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onKey); closeMenu = null; };
  setTimeout(() => document.addEventListener('click', onDoc, true));
  document.addEventListener('keydown', onKey);
  menu.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-m]')?.dataset.m;
    if (!a) return;
    closeMenu?.();
    if (a === 'view') return window.open(l.url, '_blank', 'noopener');
    if (a === 'toggle') return patch(l, { active: !l.active }, l.active ? 'لینک غیرفعال شد' : 'لینک فعال شد', reload);
    if (a === 'dup') {
      try {
        const r = await api(`/api/v2/links/${l.id}/duplicate`, { method: 'POST' });
        toast('یک نسخهٔ غیرفعال از لینک ساخته شد؛ ویرایش و فعالش کنید', 'ok');
        reload();
        openEditor(r.link);
      } catch (er) { toast(er.message, 'err'); }
      return;
    }
    if (a === 'del') {
      const archive = l.stats.invoices > 0;
      const ok = await confirmDialog(archive ? 'بایگانی لینک' : 'حذف لینک',
        archive ? `این لینک ${faNum(l.stats.invoices)} فاکتور دارد؛ برای حفظ سابقهٔ فروش، بایگانی می‌شود و دیگر کسی نمی‌تواند با آن پرداخت کند.` : `لینک «${esc(l.title)}» برای همیشه حذف شود؟ کسانی که این لینک را دارند دیگر نمی‌توانند پرداخت کنند.`,
        archive ? 'بایگانی' : 'حذف لینک', true);
      if (!ok) return;
      try { const r = await api(`/api/v2/links/${l.id}`, { method: 'DELETE' }); toast(r.message, 'ok'); reload(); } catch (er) { toast(er.message, 'err'); }
    }
  });
}

// ------------------------------------------------------------------ FX rates card

function fxCard(manage, open) {
  const anyStale = rates.some(isStale);
  return `<section class="card" id="fx-card" tabindex="-1"><details class="lk-fx-d" ${open ? 'open' : ''}>
    <summary class="card-head">${ICON.wallet}<h3>نرخ ارز لینک‌های ارزی</h3>${anyStale ? '<span class="pill warn">بعضی نرخ‌ها قدیمی‌تر از ۲۴ ساعت است</span>' : ''}<span class="lk-chev" aria-hidden="true">${ICON.chev}</span></summary>
    <p class="muted" style="margin:0 0 14px;font-size:.9rem">قیمت لینک‌های ارزی هنگام پرداخت با همین نرخ‌ها به تومان تبدیل می‌شود و نرخ استفاده‌شده در فاکتور ثبت می‌ماند. نرخ را خودتان تعیین کنید (مثلاً نرخ روز به‌اضافهٔ کارمزد خودتان). ارزی که نرخ ندارد قابل پرداخت نیست.</p>
    <form id="fx-form" novalidate><div class="lk-fx-grid">${rates.map((r) => `<div class="lk-fx-row">
        <div class="t"><label for="fx-${r.currency}"><b>${esc(r.name)}</b> <span class="muted ltr" style="font-size:.8rem">${esc(r.currency)}</span></label>${isStale(r) ? '<span class="pill warn">قدیمی</span>' : r.rate_toman ? '<span class="pill ok">به‌روز</span>' : ''}</div>
        <div class="lk-money"><input class="input ltr num" id="fx-${r.currency}" data-cur="${r.currency}" inputmode="decimal" autocomplete="off" placeholder="مثلاً ۱۱۲٬۰۰۰" value="${r.rate_toman ? fmtMoney(String(r.rate_toman)) : ''}" ${manage ? '' : 'disabled'} aria-describedby="fx-${r.currency}-m"><span class="unit">تومان</span></div>
        <div class="meta" id="fx-${r.currency}-m">${r.updated_at ? `به‌روزرسانی: ${esc(ago(r.updated_at))}` : 'هنوز نرخی ثبت نشده'}${manage && isStale(r) ? `<button class="btn btn-sm btn-ghost" type="button" data-confirm="${r.currency}">همین نرخ هنوز درست است</button>` : ''}</div>
        <div class="err" id="fx-${r.currency}-err" role="alert"></div></div>`).join('')}</div>
      ${manage ? '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" type="submit">ذخیرهٔ نرخ‌ها</button></div>' : ''}</form></details></section>`;
}

function wireFx(page, manage, reload) {
  const form = $('#fx-form', page);
  if (!form || !manage) return;
  $$('input[data-cur]', form).forEach((inp) => inp.addEventListener('input', () => {
    const raw = parseMoney(inp.value, true);
    inp.value = fmtMoney(raw);
    inp.dataset.raw = raw;
    inp.dataset.dirty = '1';
    $(`#fx-${inp.dataset.cur}-err`, form).textContent = '';
    inp.removeAttribute('aria-invalid');
  }));
  const save = async (body, btn) => {
    setBusy(btn, true, 'در حال ذخیره…');
    try {
      const r = await api('/api/v2/links/fx-rates', { method: 'PUT', body: { rates: body } });
      rates = r.data;
      toast('نرخ‌ها ذخیره شد', 'ok');
      reload();
    } catch (e) {
      setBusy(btn, false);
      const errs = e.body?.errors || {};
      for (const [c, m] of Object.entries(errs)) { const el = $(`#fx-${c}-err`, form); if (el) el.textContent = m; $(`#fx-${c}`, form)?.setAttribute('aria-invalid', 'true'); }
      if (!Object.keys(errs).length) toast(e.message, 'err');
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {};
    $$('input[data-cur]', form).forEach((inp) => { if (inp.dataset.dirty) body[inp.dataset.cur] = inp.dataset.raw ?? parseMoney(inp.value, true) ?? null; });
    if (!Object.keys(body).length) return toast('نرخی تغییر نکرده است');
    for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    save(body, form.querySelector('[type="submit"]'));
  });
  $$('[data-confirm]', form).forEach((b) => b.addEventListener('click', () => {
    const r = rateOf(b.dataset.confirm);
    if (r?.rate_toman) save({ [r.currency]: r.rate_toman }, b);
  }));
}

// ------------------------------------------------------------------ share sheet

function shareSheet(l) {
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sh = document.createElement('aside');
  sh.className = 'sheet lk-sheet';
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  sh.setAttribute('aria-labelledby', 'sh-title');
  const text = `${l.title} — پرداخت امن کارت به کارت`;
  const u = encodeURIComponent(l.url), t = encodeURIComponent(text);
  const canShare = typeof navigator.share === 'function';
  sh.innerHTML = `<div class="lk-sheet-head"><h2 id="sh-title" style="overflow-wrap:anywhere">${esc(l.title)}</h2><button class="icon-btn" type="button" data-x aria-label="بستن">${ICON.x}</button></div>
    <section><div class="lk-urlbox"><code>${esc(l.url)}</code><button class="btn btn-sm btn-primary" type="button" data-copy>کپی</button></div>
      ${l.status !== 'active' ? `<div class="alert alert-warn" style="margin-top:10px">این لینک الان «${esc(l.status_label)}» است و مشتری نمی‌تواند با آن پرداخت کند.</div>` : ''}</section>
    <section><h4>کد QR</h4><div class="lk-sheet-qr" id="sh-qr" aria-label="کد QR لینک پرداخت" role="img"><span class="spinner" style="color:#0b1424"></span></div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap"><button class="btn btn-sm" type="button" data-svg>دانلود SVG</button><button class="btn btn-sm" type="button" data-png>دانلود تصویر PNG</button></div>
      <p class="muted" style="font-size:.8rem;text-align:center;margin:8px 0 0">برای چاپ روی میز صندوق، کارت ویزیت یا استوری اینستاگرام.</p></section>
    <section><h4>ارسال در پیام‌رسان</h4><div class="lk-share">
      <a class="btn btn-sm" href="https://t.me/share/url?url=${u}&text=${t}" target="_blank" rel="noopener">تلگرام</a>
      <a class="btn btn-sm" href="https://wa.me/?text=${encodeURIComponent(`${text}\n${l.url}`)}" target="_blank" rel="noopener">واتس‌اپ</a>
      <a class="btn btn-sm" href="https://eitaa.com/share/url?url=${u}&text=${t}" target="_blank" rel="noopener">ایتا</a>
      ${canShare ? '<button class="btn btn-sm" type="button" data-native>سایر برنامه‌ها…</button>' : ''}
      <a class="btn btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">باز کردن صفحه</a></div>
      <p class="muted" style="font-size:.8rem;margin:10px 0 0">برای اینستاگرام: لینک را کپی کنید و در «ویرایش پروفایل ← لینک‌ها» یا استیکر لینک استوری بگذارید.</p></section>
    <section><h4>آمار</h4><dl class="kv"><dt>بازدید</dt><dd class="num">${faNum(l.stats.views)}</dd><dt>فاکتور ساخته‌شده</dt><dd class="num">${faNum(l.stats.invoices)}</dd>
      <dt>پرداخت موفق</dt><dd class="num">${faNum(l.stats.paid)}${l.stats.conversion !== null ? ` <span class="muted">(${fnum(l.stats.conversion, 1)}٪ بازدیدها)</span>` : ''}</dd><dt>درآمد</dt><dd>${tomanTxt(l.stats.revenue_toman)}</dd>
      ${l.max_uses ? `<dt>ظرفیت باقی‌مانده</dt><dd class="num">${faNum(l.remaining_uses)} از ${faNum(l.max_uses)}</dd>` : ''}${l.expires_at ? `<dt>انقضا</dt><dd>${esc(jDateTime(l.expires_at))}</dd>` : ''}</dl></section>
    <section><h4>آخرین پرداخت‌ها</h4><div id="sh-inv" aria-live="polite"><span class="spinner"></span></div></section>`;
  document.body.append(back, sh);
  const close = () => { back.remove(); sh.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = $$('button,a[href],input', sh).filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', close);
  $('[data-x]', sh).addEventListener('click', close);
  $('[data-copy]', sh).addEventListener('click', (e) => copy(l.url, e.currentTarget));
  $('[data-native]', sh)?.addEventListener('click', () => navigator.share({ title: l.title, text, url: l.url }).catch(() => {}));
  $('[data-svg]', sh).addEventListener('click', () => download(`/api/v2/links/${l.id}/qr.svg`, `bolgram-${l.slug}.svg`).catch((e) => toast(e.message, 'err')));
  $('[data-copy]', sh).focus();
  let svgText = '';
  authFetchText(`/api/v2/links/${l.id}/qr.svg`).then((svg) => { svgText = svg; $('#sh-qr', sh).innerHTML = svg; }).catch((e) => { $('#sh-qr', sh).innerHTML = `<span class="muted">${esc(e.message)}</span>`; });
  $('[data-png]', sh).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      setBusy(btn, true, 'در حال ساخت…');
      if (!svgText) svgText = await authFetchText(`/api/v2/links/${l.id}/qr.svg`);
      await qrPng(svgText, l);
    } catch (er) { toast(er.message || 'ساخت تصویر ممکن نشد', 'err'); }
    setBusy(btn, false);
  });
  api(`/api/v2/links/${l.id}`).then((r) => {
    const box = $('#sh-inv', sh);
    if (!box) return;
    const rows = r.recent_invoices || [];
    const PILL = { PAID: ['ok', 'پرداخت شد'], PENDING: ['warn', 'در انتظار'], EXPIRED: ['', 'منقضی'], CANCELLED: ['bad', 'لغو شد'] };
    box.innerHTML = rows.length ? `<ul class="list">${rows.map((i) => `<li>${can('invoices:read') ? `<a href="#/invoices/${encodeURIComponent(i.id)}" style="flex:1;min-width:0;color:inherit;text-decoration:none">` : '<div style="flex:1;min-width:0">'}
        <b style="display:block;font-size:.9rem;overflow-wrap:anywhere">${esc(i.payer || 'بدون نام')}</b><span class="muted" style="font-size:.78rem">${esc(jDateTime(i.created_at))}${i.mobile ? ` · <span class="ltr">${esc(toFa(i.mobile))}</span>` : ''}</span>${can('invoices:read') ? '</a>' : '</div>'}
        <span class="num" style="font-weight:700;font-size:.88rem;white-space:nowrap">${faNum(i.amount_toman)}</span><span class="pill ${PILL[i.status]?.[0] ?? ''}">${PILL[i.status]?.[1] ?? esc(i.status)}</span></li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">هنوز کسی با این لینک پرداخت نکرده است.</p>';
    box.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }).catch(() => { const b = $('#sh-inv', sh); if (b) b.innerHTML = '<p class="muted" style="margin:0">بارگذاری ممکن نشد.</p>'; });
}

/** QR + title + address on a white 1080×1350 card (Instagram portrait size). */
async function qrPng(svg, l) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('ساخت تصویر ممکن نشد')); img.src = url; });
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 140, 120, 800, 800);
  URL.revokeObjectURL(url);
  g.fillStyle = '#0b1424'; g.textAlign = 'center'; g.direction = 'rtl';
  g.font = '800 56px Vazirmatn, Tahoma, sans-serif';
  const title = l.title.length > 34 ? l.title.slice(0, 33) + '…' : l.title;
  g.fillText(title, 540, 1020);
  g.font = '400 34px Vazirmatn, Tahoma, sans-serif'; g.fillStyle = '#52647c';
  g.fillText('برای پرداخت، کد را با دوربین گوشی اسکن کنید', 540, 1090);
  g.direction = 'ltr'; g.font = '600 34px Vazirmatn, Tahoma, sans-serif'; g.fillStyle = '#1f6fe5';
  g.fillText(l.url.replace(/^https?:\/\//, ''), 540, 1170);
  g.font = '400 26px Vazirmatn, Tahoma, sans-serif'; g.fillStyle = '#8aa0bb';
  g.fillText('by Bolgram', 540, 1290);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: `bolgram-${l.slug}.png` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

// ------------------------------------------------------------------ editor

function moneyInput(id, cur, value, label, extra = '') {
  const dec = cur !== 'IRT';
  return `<div class="lk-money"><input class="input ltr num" ${id ? `id="${id}"` : ''} data-money inputmode="${dec ? 'decimal' : 'numeric'}" autocomplete="off" value="${value === null || value === undefined || value === '' ? '' : fmtMoney(String(value))}" data-raw="${value ?? ''}" aria-label="${esc(label)}" ${extra}><span class="unit" data-unit>${esc(CUR_NAME[cur])}</span></div>`;
}

function editor(link, tpl, done) {
  const edit = !!link;
  const src = link || { title: '', description: '', amount_mode: 'fixed', currency: 'IRT', amount: null, min_amount: null, max_amount: null, choices: [], collect: { name: 'optional', mobile: 'optional', email: 'off', address: 'off', note: 'off' }, max_uses: null, expires_at: null, active: true, success_message: '', redirect_url: '', channel: 'other', slug: '', ...(tpl || {}) };
  let mode = src.amount_mode;
  let cur = src.currency;
  const collect = { ...src.collect };
  const base = edit ? new URL(link.url).origin : location.origin;
  const exp = src.expires_at ? toJ(src.expires_at) : null;
  const hasMore = !!(src.max_uses || src.expires_at || src.success_message || src.redirect_url || (src.channel && src.channel !== 'other') || edit);

  const m = modal({
    title: edit ? 'ویرایش لینک پرداخت' : 'لینک پرداخت جدید',
    wide: true,
    body: `<div class="lk-ed" id="ed">
      <div class="seg lk-switch" role="group" aria-label="نمایش"><button type="button" data-view="form" aria-pressed="true">فرم</button><button type="button" data-view="pv" aria-pressed="false">پیش‌نمایش</button></div>
      <form class="lk-form" id="ed-form" novalidate>
        <div class="field"><label for="ed-title">عنوان</label><input class="input" id="ed-title" maxlength="80" value="${esc(src.title)}" placeholder="مثلاً کلاس آنلاین عکاسی، شال نخی، حمایت از پیج" aria-describedby="ed-title-err"><div class="err" id="ed-title-err" role="alert"></div></div>
        <div class="field"><label for="ed-desc">توضیحات <span class="muted" style="font-weight:400">(اختیاری)</span></label><textarea class="input" id="ed-desc" maxlength="1000" placeholder="چه چیزی می‌فروشید، زمان ارسال، شرایط…">${esc(src.description || '')}</textarea><div class="err" id="ed-description-err" role="alert"></div></div>

        <div class="lk-sec"><h4>مبلغ</h4>
          <div class="field"><span class="sr-only" id="ed-mode-l">نوع مبلغ</span><div class="seg" role="group" aria-labelledby="ed-mode-l">${MODES.map(([v, t]) => `<button type="button" data-mode="${v}" aria-pressed="${mode === v}">${t}</button>`).join('')}</div>
            <div class="hint" id="ed-mode-hint"></div><div class="err" id="ed-amount_mode-err" role="alert"></div></div>
          <div class="field"><label for="ed-cur">واحد قیمت</label><select class="input select" id="ed-cur">${CURRENCIES.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}${v !== 'IRT' ? ` (${v})` : ''}</option>`).join('')}</select><div class="err" id="ed-currency-err" role="alert"></div></div>
          <div id="ed-rate"></div>
          <div class="field" data-for="fixed"><label for="ed-amount">قیمت</label>${moneyInput('ed-amount', cur, src.amount_mode === 'fixed' ? src.amount : '', 'قیمت')}<div class="hint" data-hint="ed-amount" aria-live="polite"></div><div class="err" id="ed-amount-err" role="alert"></div></div>
          <div class="grid g2" data-for="open" style="gap:12px">
            <div class="field" style="margin:0"><label for="ed-min">حداقل <span class="muted" style="font-weight:400">(اختیاری)</span></label>${moneyInput('ed-min', cur, src.min_amount, 'حداقل مبلغ')}<div class="hint" data-hint="ed-min"></div><div class="err" id="ed-min_amount-err" role="alert"></div></div>
            <div class="field" style="margin:0"><label for="ed-max">حداکثر <span class="muted" style="font-weight:400">(اختیاری)</span></label>${moneyInput('ed-max', cur, src.max_amount, 'حداکثر مبلغ')}<div class="hint" data-hint="ed-max"></div><div class="err" id="ed-max_amount-err" role="alert"></div></div>
          </div>
          <div class="field" data-for="open choice" style="margin-top:12px"><span class="lbl" id="ed-ch-l" style="font-weight:600;font-size:.92rem"></span>
            <div class="lk-rows" id="ed-rows" role="list" aria-labelledby="ed-ch-l"></div>
            <button class="btn btn-sm" type="button" id="ed-add">${ICON.plus} افزودن گزینه</button><div class="err" id="ed-choices-err" role="alert"></div></div>
        </div>

        <div class="lk-sec"><h4>از پرداخت‌کننده چه بپرسیم؟</h4>
          <ul class="lk-fields">${FIELDS.map(([f, t]) => `<li><span id="ed-f-${f}">${t}</span><div class="seg" role="group" aria-labelledby="ed-f-${f}">${FIELD_STATES.map(([v, l]) => `<button type="button" data-field="${f}" data-st="${v}" aria-pressed="${collect[f] === v}">${l}</button>`).join('')}</div></li>`).join('')}</ul>
          <div class="err" id="ed-collect-err" role="alert"></div>
          <p class="hint muted" style="font-size:.8rem;margin:8px 0 0">موبایل و نام کمک می‌کند هر واریز را راحت‌تر به سفارش وصل کنید.</p></div>

        <div class="lk-sec"><details class="lk-more-sec" ${hasMore ? 'open' : ''}><summary>${ICON.chev} تنظیمات بیشتر</summary><div style="margin-top:12px">
          <div class="field"><label for="ed-slug">آدرس لینک</label><div class="lk-slug"><span title="${esc(base)}/l/">${esc(base.replace(/^https?:\/\//, ''))}/l/</span><input class="input ltr" id="ed-slug" maxlength="40" value="${esc(src.slug || '')}" placeholder="${edit ? '' : 'خودکار ساخته می‌شود'}" autocomplete="off" spellcheck="false" aria-describedby="ed-slug-st ed-slug-err"></div>
            <div class="hint" id="ed-slug-st" aria-live="polite">${edit ? 'اگر آدرس را عوض کنید، لینک و QR قبلی دیگر کار نمی‌کند.' : 'حروف کوچک انگلیسی، عدد و خط تیره؛ خالی بگذارید تا خودکار ساخته شود.'}</div><div class="err" id="ed-slug-err" role="alert"></div></div>
          <div class="field"><label for="ed-exp">تاریخ انقضا <span class="muted" style="font-weight:400">(اختیاری)</span></label>
            <div class="lk-exp"><input class="input ltr num" id="ed-exp" inputmode="numeric" placeholder="${fmtJ(new Date(Date.now() + 7 * 86400_000))}" value="${exp ? fmtJ(src.expires_at) : ''}" aria-describedby="ed-exp-h ed-expires_at-err"><input class="input ltr num" id="ed-exp-t" inputmode="numeric" aria-label="ساعت انقضا" placeholder="۲۳:۵۹" value="${exp ? toFa(`${String(exp.hour).padStart(2, '0')}:${String(exp.minute).padStart(2, '0')}`) : ''}"></div>
            <div class="chips" style="margin-top:8px">${[['0', 'بدون انقضا'], ['1', '۲۴ ساعت'], ['7', '۷ روز'], ['30', '۳۰ روز']].map(([d, t]) => `<button class="chip" type="button" data-days="${d}">${t}</button>`).join('')}</div>
            <div class="hint" id="ed-exp-h" aria-live="polite"></div><div class="err" id="ed-expires_at-err" role="alert"></div></div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label for="ed-uses">سقف تعداد فروش <span class="muted" style="font-weight:400">(اختیاری)</span></label><input class="input ltr num" id="ed-uses" inputmode="numeric" maxlength="9" value="${src.max_uses ? toFa(src.max_uses) : ''}" placeholder="نامحدود" aria-describedby="ed-max_uses-err"><div class="hint">بعد از این تعداد پرداخت موفق، لینک بسته می‌شود.</div><div class="err" id="ed-max_uses-err" role="alert"></div></div>
            <div class="field"><label for="ed-ch">کجا منتشر می‌کنید؟</label><select class="input select" id="ed-ch">${CHANNELS.map(([v, t]) => `<option value="${v}" ${src.channel === v ? 'selected' : ''}>${t}</option>`).join('')}</select><div class="hint">برای گزارش فروش به تفکیک کانال.</div></div>
          </div>
          <div class="field"><label for="ed-succ">پیام بعد از پرداخت <span class="muted" style="font-weight:400">(اختیاری)</span></label><input class="input" id="ed-succ" maxlength="300" value="${esc(src.success_message || '')}" placeholder="مثلاً سفارش شما ظرف ۴۸ ساعت ارسال می‌شود"><div class="err" id="ed-success_message-err" role="alert"></div></div>
          <div class="field"><label for="ed-redir">بازگشت به سایت بعد از پرداخت <span class="muted" style="font-weight:400">(اختیاری)</span></label><input class="input ltr" id="ed-redir" type="url" maxlength="500" value="${esc(src.redirect_url || '')}" placeholder="https://example.com/thanks" aria-describedby="ed-redirect_url-err"><div class="hint">فقط آدرس https؛ شمارهٔ فاکتور و وضعیت به انتهای آدرس اضافه می‌شود.</div><div class="err" id="ed-redirect_url-err" role="alert"></div></div>
          <label class="check"><input type="checkbox" id="ed-active" ${src.active ? 'checked' : ''}> لینک فعال باشد و پرداخت بگیرد</label>
        </div></details></div>
        <div class="alert alert-err hidden" id="ed-err" role="alert"></div>
      </form>
      <div class="lk-pv" aria-label="پیش‌نمایش صفحهٔ پرداخت"><div class="lk-phone"><iframe id="ed-pv" src="/link.html?preview=1" title="پیش‌نمایش صفحهٔ پرداخت" loading="eager"></iframe></div><p class="muted">مشتری دقیقاً همین صفحه را می‌بیند.</p></div>
    </div>`,
    actions: `<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-primary" type="button" id="ed-save">${edit ? 'ذخیرهٔ تغییرات' : 'ساخت لینک'}</button>`,
    onClose: () => window.removeEventListener('message', onMsg),
  });
  const el = m.el;
  el.querySelector('.modal').style.width = 'min(1080px,100%)';
  const f = $('#ed-form', el), rowsBox = $('#ed-rows', el), frame = $('#ed-pv', el);
  const val = (id) => $(id, el).value;
  const raw = (id) => { const i = $(id, el); return i.dataset.raw ?? parseMoney(i.value, cur !== 'IRT'); };

  // ---------- choice rows
  const addRow = (c = {}) => {
    const max = mode === 'choice' ? 12 : 6;
    if (rowsBox.children.length >= max) return toast(`حداکثر ${toFa(max)} گزینه`, 'err');
    const r = document.createElement('div');
    r.className = 'lk-row';
    r.setAttribute('role', 'listitem');
    const n = rowsBox.children.length + 1;
    r.innerHTML = `<input class="input" data-label maxlength="60" placeholder="${mode === 'choice' ? 'برچسب (مثلاً سایز M)' : 'برچسب (اختیاری)'}" value="${esc(c.label || '')}" aria-label="برچسب گزینهٔ ${toFa(n)}">${moneyInput('', cur, c.amount ?? '', `مبلغ گزینهٔ ${toFa(n)}`)}<button class="icon-btn" type="button" data-rm aria-label="حذف گزینهٔ ${toFa(n)}">${ICON.x}</button>`;
    rowsBox.appendChild(r);
    return r;
  };
  (src.choices || []).forEach((c) => addRow(c));
  const rows = () => $$('.lk-row', rowsBox).map((r) => ({ label: fixArabic($('[data-label]', r).value.trim()), amount: $('[data-money]', r).dataset.raw ?? '' })).filter((c) => c.amount !== '' || c.label);
  rowsBox.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('.lk-row').remove(); sync(); } });
  $('#ed-add', el).addEventListener('click', () => { const r = addRow(); r?.querySelector('[data-label]').focus(); sync(); });

  // ---------- money inputs (live «٬» formatting, Persian digits accepted)
  el.addEventListener('input', (e) => {
    const i = e.target.closest('[data-money]');
    if (!i) return;
    const r = parseMoney(i.value, cur !== 'IRT');
    i.value = fmtMoney(r);
    i.dataset.raw = r;
  }, true);

  // ---------- mode & currency
  const setMode = (v) => {
    mode = v;
    $$('[data-mode]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === v)));
    $$('[data-for]', el).forEach((x) => x.classList.toggle('hidden', !x.dataset.for.split(' ').includes(v)));
    $('#ed-ch-l', el).textContent = v === 'choice' ? 'گزینه‌ها (حداقل دو گزینه؛ پرداخت‌کننده یکی را انتخاب می‌کند)' : 'مبلغ‌های پیشنهادی (اختیاری؛ برای انتخاب سریع)';
    $('#ed-mode-hint', el).textContent = { fixed: 'همهٔ پرداخت‌کننده‌ها یک مبلغ مشخص می‌پردازند.', open: 'پرداخت‌کننده مبلغ را خودش وارد می‌کند؛ مناسب بیو اینستاگرام و حمایت مالی.', choice: 'چند محصول یا بسته با قیمت‌های مختلف؛ پرداخت‌کننده یکی را انتخاب می‌کند.' }[v];
    if (v === 'choice' && rowsBox.children.length < 2) { while (rowsBox.children.length < 2) addRow(); }
  };
  $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); sync(); }));
  const drawRate = () => {
    const box = $('#ed-rate', el);
    $$('[data-unit]', el).forEach((u) => (u.textContent = CUR_NAME[cur]));
    $$('[data-money]', el).forEach((i) => i.setAttribute('inputmode', cur === 'IRT' ? 'numeric' : 'decimal'));
    if (cur === 'IRT') { box.innerHTML = ''; return; }
    const r = rateOf(cur);
    const manage = can('links:manage');
    box.innerHTML = `<div class="lk-rate"><div class="r"><label for="ed-rate-v" style="font-weight:600;font-size:.9rem">نرخ هر ${esc(CUR_NAME[cur])}</label>
        <div class="lk-money"><input class="input ltr num" id="ed-rate-v" inputmode="decimal" autocomplete="off" value="${r?.rate_toman ? fmtMoney(String(r.rate_toman)) : ''}" placeholder="مثلاً ۱۱۲٬۰۰۰" ${manage ? '' : 'disabled'}><span class="unit">تومان</span></div>
        ${manage ? '<button class="btn btn-sm" type="button" id="ed-rate-save">ثبت نرخ</button>' : ''}</div>
      <div class="hint" id="ed-rate-h" aria-live="polite">${r?.rate_toman ? `آخرین به‌روزرسانی: ${esc(ago(r.updated_at))}. نرخ لحظهٔ پرداخت در فاکتور ثبت می‌شود.` : ''}</div>
      ${!r?.rate_toman ? `<div class="alert alert-warn">برای ${esc(CUR_NAME[cur])} هنوز نرخی ثبت نکرده‌اید؛ تا نرخ ثبت نشود، این لینک قابل پرداخت نیست.</div>` : isStale(r) ? '<div class="alert alert-warn">این نرخ بیش از ۲۴ ساعت پیش ثبت شده است؛ اگر تغییر کرده، به‌روزش کنید.</div>' : ''}</div>`;
    const inp = $('#ed-rate-v', box);
    inp?.addEventListener('input', () => { const rr = parseMoney(inp.value, true); inp.value = fmtMoney(rr); inp.dataset.raw = rr; });
    $('#ed-rate-save', box)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const v = inp.dataset.raw ?? parseMoney(inp.value, true);
      if (!v) return toast('نرخ را وارد کنید', 'err');
      setBusy(btn, true, 'ذخیره…');
      try { rates = (await api('/api/v2/links/fx-rates', { method: 'PUT', body: { rates: { [cur]: v } } })).data; toast('نرخ ثبت شد', 'ok'); drawRate(); sync(); }
      catch (er) { setBusy(btn, false); toast(er.body?.errors?.[cur] || er.message, 'err'); }
    });
  };
  $('#ed-cur', el).addEventListener('change', (e) => {
    const was = cur;
    cur = e.target.value;
    // Toman ↔ foreign currency differ by orders of magnitude: clear typed prices instead of silently reinterpreting them.
    if ((was === 'IRT') !== (cur === 'IRT')) $$('[data-money]', el).forEach((i) => { i.dataset.raw = ''; i.value = ''; });
    if (was !== cur) drawRate();
    sync();
  });

  // ---------- field toggles
  $$('[data-field]', el).forEach((b) => b.addEventListener('click', () => {
    collect[b.dataset.field] = b.dataset.st;
    $$(`[data-field="${b.dataset.field}"]`, el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sync();
  }));

  // ---------- slug check
  let slugTouched = false;
  const slugSt = $('#ed-slug-st', el);
  const checkSlug = debounce(async () => {
    const s = val('#ed-slug').trim();
    if (!s) { slugSt.textContent = 'خالی بگذارید تا خودکار ساخته شود.'; slugSt.style.color = ''; return; }
    try {
      const r = await api(`/api/v2/links/slug-check?slug=${encodeURIComponent(s)}${edit ? `&except=${encodeURIComponent(link.id)}` : ''}`);
      slugSt.textContent = r.status === 'free' ? 'این آدرس آزاد است ✓' : r.message;
      slugSt.style.color = r.status === 'free' ? 'var(--green)' : 'var(--red)';
    } catch { /* offline: the server checks again on save */ }
  }, 400);
  $('#ed-slug', el).addEventListener('input', (e) => {
    slugTouched = true;
    const i = e.target;
    if (/[؀-ۿ]/.test(i.value)) { slugSt.textContent = 'کیبورد را انگلیسی کنید'; slugSt.style.color = 'var(--red)'; }
    i.value = i.value.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
    checkSlug();
  });

  // ---------- expiry (Jalali)
  const expHint = $('#ed-exp-h', el);
  const expAt = () => {
    const d = val('#ed-exp').trim();
    if (!d) return { at: null };
    const j = parseJ(d);
    if (!j) return { error: 'تاریخ را به شکل ۱۴۰۵/۰۸/۳۰ وارد کنید' };
    const t = toLatin(val('#ed-exp-t')).trim() || '23:59';
    const tm = t.match(/^(\d{1,2})[:.٫](\d{2})$/);
    if (!tm || +tm[1] > 23 || +tm[2] > 59) return { error: 'ساعت را به شکل ۲۳:۵۹ وارد کنید' };
    return { at: fromJ(j.jy, j.jm, j.jd, +tm[1], +tm[2]) };
  };
  const drawExp = () => {
    const r = expAt();
    expHint.style.color = r.error || (r.at && r.at < new Date()) ? 'var(--red)' : '';
    expHint.textContent = r.error || (r.at ? (r.at < new Date() ? 'این زمان گذشته است' : `لینک ${jDate(r.at, { weekday: 'long' })} ساعت ${toFa(val('#ed-exp-t').trim() ? toLatin(val('#ed-exp-t')).trim() : '23:59')} بسته می‌شود.`) : 'بدون انقضا؛ تا وقتی خودتان غیرفعالش نکنید باز است.');
  };
  $('#ed-exp', el).addEventListener('input', drawExp);
  $('#ed-exp-t', el).addEventListener('input', drawExp);
  $$('[data-days]', el).forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.days;
    if (!d) { $('#ed-exp', el).value = ''; $('#ed-exp-t', el).value = ''; }
    else {
      const at = new Date(Date.now() + d * 86400_000);
      const j = toJ(at);
      $('#ed-exp', el).value = fmtJ(at);
      $('#ed-exp-t', el).value = toFa(`${String(j.hour).padStart(2, '0')}:${String(j.minute).padStart(2, '0')}`);
    }
    drawExp(); sync();
  }));

  // ---------- hints under amounts
  const drawHints = () => {
    for (const id of ['ed-amount', 'ed-min', 'ed-max']) {
      const h = $(`[data-hint="${id}"]`, el);
      const r = raw(`#${id}`);
      if (!h) continue;
      if (!r) { h.textContent = ''; continue; }
      if (cur === 'IRT') h.textContent = `${words(r)} تومان`;
      else { const t = toToman(r, cur); h.textContent = t ? `≈ ${faNum(t)} تومان با نرخ فعلی` : 'برای محاسبهٔ معادل تومانی، نرخ را ثبت کنید'; }
    }
  };

  // ---------- body & live preview
  const body = () => {
    const b = {
      title: fixArabic(val('#ed-title').trim()),
      description: fixArabic(val('#ed-desc').trim()),
      amount_mode: mode,
      currency: cur,
      collect,
      channel: val('#ed-ch'),
      success_message: fixArabic(val('#ed-succ').trim()),
      redirect_url: val('#ed-redir').trim(),
      active: $('#ed-active', el).checked,
      max_uses: toLatin(val('#ed-uses')).replace(/\D/g, '') || null,
    };
    if (mode === 'fixed') b.amount = raw('#ed-amount') || null;
    if (mode === 'open') { b.min_amount = raw('#ed-min') || null; b.max_amount = raw('#ed-max') || null; }
    if (mode !== 'fixed') b.choices = rows();
    const s = val('#ed-slug').trim();
    if (s && (slugTouched || !edit)) b.slug = s;
    return b;
  };
  const previewData = () => {
    const b = body();
    const fx = cur !== 'IRT';
    const r = rateOf(cur);
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const ex = expAt();
    return {
      slug: b.slug || '', title: b.title || 'عنوان لینک', description: b.description,
      store: { name: CTX.me?.name || CTX.me?.handle || 'فروشگاه شما', handle: CTX.me?.handle || null, logo: null },
      currency: cur, currency_name: CUR_NAME[cur], amount_mode: mode,
      price: fx ? num(b.amount) : null, amount_toman: mode === 'fixed' ? toToman(b.amount, cur) ?? 0 : null,
      min_price: fx ? num(b.min_amount) : null, max_price: fx ? num(b.max_amount) : null,
      min_toman: mode === 'open' ? toToman(b.min_amount, cur) ?? (fx ? null : 1000) : null,
      max_toman: mode === 'open' ? toToman(b.max_amount, cur) ?? (fx ? null : 1_000_000_000) : null,
      choices: (b.choices || []).filter((c) => c.amount !== '').map((c, index) => ({ index, label: c.label, price: fx ? Number(c.amount) : null, amount_toman: toToman(c.amount, cur) ?? 0 })),
      fx: fx ? { currency: cur, rate_toman: r?.rate_toman ?? null, updated_at: r?.updated_at ?? null } : null,
      fields: { ...collect },
      remaining: b.max_uses ? Number(b.max_uses) - (link?.stats?.paid || 0) : null,
      expires_at: ex.at ? ex.at.toISOString() : null,
      available: true, reason: null, message: null,
    };
  };
  let ready = false;
  const push = () => { if (ready) frame.contentWindow?.postMessage({ type: 'bolgram-link-preview', link: previewData() }, location.origin); };
  const sync = debounce(() => { drawHints(); push(); }, 120);
  function onMsg(e) { if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.type === 'bolgram-link-preview-ready') { ready = true; push(); } }
  window.addEventListener('message', onMsg);
  frame.addEventListener('load', () => { ready = true; push(); });
  f.addEventListener('input', sync);
  f.addEventListener('change', sync);
  $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => {
    $('#ed', el).classList.toggle('show-pv', b.dataset.view === 'pv');
    $$('[data-view]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    push();
  }));

  setMode(mode);
  drawRate();
  drawExp();
  drawHints();

  // ---------- save
  const clearErrs = () => { $$('.err', el).forEach((x) => (x.textContent = '')); $$('[aria-invalid]', el).forEach((x) => x.removeAttribute('aria-invalid')); $('#ed-err', el).classList.add('hidden'); };
  const FOCUS = { title: '#ed-title', description: '#ed-desc', amount: '#ed-amount', min_amount: '#ed-min', max_amount: '#ed-max', slug: '#ed-slug', expires_at: '#ed-exp', max_uses: '#ed-uses', redirect_url: '#ed-redir', success_message: '#ed-succ', currency: '#ed-cur' };
  const showErrs = (errs) => {
    const keys = Object.keys(errs);
    for (const k of keys) {
      const box = $(`#ed-${k}-err`, el);
      if (box) box.textContent = errs[k];
      if (FOCUS[k]) $(FOCUS[k], el)?.setAttribute('aria-invalid', 'true');
    }
    if (keys.some((k) => ['slug', 'expires_at', 'max_uses', 'redirect_url', 'success_message'].includes(k))) $('details.lk-more-sec', el).open = true;
    $('#ed', el).classList.remove('show-pv');
    const first = keys.map((k) => FOCUS[k]).find(Boolean);
    if (first) $(first, el)?.focus(); else $(`#ed-${keys[0]}-err`, el)?.scrollIntoView({ block: 'center' });
    if (!keys.some((k) => $(`#ed-${k}-err`, el))) { $('#ed-err', el).textContent = Object.values(errs)[0]; $('#ed-err', el).classList.remove('hidden'); }
  };
  $('#ed-save', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    clearErrs();
    const b = body();
    const errs = {};
    if (b.title.length < 2) errs.title = 'عنوان لینک را وارد کنید';
    if (mode === 'fixed' && !b.amount) errs.amount = 'قیمت را وارد کنید';
    if (mode === 'choice' && (b.choices || []).filter((c) => c.amount).length < 2) errs.choices = 'حداقل دو گزینه با مبلغ لازم است';
    if ((b.choices || []).some((c) => !c.amount)) errs.choices = 'مبلغ همهٔ گزینه‌ها را وارد کنید یا گزینهٔ خالی را حذف کنید';
    const ex = expAt();
    if (ex.error) errs.expires_at = ex.error;
    else if (ex.at && ex.at <= new Date() && (!link?.expires_at || ex.at.getTime() !== new Date(link.expires_at).getTime())) errs.expires_at = 'تاریخ انقضا باید در آینده باشد';
    if (b.redirect_url && !/^https:\/\/[^\s]+\.[^\s]+/i.test(b.redirect_url)) errs.redirect_url = 'آدرس باید با https:// شروع شود';
    if (Object.keys(errs).length) return showErrs(errs);
    b.expires_at = ex.at ? ex.at.toISOString() : null;
    setBusy(btn, true, 'در حال ذخیره…');
    try {
      const r = await api(edit ? `/api/v2/links/${link.id}` : '/api/v2/links', { method: edit ? 'PATCH' : 'POST', body: b });
      m.close();
      toast(edit ? 'تغییرات ذخیره شد' : 'لینک ساخته شد', 'ok');
      done();
      if (!edit) shareSheet(r.link);
    } catch (er) {
      setBusy(btn, false);
      if (er.body?.errors) showErrs(er.body.errors);
      else { $('#ed-err', el).textContent = er.message; $('#ed-err', el).classList.remove('hidden'); $('#ed-err', el).scrollIntoView({ block: 'center' }); }
    }
  });
  if (!edit) $('#ed-title', el).focus();
}
