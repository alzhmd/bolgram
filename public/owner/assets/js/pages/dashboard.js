import { faNum, toFa, toman, rialToToman, jDate, esc, emptyState, useStyle, $ } from '/panel/assets/js/core.js';
import { rangeControl, preset } from '/panel/assets/js/jdate.js';
import { oapi, qs, showError, head } from '../ui.js';

useStyle('o-dash', `
.od-kpi{display:grid;gap:4px;min-width:0}
.od-kpi .k-title{font-size:.84rem;color:var(--muted)}
.od-kpi .k-val{font-size:1.45rem;font-weight:800;overflow-wrap:anywhere}
.od-kpi .k-sub{font-size:.8rem;color:var(--muted)}
.od-kpi a{text-decoration:none;color:inherit;display:grid;gap:4px}
.od-top li a{display:flex;flex:1;gap:10px;justify-content:space-between;color:inherit;text-decoration:none;min-width:0}
.od-split{display:grid;gap:16px;grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
@media (max-width:900px){.od-split{grid-template-columns:1fr}}
.od-tip{position:absolute;top:0;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:6px 10px;font-size:.8rem;pointer-events:none;white-space:nowrap}
`);

const short = (v) => (v <= 0 ? toFa(0) : v >= 1e9 ? `${toFa((v / 1e9).toFixed(v % 1e9 ? 1 : 0))} میلیارد` : v >= 1e6 ? `${toFa((v / 1e6).toFixed(v % 1e6 ? 1 : 0))} م` : v >= 1e3 ? `${toFa(Math.round(v / 1e3))} هزار` : toFa(Math.round(v)));
const dayLabel = (day, o = { month: 'numeric', day: 'numeric' }) => jDate(new Date(`${day}T12:00:00+03:30`), o);

/** Daily paid volume: thin bars, one series (title names it), tooltip on hover and arrow keys, hidden table fallback. */
function dailyChart(el, daily) {
  const W = 720, H = 230, L = 52, R = 8, T = 12, B = 28;
  const vals = daily.map((d) => rialToToman(d.paid_rial));
  const max = Math.max(0, ...vals);
  const p10 = 10 ** Math.floor(Math.log10(Math.max(1, max)));
  const nice = max > 0 ? Math.ceil(max / p10) * p10 : 100_000; // empty range: a neutral 0 to 100 هزار scale
  const n = daily.length;
  const slot = (W - L - R) / n;
  const bw = Math.max(1.5, Math.min(22, slot * 0.62));
  const x = (i) => L + slot * i + slot / 2;
  const y = (v) => T + (1 - v / nice) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(nice * f)}" y2="${y(nice * f)}" stroke="var(--border)"/><text x="${L - 8}" y="${y(nice * f) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(nice * f)}</text>`).join('');
  const step = Math.max(1, Math.ceil(n / 7));
  const ticks = daily.map((d, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${dayLabel(d.day)}</text>` : '')).join('');
  const bars = vals.map((v, i) => (v > 0 ? `<rect x="${x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(1, H - B - y(v))}" rx="${Math.min(3, bw / 2)}" fill="var(--brand)"/>` : '')).join('');
  el.innerHTML = `<div style="position:relative"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="نمودار حجم پرداخت روزانه (تومان)" style="display:block;direction:ltr">
      ${grid}${ticks}${bars}
      <rect class="sel hidden" y="${T}" height="${H - T - B}" fill="var(--brand)" fill-opacity=".12"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" tabindex="0" class="hit" aria-label="برای دیدن مقدار هر روز با کلیدهای جهت حرکت کنید"/>
    </svg><div class="od-tip hidden"></div></div>
    <table class="sr-only"><caption>حجم پرداخت روزانه (تومان)</caption><tbody>${daily.map((d, i) => `<tr><th>${dayLabel(d.day)}</th><td>${faNum(vals[i])}</td></tr>`).join('')}</tbody></table>`;
  const svg = $('svg', el), hit = $('.hit', el), sel = $('.sel', el), tip = $('.od-tip', el);
  let cur = n - 1;
  const show = (i) => {
    cur = Math.max(0, Math.min(n - 1, i));
    sel.setAttribute('x', x(cur) - slot / 2); sel.setAttribute('width', slot);
    sel.classList.remove('hidden'); tip.classList.remove('hidden');
    tip.innerHTML = `${dayLabel(daily[cur].day, { year: 'numeric', month: 'long', day: 'numeric' })} — <b>${faNum(vals[cur])} تومان</b> · ${faNum(daily[cur].paid_count)} پرداخت`;
    const px = (x(cur) / W) * svg.clientWidth;
    tip.style.left = `${Math.min(Math.max(0, px - 90), Math.max(0, svg.clientWidth - 230))}px`;
  };
  const hide = () => { sel.classList.add('hidden'); tip.classList.add('hidden'); };
  hit.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); show(Math.floor((((e.clientX - r.left) / r.width) * W - L) / slot)); });
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('focus', () => show(cur));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(cur + 1); else if (e.key === 'ArrowRight') show(cur - 1); else return; e.preventDefault(); });
}

