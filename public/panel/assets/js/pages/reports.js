// Sales reports: KPI tiles with change vs the previous period, daily / hour-of-day / weekday columns,
// bank and channel breakdowns. Single hue for magnitude, one axis, hover + keyboard tooltips, table view per chart.
import { api, esc, toFa, toLatin, faNum, toman, rialToToman, jDate, $, $$, toast, emptyState, ICON, useStyle, download, can } from '../core.js';
import { rangeControl, fmtJ, preset, MONTHS } from '../jdate.js';

const RANGES = ['today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'year', 'custom'];
const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const DL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

const CSS = `
.rep-page{display:flex;flex-direction:column;gap:16px;min-width:0}
.rep-head .actions{align-items:center}
.rep-export{position:relative}
.rep-export summary{list-style:none}
.rep-export summary::-webkit-details-marker{display:none}
.rep-export .dropdown{width:240px}
.rep-range{font-size:.88rem}
.rep-kpis{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width:1100px){.rep-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px){.rep-kpis{grid-template-columns:1fr 1fr;gap:10px}.rep-kpis .card{padding:14px}.rep-kpis .r-val{font-size:1.15rem}}
.rep-kpis .r-label{font-size:.84rem;color:var(--muted)}
.rep-kpis .r-val{font-size:1.45rem;font-weight:800;margin:4px 0 2px;line-height:1.35;overflow-wrap:anywhere}
.rep-kpis .r-val small{font-size:.8rem;font-weight:600;color:var(--muted)}
.rep-kpis .r-sub{font-size:.78rem;color:var(--muted)}
.rep-delta{display:inline-flex;align-items:center;gap:3px;font-size:.8rem;font-weight:600}
.rep-delta.up{color:var(--green)}.rep-delta.down{color:var(--red)}.rep-delta.flat{color:var(--muted)}
.rep-chart .card-head{flex-wrap:wrap}
.rep-chart .card-head .muted{font-size:.8rem}
.rep-chart .card-head .btn{margin-inline-start:auto}
.rep-plot{position:relative;min-height:60px}
.rep-plot svg{display:block;direction:ltr;overflow:visible}
.rep-plot svg:focus-visible{outline:2px solid var(--brand);outline-offset:4px}
.rep-tip{position:absolute;top:0;z-index:2;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:6px 10px;font-size:.8rem;pointer-events:none;white-space:nowrap;box-shadow:var(--sh);line-height:1.7}
.rep-tip b{font-weight:800}
.rep-none{color:var(--muted);text-align:center;padding:28px 8px;font-size:.9rem}
.hb{display:grid;gap:12px}
.hb-row{display:grid;grid-template-columns:minmax(84px,30%) 1fr auto;gap:10px;align-items:center;border-radius:10px;padding:2px 4px;outline-offset:2px}
.hb-row:hover,.hb-row:focus-visible{background:var(--surface-2)}
.hb-label{font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-label small{display:block;color:var(--muted);font-size:.74rem}
.hb-track{height:10px;position:relative}
.hb-track i{position:absolute;inset-block:0;inset-inline-start:0;background:var(--brand);border-start-end-radius:4px;border-end-end-radius:4px;min-width:2px}
.hb-val{font-size:.84rem;text-align:end;white-space:nowrap}
.hb-val .muted{font-size:.76rem}
.rep-table .table{font-size:.86rem}
@media (max-width:640px){.hb-row{grid-template-columns:minmax(70px,34%) 1fr auto;gap:8px}}
`;

// ---------- number formatting
const dec = (n, d = 1) => toFa((Math.round(n * 10 ** d) / 10 ** d).toString()).replace('.', '٫');
/** Compact Toman: ۲٫۵ میلیون, ۸۰۰ هزار, ۱٫۲ میلیارد. */
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${dec(v / 1e9)} میلیارد`;
  if (a >= 1e6) return `${dec(v / 1e6)} میلیون`;
  if (a >= 1e3) return `${dec(v / 1e3, 0)} هزار`;
  return faNum(v);
}
function niceCeil(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const jParts = (j) => { const [jy, jm, jd] = j.split('/').map(Number); return { jy, jm, jd }; };

function delta(cur, prev, { pp = false, days = 0 } = {}) {
  const ref = days === 1 ? 'نسبت به روز قبل' : `نسبت به ${toFa(days)} روز قبل`;
  if (prev === null || prev === undefined || cur === null || cur === undefined) return `<span class="rep-delta flat">—</span>`;
  let d, text;
  if (pp) { d = cur - prev; text = `${dec(Math.abs(d))} واحد درصد`; if (Math.abs(d) < 0.05) d = 0; }
  else if (!prev) return cur ? `<span class="rep-delta up">${UP} تازه</span> <span class="r-sub">${ref}</span>` : `<span class="rep-delta flat">بدون تغییر</span> <span class="r-sub">${ref}</span>`;
  else { d = ((cur - prev) / prev) * 100; text = `${toFa(Math.round(Math.abs(d)))}٪`; if (Math.abs(d) < 0.5) d = 0; }
  if (!d) return `<span class="rep-delta flat">بدون تغییر</span> <span class="r-sub">${ref}</span>`;
  return `<span class="rep-delta ${d > 0 ? 'up' : 'down'}"><span class="sr-only">${d > 0 ? 'افزایش' : 'کاهش'}</span>${d > 0 ? UP : DOWN} ${text}</span> <span class="r-sub">${ref}</span>`;
}

// ---------- charts
const observers = new Set();
function onResize(el, draw) {
  let raf = 0, lastW = el.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { ro.disconnect(); observers.delete(ro); return; }
    if (Math.abs(el.clientWidth - lastW) < 2) return;
    lastW = el.clientWidth;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  });
  ro.observe(el);
  observers.add(ro);
}

/**
 * Columns from one baseline. items: [{ v (Toman), label (axis, may be ''), tip (html), name (a11y) }].
 * Thin bars (<= 24px), 4px rounded data end, recessive hairline grid, y labels on the left (chart reads LTR in time).
 */
function columnChart(host, items, { title }) {
  const tip = document.createElement('div');
  tip.className = 'rep-tip hidden';
  tip.setAttribute('aria-hidden', 'true');
  let cur = -1;
  const draw = () => {
    const W = Math.max(260, host.clientWidth), H = 220, T = 12, B = 28, R = 6;
    const max = niceCeil(Math.max(...items.map((x) => x.v), 0));
    const yl = [0, max / 2, max].map((v) => (v ? compact(v) : '۰'));
    const L = Math.min(84, Math.max(30, Math.max(...yl.map((s) => s.length)) * 6.4 + 10));
    const n = items.length, slot = (W - L - R) / n, bw = Math.max(2, Math.min(24, slot * 0.64, slot - 2));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const x = (i) => L + slot * i + slot / 2;
    const bar = (i, v) => {
      const h = y(0) - y(v);
      if (h <= 0) return '';
      const r = Math.min(4, bw / 2, h), x0 = x(i) - bw / 2, x1 = x0 + bw, top = y(v), base = y(0);
      return `<path data-i="${i}" d="M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z" fill="var(--brand)"/>`;
    };
    const grid = [0, 0.5, 1].map((f, k) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--border)" stroke-width="1"/><text x="${L - 8}" y="${y(max * f) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${yl[k]}</text>`).join('');
    const ticks = items.map((it, i) => (it.label ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(it.label)}</text>` : '')).join('');
    host.querySelector('svg')?.remove();
    host.insertAdjacentHTML('afterbegin', `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(title)} — برای دیدن مقدار هر ستون با کلیدهای جهت حرکت کنید">
      <rect class="hl hidden" y="${T}" height="${H - T - B}" width="${slot}" rx="6" fill="var(--surface-2)"/>
      ${grid}<g>${items.map((it, i) => bar(i, it.v)).join('')}</g>${ticks}
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`);
    if (!tip.isConnected) host.appendChild(tip);
    const svg = host.querySelector('svg'), hl = svg.querySelector('.hl');
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      hl.setAttribute('x', x(cur) - slot / 2); hl.classList.remove('hidden');
      svg.querySelectorAll('path[data-i]').forEach((p) => p.setAttribute('fill-opacity', Number(p.dataset.i) === cur ? '1' : '.55'));
      tip.innerHTML = items[cur].tip;
      tip.classList.remove('hidden');
      const tw = tip.offsetWidth, px = x(cur);
      tip.style.left = `${Math.min(Math.max(0, px - tw / 2), W - tw)}px`;
      tip.style.top = `${Math.max(0, y(items[cur].v) - tip.offsetHeight - 10)}px`;
    };
    const hide = () => { hl.classList.add('hidden'); tip.classList.add('hidden'); svg.querySelectorAll('path[data-i]').forEach((p) => p.removeAttribute('fill-opacity')); };
    const at = (e) => { const r = svg.getBoundingClientRect(); return Math.floor((e.clientX - r.left - L) / slot); };
    svg.addEventListener('mousemove', (e) => { const i = at(e); if (i >= 0 && i < n) show(i); else hide(); });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', (e) => { const t = e.touches[0]; const i = at(t); if (i >= 0 && i < n) show(i); }, { passive: true });
    svg.addEventListener('focus', () => show(cur < 0 ? items.reduce((b, it, i) => (it.v > items[b].v ? i : b), 0) : cur));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') show(cur + 1); else if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'Home') show(0); else if (e.key === 'End') show(n - 1); else return;
      e.preventDefault();
    });
  };
  draw();
  onResize(host, draw);
}

/** Horizontal bars (HTML, RTL): name, bar scaled to the largest value, value at the tip; hover/focus shows exact numbers. */
function hbars(host, rows) {
  const max = Math.max(...rows.map((r) => r.v), 0) || 1;
  host.innerHTML = `<div class="hb" role="list">${rows.map((r, i) => `<div class="hb-row" role="listitem" tabindex="0" data-i="${i}" aria-label="${esc(r.aria)}">
      <div class="hb-label">${esc(r.name)}${r.sub ? `<small>${r.sub}</small>` : ''}</div>
      <div class="hb-track" aria-hidden="true">${r.v ? `<i style="width:${Math.max(0.5, (r.v / max) * 100)}%"></i>` : ''}</div>
      <div class="hb-val num">${r.value}</div></div>`).join('')}</div><div class="rep-tip hidden" aria-hidden="true"></div>`;
  const tip = host.querySelector('.rep-tip');
  const show = (row) => {
    tip.innerHTML = rows[Number(row.dataset.i)].tip;
    tip.classList.remove('hidden');
    const hr = host.getBoundingClientRect(), rr = row.getBoundingClientRect();
    tip.style.top = `${rr.top - hr.top - tip.offsetHeight - 6}px`;
    tip.style.left = `${Math.max(0, Math.min(hr.width - tip.offsetWidth, rr.left - hr.left + rr.width / 2 - tip.offsetWidth / 2))}px`;
  };
  const hide = () => tip.classList.add('hidden');
  $$('.hb-row', host).forEach((row) => {
    row.addEventListener('mouseenter', () => show(row));
    row.addEventListener('focus', () => show(row));
    row.addEventListener('mouseleave', hide);
    row.addEventListener('blur', hide);
  });
}

function tableHtml(cols, rows, caption) {
  return `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td data-label="${esc(cols[i])}" class="${i ? 'num' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Card with a chart and its table view («جدول» toggle). The table stays available to screen readers either way. */
