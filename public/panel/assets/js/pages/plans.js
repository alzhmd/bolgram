import { api, can, esc, faNum, toFa, jDate, toast, confirmDialog, useStyle } from '../core.js';

useStyle('plans', `
.pl-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.pl-card{display:flex;flex-direction:column;gap:12px;position:relative}
.pl-card.hl{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.pl-card .tag{position:absolute;top:-11px;inset-inline-start:14px}
.pl-price{font-size:1.6rem;font-weight:800}.pl-price small{font-size:.8rem;font-weight:400;color:var(--muted)}
.pl-card ul{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:.9rem}
.pl-card li::before{content:'✓';color:var(--green);margin-inline-end:6px}
.pl-card .grow{flex:1}
.pl-use{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.pl-use .progress{margin-top:4px}
.pl-old{text-decoration:line-through;color:var(--muted);font-size:.85rem}
`);

const lim = (v) => (v === null ? 'نامحدود' : faNum(v));
let months = 1;

export async function render(page) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  let r;
  try { r = await api('/api/v2/plans'); } catch (e) { page.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; return; }
  const cur = r.current;
  const disc = Object.fromEntries(r.discounts.map((d) => [d.months, d.percent]));
  const priceOf = (p) => Math.round((p.monthly_price_toman * months * (100 - (disc[months] || 0))) / 100);
  const draw = () => {
    page.innerHTML = `
      <div class="page-head"><h1>اشتراک و پلن‌ها</h1></div>
      <section class="card"><div class="card-head"><h3>پلن فعلی شما</h3><span class="pill ok" style="margin-inline-start:auto">${esc(cur.plan.name)}</span></div>
        <p class="muted" style="margin-top:0">${cur.expires_at ? `اشتراک تا <b>${jDate(cur.expires_at)}</b> فعال است و پس از آن به پلن رایگان برمی‌گردد.` : 'شما در پلن رایگان هستید.'} موجودی کیف پول: <b>${faNum(r.balance_rial / 10)} تومان</b></p>
        <div class="pl-use">${[['cards', 'کارت'], ['links', 'لینک پرداخت'], ['team', 'همکار'], ['devices', 'دستگاه']].map(([k, n]) => {
          const max = cur.plan.limits[k]; const u = cur.usage[k]; const pct = max ? Math.min(100, Math.round((u / max) * 100)) : 0;
          return `<div><div class="muted" style="font-size:.85rem">${n}</div><b>${faNum(u)}</b> <span class="muted">از ${lim(max)}</span>${max ? `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="مصرف ${n}"><i style="width:${pct}%"></i></div>` : ''}</div>`;
        }).join('')}</div></section>
      <div class="toolbar" role="group" aria-label="مدت اشتراک"><span class="muted">مدت اشتراک:</span>
        <div class="seg">${r.discounts.map((d) => `<button type="button" data-m="${d.months}" aria-pressed="${d.months === months}">${faNum(d.months)} ماهه${d.percent ? ` · ${faNum(d.percent)}٪ تخفیف` : ''}</button>`).join('')}</div></div>
      <div class="pl-grid">${r.plans.map((p) => {
        const isCur = p.id === cur.plan.id, price = priceOf(p), full = p.monthly_price_toman * months;
        return `<section class="card pl-card ${p.highlighted ? 'hl' : ''}" data-plan="${esc(p.id)}">${p.highlighted ? '<span class="pill ok tag">پیشنهاد ما</span>' : ''}
          <div><h3 style="margin:0">${esc(p.name)}</h3><div class="muted" style="font-size:.85rem">${esc(p.description)}</div></div>
          <div>${p.monthly_price_toman ? `${price !== full ? `<div class="pl-old num">${faNum(full)}</div>` : ''}<div class="pl-price num">${faNum(price)} <small>تومان / ${faNum(months)} ماه</small></div>` : '<div class="pl-price">رایگان</div>'}</div>
          <ul class="grow"><li>کارمزد <b>${toFa(p.fee_percent)}٪</b> (${p.fee_max_toman ? `${faNum(p.fee_min_toman)} تا ${faNum(p.fee_max_toman)} تومان` : `حداقل ${faNum(p.fee_min_toman)} تومان`})</li>
            <li>${lim(p.limits.cards)} کارت · ${lim(p.limits.links)} لینک پرداخت</li><li>${lim(p.limits.team)} همکار · ${lim(p.limits.devices)} دستگاه</li><li>اعتبار منفی تا ${faNum(p.credit_toman)} تومان</li>
            ${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          ${p.monthly_price_toman > 0 ? (can('wallet:manage') ? `<button class="btn ${p.highlighted ? 'btn-primary' : ''} btn-block" type="button" data-sub="${esc(p.id)}">${isCur ? 'تمدید اشتراک' : 'خرید این پلن'}</button>` : '') : `<button class="btn btn-block" type="button" disabled>${isCur ? 'پلن فعلی' : 'پلن پایه'}</button>`}
        </section>`;
      }).join('')}</div>
      <p class="muted">پرداخت از موجودی کیف پول انجام می‌شود. با خرید پلن دیگر، پلن جدید از همین لحظه جایگزین پلن فعلی می‌شود؛ تمدید همان پلن، به مدت اشتراک فعلی اضافه می‌شود.</p>`;
    page.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { months = Number(b.dataset.m); draw(); }));
    page.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => subscribe(r.plans.find((p) => p.id === b.dataset.sub), b)));
  };
  async function subscribe(p, btn) {
    const price = priceOf(p), after = Math.round(r.balance_rial / 10) - price;
    const ok = await confirmDialog('تأیید خرید پلن',
      `پلن <b>${esc(p.name)}</b> برای <b>${faNum(months)} ماه</b> به مبلغ <b>${faNum(price)} تومان</b> از کیف پول شما کسر می‌شود.<br>موجودی بعد از خرید: <b class="num">${after < 0 ? '−' : ''}${faNum(Math.abs(after))} تومان</b>${after < 0 ? '<br><span style="color:var(--red)">موجودی کافی نیست؛ ابتدا کیف پول را شارژ کنید.</span>' : ''}`, 'پرداخت از کیف پول');
    if (!ok) return;
    btn.disabled = true;
    try {
      await api(`/api/v2/plans/${encodeURIComponent(p.id)}/subscribe`, { method: 'POST', body: { months } });
      toast('اشتراک فعال شد', 'ok');
      render(page);
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'err');
      if (e.status === 402) location.hash = '#/wallet';
    }
  }
  draw();
}