export async function render(page) {
  let range = { id: '30d', ...preset('30d') };
  const kpi = (title, val, sub = '', href = '') => `<div class="card od-kpi">${href ? `<a href="${href}">` : ''}<span class="k-title">${title}</span><span class="k-val num">${val}</span>${sub ? `<span class="k-sub">${sub}</span>` : ''}${href ? '</a>' : ''}</div>`;
  const draw = async () => {
    const box = $('#od-body', page);
    box.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let d;
    try { d = await oapi(`/api/owner/overview${qs({ from: range.from.toISOString(), to: range.to.toISOString() })}`); } catch (e) { return showError(box, e, draw); }
    const todo = [];
    if (d.tickets?.open) todo.push(['#/tickets', `${faNum(d.tickets.open)} تیکت منتظر پاسخ شماست`]);
    if (d.trust_pending) todo.push(['#/trust', `${faNum(d.trust_pending)} درخواست نماد اعتماد در انتظار بررسی است`]);
    if (d.webhook_failures_24h) todo.push(['#/webhooks', `${faNum(d.webhook_failures_24h)} ارسال وب‌هوک در ۲۴ ساعت گذشته ناموفق بوده`]);
    if (d.held_deposits.count) todo.push(['#/smslab', `${faNum(d.held_deposits.count)} واریزی بی‌صاحب (${toman(d.held_deposits.amount_rial)}) در فروشگاه‌ها منتظر تعیین‌تکلیف است`]);
    box.innerHTML = `
      <div class="o-kpis">
        ${kpi('فروشگاه‌ها', faNum(d.stores.total), `${faNum(d.stores.new_in_range)} جدید · ${faNum(d.stores.active_in_range)} فعال در بازه · ${faNum(d.stores.suspended)} معلق`, '#/stores')}
        ${kpi('حجم پرداخت بازه', toman(d.volume.range_rial), `${faNum(d.volume.range_count)} پرداخت موفق`)}
        ${kpi('حجم پرداخت امروز', toman(d.volume.today_rial), `${faNum(d.volume.today_count)} پرداخت`)}
        ${kpi('دستگاه‌های آنلاین', `${faNum(d.devices.online)} از ${faNum(d.devices.total)}`, 'دریافت‌کنندهٔ پیامک بانک', '#/health')}
        ${d.revenue ? kpi('درآمد کارمزد', toman(d.revenue.fees_rial), 'کارمزد تراکنش‌ها در بازه', '#/wallets') : ''}
        ${d.revenue ? kpi('فروش پلن', toman(d.revenue.plan_sales_rial), 'اشتراک‌های خریداری‌شده', '#/wallets') : ''}
        ${d.revenue ? kpi('شارژ کیف پول', toman(d.revenue.topups_rial), 'شارژهای پرداخت‌شده در بازه', '#/wallets') : ''}
        ${d.tickets ? kpi('تیکت‌های باز', faNum(d.tickets.open), `${faNum(d.tickets.active)} تیکت فعال`, '#/tickets') : ''}
        ${d.trust_pending !== null ? kpi('نماد اعتماد در انتظار', faNum(d.trust_pending), 'درخواست‌های بررسی‌نشده', '#/trust') : ''}
      </div>
      ${todo.length ? `<section class="card attention"><div class="card-head"><h3>نیاز به اقدام</h3></div><ul class="list">${todo.map(([h, t]) => `<li><a class="o-link" href="${h}">${esc(t)} ←</a></li>`).join('')}</ul></section>` : ''}
      <div class="od-split">
        <section class="card"><div class="card-head"><h3>حجم پرداخت روزانه</h3><span class="muted" style="font-size:.82rem;margin-inline-start:auto">تومان، بر پایهٔ فاکتورهای پرداخت‌شده</span></div><div id="od-chart"></div></section>
        <section class="card"><div class="card-head"><h3>پرفروش‌ترین فروشگاه‌ها</h3></div>
          ${d.top_stores.length ? `<ul class="list od-top">${d.top_stores.map((s, i) => `<li><span class="muted num">${toFa(i + 1)}</span><a href="#/stores/${encodeURIComponent(s.id)}"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(s.name || s.handle)}</b><br><span class="muted ltr" style="font-size:.78rem">@${esc(s.handle || '')}</span></span><span class="num" style="text-align:end;white-space:nowrap">${toman(s.paid_rial)}<br><span class="muted" style="font-size:.78rem">${faNum(s.paid_count)} پرداخت</span></span></a></li>`).join('')}</ul>` : emptyState('chart', 'هنوز فروشی ثبت نشده', 'وقتی فروشگاه‌ها پرداخت دریافت کنند، پرفروش‌ترین‌ها اینجا می‌آیند.')}
        </section>
      </div>
      <p class="muted" style="font-size:.82rem;margin:0">${esc(d.note)} بازه: ${jDate(d.from)} تا ${jDate(new Date(new Date(d.to).getTime() - 1))}</p>`;
    dailyChart($('#od-chart', box), d.daily);
  };
  page.innerHTML = `${head('داشبورد')}<div id="od-range"></div><div id="od-body" style="display:grid;gap:16px"></div>`;
  const rc = rangeControl('30d', (r) => { range = r; draw(); });
  $('#od-range', page).appendChild(rc);
  await draw();
}