function chartCard({ id, title, unit, empty }) {
  return `<section class="card rep-chart" aria-labelledby="h-${id}"><div class="card-head"><h3 id="h-${id}">${title}</h3>${unit ? `<span class="muted">${unit}</span>` : ''}
    ${empty ? '' : `<button class="btn btn-sm btn-ghost" type="button" data-table="${id}" aria-pressed="false" aria-controls="t-${id}">جدول</button>`}</div>
    ${empty ? `<div class="rep-none">${empty}</div>` : `<div class="rep-plot" id="c-${id}"></div><div class="rep-table sr-only" id="t-${id}"></div>`}</section>`;
}

// ---------- page
function readRange(query) {
  const id = RANGES.includes(query.get('range')) ? query.get('range') : '30d';
  if (id === 'custom') {
    const from = new Date(query.get('from') || ''), to = new Date(query.get('to') || '');
    if (!isNaN(from) && !isNaN(to) && to > from) return { id, from, to };
    return { id: '30d', ...preset('30d') };
  }
  return { id, ...preset(id) };
}
const rangeHash = (r) => {
  const p = new URLSearchParams();
  if (r.id !== '30d') p.set('range', r.id);
  if (r.id === 'custom') { p.set('from', r.from.toISOString()); p.set('to', r.to.toISOString()); }
  return `#/reports${p.toString() ? '?' + p : ''}`;
};

