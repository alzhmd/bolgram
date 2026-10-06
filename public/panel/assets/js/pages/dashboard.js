import { CONFIG, api, toFa, faNum, toman, rialToToman, jDate, jTime, ago, esc, emptyState, ICON, $, $$, tehranHour } from '../core.js';
import { quickInvoice, quickStart, setNotifications } from '../shell.js';

const BANK = { mellat: 'ملت', melli: 'ملی', saderat: 'صادرات', tejarat: 'تجارت', sepah: 'سپه', saman: 'سامان', blu: 'بلو', pasargad: 'پاسارگاد', parsian: 'پارسیان', ayandeh: 'آینده', keshavarzi: 'کشاورزی', maskan: 'مسکن', refah: 'رفاه', shahr: 'شهر', resalat: 'رسالت', 'mehr-iran': 'مهر ایران', khavarmianeh: 'خاورمیانه' };
const STATUS = { PAID: ['تسویه‌شده', 'ok'], PENDING: ['در انتظار', 'warn'], EXPIRED: ['منقضی', 'bad'], CANCELLED: ['لغوشده', 'bad'], FAILED: ['ناموفق', 'bad'] };

function greet(h) {
  if (h >= 5 && h < 11) return 'صبح بخیر';
  if (h >= 11 && h < 15) return 'ظهر بخیر';
  if (h >= 15 && h < 19) return 'عصر بخیر';
  return 'شب بخیر';
}

function spark(values) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${24 - (v / max) * 20}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function kpi(title, value, sub, icon, extra = '', attrs = '') {
  return `<div class="card kpi" ${attrs}><div class="k-top"><span class="ico">${ICON[icon]}</span><span class="k-title">${title}</span></div><div class="k-val num">${value}</div><div class="k-sub">${sub}</div>${extra}</div>`;
}
const soon = '<span class="pill" style="font-size:.72rem">به‌زودی</span>';

/** Hourly sales line (single series: no legend; title names it). Crosshair + tooltip on hover/keyboard. */
function hourlyChart(el, hourlyRial) {
  const W = 640, H = 220, L = 46, R = 10, T = 12, B = 26;
  const values = hourlyRial.map(rialToToman);
  const max = Math.max(1, ...values);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const x = (i) => L + (i / 23) * (W - L - R);
  const y = (v) => T + (1 - v / nice) * (H - T - B);
  const now = tehranHour();
  const line = values.slice(0, now + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const short = (v) => (v >= 1e6 ? `${toFa((v / 1e6).toFixed(v % 1e6 ? 1 : 0))}م` : v >= 1e3 ? `${toFa(Math.round(v / 1e3))}ه` : toFa(v));
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(nice * f)}" y2="${y(nice * f)}" stroke="var(--border)" stroke-width="1"/><text x="${L - 8}" y="${y(nice * f) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(nice * f)}</text>`).join('');
  const ticks = [0, 6, 12, 18, 23].map((h) => `<text x="${x(h)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${toFa(String(h).padStart(2, '0'))}</text>`).join('');
  el.innerHTML = `<div style="position:relative"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="نمودار فروش امروز به تفکیک ساعت" style="display:block;direction:ltr">
      ${grid}${ticks}
      <line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="${x(now)}" y="${T + 10}" text-anchor="${now > 20 ? 'end' : 'start'}" dx="${now > 20 ? -4 : 4}" font-size="11" fill="var(--muted)">الان</text>
      <path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="xh hidden" y1="${T}" y2="${H - B}" stroke="var(--fg)" stroke-opacity=".35" stroke-width="1"/>
      <circle class="xp hidden" r="4.5" fill="var(--brand)" stroke="var(--surface)" stroke-width="2"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" tabindex="0" class="hit" aria-label="برای دیدن مقدار هر ساعت، با کلیدهای جهت حرکت کنید"/>
    </svg><div class="tip hidden" style="position:absolute;top:0;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:6px 10px;font-size:.8rem;pointer-events:none;white-space:nowrap"></div></div>
    <table class="sr-only"><caption>فروش امروز به تفکیک ساعت (تومان)</caption><tbody>${values.map((v, i) => `<tr><th>${toFa(i)}</th><td>${faNum(v)}</td></tr>`).join('')}</tbody></table>`;
  const svg = el.querySelector('svg'), hit = el.querySelector('.hit'), xh = el.querySelector('.xh'), xp = el.querySelector('.xp'), tip = el.querySelector('.tip');
  let cur = now;
  const show = (i) => {
    cur = Math.max(0, Math.min(23, i));
    xh.setAttribute('x1', x(cur)); xh.setAttribute('x2', x(cur));
    xp.setAttribute('cx', x(cur)); xp.setAttribute('cy', y(values[cur]));
    [xh, xp, tip].forEach((n) => n.classList.remove('hidden'));
    tip.innerHTML = `ساعت ${toFa(String(cur).padStart(2, '0'))}:۰۰ — <b>${faNum(values[cur])} تومان</b>`;
    const px = (x(cur) / W) * svg.clientWidth;
    tip.style.left = `${Math.min(Math.max(0, px - 70), svg.clientWidth - 150)}px`;
  };
  const hide = () => [xh, xp, tip].forEach((n) => n.classList.add('hidden'));
  hit.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); show(Math.round((((e.clientX - r.left) / r.width) * W - L) / ((W - L - R) / 23))); });
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('focus', () => show(cur));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1); else return; e.preventDefault(); });
}