export async function render(page, { query }) {
  useStyle('reports', CSS);
  for (const ro of observers) ro.disconnect();
  observers.clear();
  let range = readRange(query);
  const root = document.createElement('div');
  root.className = 'rep-page';
  page.replaceChildren(root);
  root.innerHTML = `
    <div class="page-head rep-head"><h1>گزارش‌ها</h1><span class="muted rep-range" id="rep-label"></span>
      <div class="actions"><span id="rep-rc"></span>
        <details class="rep-export"><summary class="btn">${DL} خروجی اکسل</summary><div class="dropdown" role="menu">
          <button class="item" type="button" role="menuitem" data-export="daily">${ICON.chart} جمع روزانهٔ فروش</button>
          <button class="item" type="button" role="menuitem" data-export="payments">${ICON.receipt} ریز همهٔ پرداخت‌ها</button></div></details></div></div>
    <div class="rep-kpis" id="rep-kpis" aria-live="polite"></div>
    <div id="rep-body"><div class="card"><span class="spinner"></span> در حال بارگذاری…</div></div>`;

  const rc = rangeControl(range.id, (r) => {
    range = r;
    const url = rangeHash(range);
    if (url !== location.hash) history.pushState(null, '', url);
    load();
  });
  if (range.id === 'custom') {
    $('.rng-custom', rc).classList.remove('hidden');
    $('#rng-f', rc).value = fmtJ(range.from);
    $('#rng-t', rc).value = fmtJ(new Date(range.to.getTime() - 1));
  }
  $('#rep-rc', root).replaceWith(rc);

  const exp = $('.rep-export', root);
  document.addEventListener('click', function closeMenu(e) {
    if (!exp.isConnected) return document.removeEventListener('click', closeMenu);
    if (!exp.contains(e.target)) exp.open = false;
  });
  $$('[data-export]', root).forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.export;
    exp.open = false;
    const btn = $('summary', exp);
    btn.setAttribute('aria-busy', 'true');
    try {
      const stamp = `${toLatin(fmtJ(range.from))}_${toLatin(fmtJ(new Date(range.to.getTime() - 1)))}`.replace(/\//g, '-');
      await download(`/api/v2/reports/export.csv?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}&kind=${kind}`, `bolgram-${kind === 'payments' ? 'payments' : 'report'}-${stamp}.csv`);
      toast('فایل اکسل دانلود شد', 'ok');
    } catch (e) { toast(e.body?.message || 'دریافت فایل ممکن نشد', 'err'); }
    finally { btn.removeAttribute('aria-busy'); }
  }));

  let seq = 0;
  async function load() {
    const my = ++seq;
    const body = $('#rep-body', root);
    body.style.opacity = '.6';
    let r;
    try { r = await api(`/api/v2/reports?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`); }
    catch (e) {
      if (my !== seq) return;
      body.style.opacity = '';
      body.innerHTML = `<div class="card"><div class="alert alert-err" role="alert">${esc(e.body?.message || e.message)}</div><button class="btn" type="button" style="margin-top:12px" id="rep-retry">تلاش دوباره</button></div>`;
      return $('#rep-retry', body).addEventListener('click', load);
    }
    if (my !== seq) return;
    body.style.opacity = '';
    paint(r);
  }

  function paint(r) {
    for (const ro of observers) ro.disconnect();
    observers.clear();
    const T = r.totals, P = r.previous_totals, days = r.range.days;
    const lastDay = new Date(new Date(r.range.to).getTime() - 1);
    $('#rep-label', root).textContent = days === 1 ? jDate(r.range.from, { weekday: 'long' }) : `${jDate(r.range.from)} تا ${jDate(lastDay)}`;
    const kpi = (label, value, d, sub = '') => `<div class="card"><div class="r-label">${label}</div><div class="r-val num">${value}</div><div>${d}</div>${sub ? `<div class="r-sub">${sub}</div>` : ''}</div>`;
    $('#rep-kpis', root).innerHTML = [
      kpi('فروش (مبلغ دریافتی)', `${faNum(rialToToman(T.paid_rial))} <small>تومان</small>`, delta(T.paid_rial, P.paid_rial, { days })),
      kpi('تعداد پرداخت', faNum(T.paid_count), delta(T.paid_count, P.paid_count, { days })),
      kpi('میانگین هر پرداخت', T.paid_count ? `${faNum(rialToToman(T.avg_ticket_rial))} <small>تومان</small>` : '—', T.paid_count && P.paid_count ? delta(T.avg_ticket_rial, P.avg_ticket_rial, { days }) : '<span class="rep-delta flat">—</span>'),
      kpi('نرخ تبدیل فاکتور', T.conversion_pct === null ? '—' : `${dec(T.conversion_pct)}٪`, T.conversion_pct === null || P.conversion_pct === null ? '<span class="rep-delta flat">—</span>' : delta(T.conversion_pct, P.conversion_pct, { pp: true, days }),
        T.created_count ? `${faNum(T.created_paid_count)} از ${faNum(T.created_count)} فاکتور پرداخت شد` : 'فاکتوری در این بازه ساخته نشد'),
      kpi('فاکتور ساخته‌شده', faNum(T.created_count), delta(T.created_count, P.created_count, { days })),
      kpi('کارت‌های خریدار', faNum(T.distinct_payers), delta(T.distinct_payers, P.distinct_payers, { days }), 'کارت‌های متفاوتی که واریز کرده‌اند'),
    ].join('');

    const body = $('#rep-body', root);
    if (!T.paid_count && !T.created_count) {
      body.innerHTML = `<section class="card">${emptyState('chart', 'در این بازه فروشی ثبت نشده', 'بازهٔ زمانی را تغییر دهید، یا با ساخت فاکتور و اتصال گوشی، اولین فروش را ثبت کنید. نمودارها با اولین پرداخت پر می‌شوند.', can('invoices:read') ? '<a class="btn btn-primary" href="#/invoices">رفتن به فاکتورها</a>' : '')}</section>`;
      return;
    }
    const noPay = T.paid_count ? '' : 'در این بازه پرداختی ثبت نشده است';
    const monthly = days > 62;
    const series = monthly ? byMonth(r.daily) : r.daily.map(dayLabels);
    body.innerHTML = `<div style="display:grid;gap:16px">
      ${chartCard({ id: 'daily', title: monthly ? 'فروش ماهانه' : 'فروش روزانه', unit: 'مبالغ به تومان', empty: noPay })}
      <div class="grid g2">${chartCard({ id: 'hour', title: 'ساعت‌های فروش', unit: 'جمع مبلغ در هر ساعت', empty: noPay })}${chartCard({ id: 'week', title: 'روزهای هفته', unit: 'جمع مبلغ در هر روز هفته', empty: noPay })}</div>
      <div class="grid g2">${chartCard({ id: 'bank', title: 'بانک مقصد', unit: 'پول به کدام کارت‌ها رسید', empty: noPay })}${chartCard({ id: 'channel', title: 'کانال فروش', unit: 'فروش و نرخ تبدیل هر کانال' })}</div></div>`;

    if (T.paid_count) {
      // Daily / monthly
      const tickEvery = Math.max(1, Math.ceil(series.length / (innerWidth < 640 ? 4 : 7)));
      columnChart($('#c-daily', body), series.map((d, i) => ({
        v: rialToToman(d.paid_rial),
        label: i % tickEvery === 0 ? d.short : '',
        tip: `${d.long}<br><b>${toman(d.paid_rial)}</b> · ${faNum(d.paid_count)} پرداخت${d.created_count ? `<br><span class="muted">${faNum(d.created_count)} فاکتور ساخته شد</span>` : ''}`,
      })), { title: monthly ? 'نمودار فروش ماهانه' : 'نمودار فروش روزانه' });
      $('#t-daily', body).innerHTML = tableHtml([monthly ? 'ماه' : 'روز', 'مبلغ (تومان)', 'تعداد پرداخت', 'فاکتور ساخته‌شده'], series.map((d) => [esc(d.long), faNum(rialToToman(d.paid_rial)), faNum(d.paid_count), faNum(d.created_count)]), 'فروش در بازهٔ انتخاب‌شده');

      // Hour of day
      columnChart($('#c-hour', body), r.hourly.map((h) => ({
        v: rialToToman(h.paid_rial),
        label: h.hour % 6 === 0 || h.hour === 23 ? toFa(String(h.hour).padStart(2, '0')) : '',
        tip: `ساعت ${toFa(String(h.hour).padStart(2, '0'))} تا ${toFa(String((h.hour + 1) % 24).padStart(2, '0'))}<br><b>${toman(h.paid_rial)}</b> · ${faNum(h.paid_count)} پرداخت`,
      })), { title: 'نمودار فروش به تفکیک ساعت روز' });
      $('#t-hour', body).innerHTML = tableHtml(['ساعت', 'مبلغ (تومان)', 'تعداد پرداخت'], r.hourly.map((h) => [toFa(String(h.hour).padStart(2, '0')) + ':۰۰', faNum(rialToToman(h.paid_rial)), faNum(h.paid_count)]), 'فروش به تفکیک ساعت');

      // Weekday (Saturday first)
      const narrow = $('#c-week', body).clientWidth < 360;
      columnChart($('#c-week', body), r.weekday.map((w) => ({
        v: rialToToman(w.paid_rial),
        label: narrow ? WEEKDAY_SHORT[w.weekday] : w.name,
        tip: `${w.name}<br><b>${toman(w.paid_rial)}</b> · ${faNum(w.paid_count)} پرداخت`,
      })), { title: 'نمودار فروش به تفکیک روز هفته' });
      $('#t-week', body).innerHTML = tableHtml(['روز', 'مبلغ (تومان)', 'تعداد پرداخت'], r.weekday.map((w) => [w.name, faNum(rialToToman(w.paid_rial)), faNum(w.paid_count)]), 'فروش به تفکیک روز هفته');

      // Receiving bank
      hbars($('#c-bank', body), r.banks.map((b) => ({
        name: b.name, v: b.paid_rial, value: `${compact(rialToToman(b.paid_rial))} <span class="muted">${dec(b.share_pct)}٪</span>`,
        tip: `${esc(b.name)}<br><b>${toman(b.paid_rial)}</b> · ${faNum(b.paid_count)} پرداخت`, aria: `${b.name}: ${toman(b.paid_rial)}، ${faNum(b.paid_count)} پرداخت، ${dec(b.share_pct)} درصد`,
      })));
      $('#t-bank', body).innerHTML = tableHtml(['بانک', 'مبلغ (تومان)', 'تعداد', 'سهم'], r.banks.map((b) => [esc(b.name), faNum(rialToToman(b.paid_rial)), faNum(b.paid_count), `${dec(b.share_pct)}٪`]), 'فروش به تفکیک بانک مقصد');
    }

    // Channels (meaningful even with no payments: conversion of created invoices)
    hbars($('#c-channel', body), r.channels.map((c) => ({
      name: c.name, v: c.paid_rial,
      sub: c.created_count ? `نرخ تبدیل ${c.conversion_pct === null ? '—' : dec(c.conversion_pct) + '٪'} · ${faNum(c.created_count)} فاکتور` : 'بدون فاکتور',
      value: c.paid_rial ? compact(rialToToman(c.paid_rial)) : '<span class="muted">۰</span>',
      tip: `${esc(c.name)}<br><b>${toman(c.paid_rial)}</b> · ${faNum(c.paid_count)} پرداخت${c.created_count ? `<br>${faNum(c.created_paid_count)} از ${faNum(c.created_count)} فاکتور پرداخت شد` : ''}`,
      aria: `${c.name}: ${toman(c.paid_rial)}، ${faNum(c.paid_count)} پرداخت، ${faNum(c.created_count)} فاکتور`,
    })));
    $('#t-channel', body).innerHTML = tableHtml(['کانال', 'مبلغ (تومان)', 'پرداخت', 'فاکتور', 'نرخ تبدیل'], r.channels.map((c) => [esc(c.name), faNum(rialToToman(c.paid_rial)), faNum(c.paid_count), faNum(c.created_count), c.conversion_pct === null ? '—' : `${dec(c.conversion_pct)}٪`]), 'فروش به تفکیک کانال');

    $$('[data-table]', body).forEach((b) => b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'نمودار' : 'جدول';
      const id = b.dataset.table;
      $(`#t-${id}`, body).classList.toggle('sr-only', !on);
      $(`#c-${id}`, body).classList.toggle('hidden', on);
    }));
  }

  await load();
}

/** Daily rows → labels; long ranges fold into Jalali months. */
function byMonth(daily) {
  const out = [];
  for (const d of daily) {
    const { jy, jm } = jParts(d.jalali);
    let m = out[out.length - 1];
    if (!m || m.jy !== jy || m.jm !== jm) { m = { jy, jm, paid_rial: 0, paid_count: 0, created_count: 0 }; out.push(m); }
    m.paid_rial += d.paid_rial; m.paid_count += d.paid_count; m.created_count += d.created_count;
  }
  const years = new Set(out.map((m) => m.jy)).size > 1;
  return out.map((m) => ({ ...m, short: years ? `${MONTHS[m.jm - 1].slice(0, 3)} ${toFa(String(m.jy).slice(2))}` : MONTHS[m.jm - 1], long: `${MONTHS[m.jm - 1]} ${toFa(m.jy)}` }));
}
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
function dayLabels(d) {
  const { jm, jd } = jParts(d.jalali);
  return { ...d, short: `${toFa(jd)} ${MONTHS[jm - 1]}`, long: `${WEEKDAYS[d.weekday]} ${toFa(jd)} ${MONTHS[jm - 1]}` };
}