export async function renderDashboard(page) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const d = await api('/api/v2/dashboard');
  const m = d.merchant, k = d.kpi;
  const h = tehranHour();
  const firstStepHidden = localStorage.getItem('bg_first_step_closed') === '1';
  const essentials = [['کارت واریز', d.onboarding.card], ['گوشی متصل', k.devices > 0], ['ربات تلگرام', d.onboarding.bot]];
  const optional = [['لوگوی فروشگاه', false], ['وب‌هوک', d.webhook_configured], ['گروه تلگرام', false]];
  const missing = essentials.filter(([, ok]) => !ok).length;
  const todaySum = k.today_rial, todayCount = k.today_count;
  const busiest = d.hourly_rial.indexOf(Math.max(...d.hourly_rial));
  const lastDeposit = d.recent.find((r) => r.matched);

  page.innerHTML = `
  <section class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span class="ico" style="width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand)">${ICON.user}</span>
    <div style="flex:1;min-width:200px"><h1>${greet(h)}، ${esc(m.name)} 👋</h1><p class="muted" style="margin:0">خوش آمدید؛ وضعیت فروش امروز شما اینجاست.</p></div>
    <div class="muted num" id="welcome-clock"></div>
  </section>

  <div class="page-head"><h2>داشبورد</h2><span class="muted">${esc(m.name)} · <span class="ltr">@${esc(m.handle || '')}</span></span><span class="pill live"><i></i>زنده</span>
    <div class="actions"><button class="btn btn-primary" type="button" id="new-link">${ICON.plus} ساخت لینک پرداخت</button></div></div>

  ${firstStepHidden ? '' : `<section class="card" id="first-step"><div class="card-head"><h3>اولین قدم</h3><span class="muted">اپ را نصب کن، بعد آموزش اتصال را ببین.</span><button class="icon-btn" type="button" id="first-x" aria-label="بستن" style="margin-inline-start:auto">${ICON.x}</button></div>
    <div class="grid g3">
      <a class="card" style="text-decoration:none;color:var(--fg)" href="${CONFIG.SITE_URL}/docs.html#start" target="_blank" rel="noopener"><b>شروع سریع</b><p class="muted" style="margin:4px 0 0">از ثبت کارت تا اولین پرداخت</p></a>
      <a class="card" style="text-decoration:none;color:var(--fg)" href="${CONFIG.SITE_URL}/docs.html#android" target="_blank" rel="noopener"><b>آموزش اتصال اندروید</b><p class="muted" style="margin:4px 0 0">نصب اپ و اسکن کد اتصال</p></a>
      <a class="card" style="text-decoration:none;color:var(--fg)" href="${CONFIG.SITE_URL}/docs.html#ios" target="_blank" rel="noopener"><b>آموزش اتصال آیفون</b><p class="muted" style="margin:4px 0 0">شورتکات و اتوماسیون پیام</p></a>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn btn-primary" href="${CONFIG.ANDROID_APK_URL || '#/app'}">دانلود نسخه اندروید</a><a class="btn" href="#/app">نصب شورتکات آیفون</a></div></section>`}

  <div class="grid g3" data-tour="status">
    <div class="card"><div class="card-head">${ICON.phone}<h3>گوشی وصل است؟</h3></div>${k.devices ? `<span class="pill ${k.devices_online ? 'ok' : 'bad'}">${k.devices_online ? `${toFa(k.devices_online)} دستگاه آنلاین` : 'همهٔ دستگاه‌ها آفلاین‌اند'}</span><p class="muted" style="margin:8px 0 0">آخرین ارتباط: ${k.device_last_seen ? ago(k.device_last_seen) : '—'}</p>` : '<span class="pill bad">هنوز دستگاهی وصل نشده</span><p class="muted" style="margin:8px 0 0"><a href="#/app">اتصال گوشی</a></p>'}</div>
    <div class="card"><div class="card-head">${ICON.clock}<h3>فاکتور نزدیک انقضا</h3></div><div class="k-val num" style="font-size:1.4rem;font-weight:800">${toFa(k.expiring_invoices)}</div><p class="muted" style="margin:0">تا ۱۰ دقیقهٔ دیگر منقضی می‌شوند</p></div>
    <div class="card ${k.orphan_deposits ? 'attention' : ''}"><div class="card-head">${ICON.inbox}<h3>واریزی بی‌صاحب</h3></div><div class="k-val num" style="font-size:1.4rem;font-weight:800">${toFa(k.orphan_deposits)}</div><p class="muted" style="margin:0">واریز بدون فاکتور یا از فرستندهٔ مشکوک</p></div>
  </div>

  ${!d.onboarding.card ? `<div class="card attention" role="alert" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${ICON.alert}<div style="flex:1"><b>نیاز به رسیدگی</b><div>هنوز کارت بانکی ثبت نکرده‌اید؛ بدون کارت فاکتور ساخته نمی‌شود.</div></div><a class="btn btn-primary" href="#/cards">افزودن کارت</a></div>` : ''}

  <div class="grid g4">
    ${kpi('فروش امروز', toman(todaySum), `${toFa(todayCount)} پرداخت تأییدشده`, 'chart', spark(d.hourly_rial), 'data-tour="sales"')}
    ${kpi('تسویه امروز', toFa(todayCount), 'پرداخت با تأیید خودکار یا دستی', 'check', spark(d.hourly_rial.map((v) => (v ? 1 : 0))))}
    ${kpi('کیف پول کارمزد', '—', `موجودی و بدهی ${soon}`, 'wallet')}
    ${kpi('فاکتور باز', toFa(k.open_invoices), 'در انتظار واریز مشتری', 'receipt')}
  </div>
  <div class="grid g4">
    ${kpi('لینک‌های فعال', '—', soon, 'link')}
    ${kpi('درآمد این ماه', toman(k.month_rial), `از ابتدای ${jDate(new Date(), { day: undefined, year: undefined, month: 'long' })}`, 'bolt')}
    ${kpi('پلن فعلی', m.plan === 'FREE' ? 'رایگان' : esc(m.plan), `روز مانده تا انقضا: — ${soon}`, 'crown')}
    ${kpi('اعتبار باقی‌مانده', '—', soon, 'gift')}
  </div>

  <div class="grid g2">
    <section class="card" data-tour="deposits"><div class="card-head"><h3>آخرین واریزها</h3><a href="#/invoices">همه</a></div>
      ${d.recent.length ? `<ul class="list">${d.recent.map((r) => `<li><span class="pill ${r.matched ? 'ok' : 'warn'}">${r.matched ? 'تطبیق‌خورده' : 'بی‌صاحب'}</span><span>${esc(BANK[r.bank] || r.bank)}</span><b class="num" style="margin-inline-start:auto">${toman(r.amount_rial)}</b><span class="muted" style="font-size:.8rem">${r.at ? ago(r.at) : ''}</span></li>`).join('')}</ul>`
        : emptyState('inbox', 'هنوز واریزی نرسیده', 'بعد از اتصال گوشی، هر پیامک واریز بانک اینجا نمایش داده می‌شود.', '<a class="btn btn-primary" href="#/app">اتصال گوشی</a>')}</section>
    <section class="card"><div class="card-head"><h3>فروش امروز ساعت به ساعت</h3><span class="muted" style="font-size:.8rem;margin-inline-start:auto">تومان</span></div><div id="hourly"></div>
      <div class="grid g3" style="margin-top:10px;gap:8px">
        <div><div class="muted" style="font-size:.8rem">شلوغ‌ترین ساعت</div><b class="num">${todaySum ? `${toFa(String(busiest).padStart(2, '0'))}:۰۰` : '—'}</b></div>
        <div><div class="muted" style="font-size:.8rem">میانگین هر تسویه</div><b class="num">${todayCount ? toman(todaySum / todayCount) : '—'}</b></div>
        <div><div class="muted" style="font-size:.8rem">آخرین واریز</div><b class="num">${lastDeposit?.at ? jTime(lastDeposit.at) : '—'}</b></div>
      </div></section>
  </div>

  <div class="grid g2">
    <section class="card"><div class="card-head"><h3>تیکت‌های اخیر</h3><a href="#/support">مشاهده همه</a></div>${emptyState('help', 'تیکتی ندارید', 'اگر سؤالی دارید، از بخش پشتیبانی تیکت بفرستید.', '<a class="btn" href="#/support">ثبت تیکت</a>')}</section>
    <section class="card"><div class="card-head"><h3>آخرین فاکتورها</h3><a href="#/invoices">مشاهده همه</a></div>
      ${d.recent_invoices.length ? `<ul class="list">${d.recent_invoices.map((r) => { const [t, c] = STATUS[r.status] || [r.status, '']; return `<li><span class="pill ${c}">${t}</span><span class="ltr muted" style="font-size:.8rem">${esc(r.id)}</span><b class="num" style="margin-inline-start:auto">${toman(r.amount_rial)}</b></li>`; }).join('')}</ul>`
        : emptyState('receipt', 'هنوز فاکتوری نساخته‌اید', 'با دکمهٔ «+ فاکتور» اولین فاکتور را بسازید.', '<button class="btn btn-primary" type="button" data-qi>ساخت فاکتور</button>')}</section>
  </div>

  <div class="grid g2">
    <section class="card"><div class="card-head"><h3>سلامت فروشگاه</h3>${missing ? `<span class="pill warn">${toFa(missing)} مورد ضروری آماده نیست</span>` : '<span class="pill ok">همه‌چیز آماده است</span>'}</div>
      <div class="grid g2" style="gap:8px"><div><div class="muted" style="font-size:.8rem">ضروری</div><ul class="checklist">${essentials.map(([t, ok]) => `<li><i class="dot ${ok ? 'on' : ''}"></i>${t}</li>`).join('')}</ul></div>
      <div><div class="muted" style="font-size:.8rem">اختیاری</div><ul class="checklist">${optional.map(([t, ok]) => `<li><i class="dot ${ok ? 'on' : ''}"></i>${t}</li>`).join('')}</ul></div></div></section>
    <section class="card"><div class="card-head"><h3>کیف پول کارمزد</h3><a href="#/wallet">گردش حساب</a></div><p class="muted">پول فروش مستقیم به کارت شما می‌رود؛ این کیف پول فقط برای کارمزد سرویس است. ${soon}</p>
      <div class="grid g2" style="gap:8px"><a class="card" href="${CONFIG.SUPPORT_TELEGRAM}" target="_blank" rel="noopener" style="text-decoration:none;color:var(--fg)"><i class="dot on" style="display:inline-block"></i> کانال تلگرام ${CONFIG.SERVICE_NAME}<div class="muted ltr" style="font-size:.8rem">t.me/bolgram</div></a>
      <a class="card" href="https://instagram.com/bolgram.example" target="_blank" rel="noopener" style="text-decoration:none;color:var(--fg)"><i class="dot on" style="display:inline-block"></i> اینستاگرام ${CONFIG.SERVICE_NAME}<div class="muted ltr" style="font-size:.8rem">@bolgram.example</div></a></div></section>
  </div>`;

  hourlyChart($('#hourly', page), d.hourly_rial);
  const wc = $('#welcome-clock', page);
  const tick = () => { if (!document.body.contains(wc)) return clearInterval(t); const n = new Date(); wc.textContent = `${jDate(n, { weekday: 'long' })} · ${jTime(n)}`; };
  const t = setInterval(tick, 20_000); tick();
  $('#new-link', page).addEventListener('click', quickInvoice);
  $$('[data-qi]', page).forEach((b) => b.addEventListener('click', quickInvoice));
  $('#first-x', page)?.addEventListener('click', () => { localStorage.setItem('bg_first_step_closed', '1'); $('#first-step', page).remove(); });
  setNotifications(d.recent.map((r) => ({ at: r.at, ok: r.matched, title: r.matched ? `پرداخت ${toman(r.amount_rial)} تأیید شد` : `واریز بی‌صاحب ${toman(r.amount_rial)}`, sub: `${BANK[r.bank] || r.bank} · ${r.at ? ago(r.at) : ''}` })));
  if (localStorage.getItem('bg_quickstart') === '1') quickStart(d.onboarding);
}
