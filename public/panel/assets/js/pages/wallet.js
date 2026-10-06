import { api, can, esc, faNum, toFa, jDateTime, modal, toast, setBusy, copy, download, table, pager, useStyle, ICON, toLatin } from '../core.js';

useStyle('wallet', `
.wl-hero{display:grid;gap:14px;background:linear-gradient(135deg,var(--brand-soft),var(--surface));border-color:var(--brand)}
.wl-hero .bal{font-size:2rem;font-weight:800;line-height:1.2}
.wl-hero .bal.neg{color:var(--red)}
.wl-top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.wl-meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font-size:.88rem}
.wl-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.wl-prev{border:1px dashed var(--border);border-radius:12px;padding:10px 12px;background:var(--surface-2);display:grid;gap:4px;font-size:.92rem}
.wl-tiers{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.wl-tiers li{padding:6px 10px;border-radius:999px;background:var(--brand-soft);color:var(--brand);font-size:.82rem}
.wl-amt{font-weight:700}.wl-amt.pos{color:var(--green)}.wl-amt.neg{color:var(--red)}
.wl-pay{font-size:1.3rem;font-weight:800}
`);

const KINDS = { '': 'همهٔ تراکنش‌ها', topup: 'شارژ', bonus: 'هدیهٔ شارژ', fee: 'کارمزد', plan: 'خرید پلن', referral: 'پاداش دعوت', signup_bonus: 'هدیهٔ عضویت', adjust: 'اصلاح پشتیبانی', refund: 'بازگشت وجه' };
const signed = (toman) => `${toman > 0 ? '+' : toman < 0 ? '−' : ''}${faNum(Math.abs(toman))}`;

export async function render(page) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  let w;
  try { w = await api('/api/v2/wallet'); } catch (e) { page.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; return; }
  const { wallet, plan, topup } = w;
  const state = wallet.blocked ? ['bad', 'ساخت فاکتور متوقف است'] : wallet.low ? ['warn', 'موجودی کم است'] : ['ok', 'فعال'];
  const feeRange = plan.fee_max_toman ? `${faNum(plan.fee_min_toman)} تا ${faNum(plan.fee_max_toman)} تومان` : `حداقل ${faNum(plan.fee_min_toman)} تومان`;
  const maxBonus = topup.bonus_tiers.length ? Math.max(...topup.bonus_tiers.map((t) => t.percent)) : 0;
  page.innerHTML = `
    <div class="page-head"><h1>کیف پول</h1><div class="actions">${can('wallet:manage') ? `<button class="btn btn-primary" type="button" id="wl-topup" ${topup.enabled ? '' : 'disabled'}>${ICON.plus} شارژ کیف پول</button>` : ''}</div></div>
    ${wallet.blocked ? `<div class="alert alert-err" role="alert"><b>ساخت فاکتور جدید متوقف شده.</b> موجودی کیف پول از سقف اعتبار پلن شما (${faNum(wallet.credit_toman)} تومان منفی) گذشته است. کیف پول را شارژ کنید تا دوباره فاکتور بسازید؛ فاکتورهای باز و پرداخت‌های مشتریان به‌صورت عادی ادامه دارند.</div>`
      : wallet.low ? '<div class="alert alert-warn" role="status">موجودی کیف پول کم است؛ پیش از رسیدن به سقف اعتبار آن را شارژ کنید.</div>' : ''}
    ${!topup.enabled ? '<div class="alert alert-warn" role="status">شارژ آنلاین فعلاً فعال نیست. برای شارژ با پشتیبانی تماس بگیرید.</div>' : ''}
    <section class="card wl-hero" aria-label="موجودی">
      <div class="wl-top"><div><div class="muted">موجودی فعلی</div><div class="bal ${wallet.balance_rial < 0 ? 'neg' : ''}"><span class="num">${signed(wallet.balance_toman).replace('+', '')}</span> <small>تومان</small></div></div>
        <span class="pill ${state[0]}">${state[1]}</span></div>
      <div class="wl-meta"><span>پلن: <b>${esc(plan.name)}</b></span><span>اعتبار منفی مجاز: <b>${faNum(wallet.credit_toman)} تومان</b></span><span>کارمزد: <b>${toFa(plan.fee_percent)}٪</b> از هر فاکتور پرداخت‌شده</span></div>
    </section>
    <div class="grid g2">
      <section class="card"><div class="card-head"><h3>کارمزد چطور کار می‌کند؟</h3></div>
        <ul class="list" style="gap:8px">
          <li>پول مشتری مستقیم به کارت خودتان می‌نشیند؛ بولگرام هرگز پولی از شما نگه نمی‌دارد.</li>
          <li>برای هر فاکتور پرداخت‌شده، <b>${toFa(plan.fee_percent)}٪</b> مبلغ (${feeRange}) از کیف پول کم می‌شود.</li>
          <li>اگر موجودی به زیر صفر برسد تا سقف <b>${faNum(wallet.credit_toman)} تومان</b> می‌توانید ادامه دهید؛ بعد از آن فقط ساخت فاکتور جدید متوقف می‌شود.</li>
          <li>با خرید پلن بالاتر، درصد کارمزد کمتر می‌شود. <a href="#/plans">مشاهدهٔ پلن‌ها</a></li></ul></section>
      <section class="card"><div class="card-head"><h3>هدیهٔ شارژ</h3></div>
        ${topup.bonus_tiers.length ? `<p class="muted" style="margin-top:0">هرچه بیشتر شارژ کنید، هدیهٔ بیشتری می‌گیرید (تا ${faNum(maxBonus)}٪):</p>
        <ul class="wl-tiers">${topup.bonus_tiers.map((t) => `<li>از ${faNum(t.min_toman)} تومان: ${faNum(t.percent)}٪ هدیه</li>`).join('')}</ul>` : '<p class="muted">در حال حاضر هدیهٔ شارژ فعال نیست.</p>'}
        <p class="muted" style="margin-bottom:0">حداقل مبلغ شارژ ${faNum(topup.min_toman)} تومان است.</p></section>
    </div>
    <section class="card"><div class="card-head"><h3>تاریخچهٔ کیف پول</h3>
      <div class="toolbar" style="margin-inline-start:auto"><label class="sr-only" for="wl-kind">نوع تراکنش</label><select class="input select" id="wl-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn btn-sm" type="button" id="wl-csv">خروجی اکسل</button></div></div>
      <div id="wl-ledger" aria-live="polite"></div></section>`;

  const box = page.querySelector('#wl-ledger');
  const kindSel = page.querySelector('#wl-kind');
  async function load(p = 1) {
    box.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api(`/api/v2/wallet/ledger?page=${p}&per_page=15${kindSel.value ? `&kind=${kindSel.value}` : ''}`);
      box.innerHTML = table([
        { key: 'created_at', title: 'تاریخ', render: (x) => jDateTime(x.created_at) },
        { key: 'kind', title: 'نوع', render: (x) => esc(x.kind_label) },
        { key: 'amount', title: 'مبلغ (تومان)', render: (x) => `<span class="wl-amt num ${x.amount_toman >= 0 ? 'pos' : 'neg'}">${signed(x.amount_toman)}</span>` },
        { key: 'bal', title: 'مانده (تومان)', render: (x) => `<span class="num">${signed(Math.round(x.balance_after_rial / 10)).replace('+', '')}</span>` },
        { key: 'note', title: 'توضیح', render: (x) => esc(x.note || '—') },
      ], r.data, { empty: kindSel.value ? 'تراکنشی از این نوع نیست.' : 'هنوز تراکنشی ثبت نشده؛ با اولین فاکتور پرداخت‌شده یا شارژ کیف پول اینجا پر می‌شود.' });
      if (r.total > r.per_page) box.appendChild(pager(r, load));
    } catch (e) { box.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; }
  }
  kindSel.addEventListener('change', () => load(1));
  page.querySelector('#wl-csv').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    setBusy(btn, true);
    try { await download(`/api/v2/wallet/ledger.csv${kindSel.value ? `?kind=${kindSel.value}` : ''}`, 'wallet-ledger.csv'); } catch (e) { toast(e.message, 'err'); }
    setBusy(btn, false);
  });
  page.querySelector('#wl-topup')?.addEventListener('click', () => openTopup(topup, () => render(page)));
  load(1);
}

function bonusFor(toman, tiers) { let p = 0; for (const t of tiers) if (toman >= t.min_toman) p = t.percent; return p; }

function openTopup(topup, done) {
  const m = modal({
    title: 'شارژ کیف پول',
    body: `<form id="tp" novalidate>
      <div class="wl-presets" role="group" aria-label="مبلغ‌های پیشنهادی">${topup.presets_toman.map((v) => `<button type="button" class="chip" data-v="${v}">${faNum(v)}</button>`).join('')}</div>
      <div class="field"><label for="tp-amt">مبلغ شارژ (تومان)</label><input class="input ltr num" id="tp-amt" inputmode="numeric" autocomplete="off" placeholder="${faNum(topup.min_toman)}"><div class="err" id="tp-err" role="alert"></div></div>
      <div class="wl-prev" id="tp-prev" aria-live="polite"><span class="muted">مبلغ را وارد کنید تا هدیهٔ شما نمایش داده شود.</span></div></form>`,
    actions: '<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-primary" type="submit" form="tp" id="tp-go">ساخت لینک پرداخت</button>',
  });
  const inp = m.el.querySelector('#tp-amt'), prev = m.el.querySelector('#tp-prev'), err = m.el.querySelector('#tp-err');
  const val = () => Number(toLatin(inp.value).replace(/[^\d]/g, '')) || 0;
  const upd = () => {
    const v = val();
    if (v) inp.value = faNum(v);
    if (!v) { prev.innerHTML = '<span class="muted">مبلغ را وارد کنید تا هدیهٔ شما نمایش داده شود.</span>'; return; }
    const p = bonusFor(v, topup.bonus_tiers), b = Math.floor((v * p) / 100);
    prev.innerHTML = `<div>مبلغ شارژ: <b>${faNum(v)} تومان</b></div><div>هدیه${p ? ` (${faNum(p)}٪)` : ''}: <b>${faNum(b)} تومان</b></div><div>اعتبار نهایی: <b>${faNum(v + b)} تومان</b></div>`;
  };
  inp.addEventListener('input', upd);
  m.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { inp.value = faNum(b.dataset.v); upd(); inp.focus(); }));
  m.el.querySelector('#tp').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const v = val();
    if (v < topup.min_toman) { err.textContent = `حداقل مبلغ شارژ ${faNum(topup.min_toman)} تومان است`; return; }
    const btn = m.el.querySelector('#tp-go');
    setBusy(btn, true);
    try {
      const r = await api('/api/v2/wallet/topups', { method: 'POST', body: { amount: v } });
      m.el.querySelector('.m-body').innerHTML = `<p>برای شارژ، <b>دقیقاً این مبلغ</b> را از طریق صفحهٔ پرداخت کارت‌به‌کارت واریز کنید (ارقام آخر مبلغ برای شناسایی پرداخت شماست):</p>
        <div class="wl-pay num">${faNum(Math.round(r.pay_amount_rial / 10))} تومان</div>
        <p class="muted">پس از تأیید خودکار واریز، ${faNum((r.topup.amount_rial + r.topup.bonus_rial) / 10)} تومان اعتبار (شامل ${faNum(r.topup.bonus_rial / 10)} تومان هدیه) به کیف پول اضافه می‌شود. این لینک ۳۰ دقیقه اعتبار دارد.</p>
        <div class="code ltr" style="word-break:break-all">${esc(r.pay_url)}</div>`;
      m.el.querySelector('.modal-actions').innerHTML = `<button class="btn" type="button" id="tp-copy">کپی لینک</button><a class="btn btn-primary" href="${esc(r.pay_path)}" target="_blank" rel="noopener">رفتن به صفحهٔ پرداخت</a><button class="btn btn-ghost" type="button" data-close>بستن</button>`;
      m.el.querySelector('#tp-copy').addEventListener('click', (e) => copy(r.pay_url, e.currentTarget));
      m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) done(); }, { once: true });
    } catch (e) { err.textContent = e.body?.errors?.amount || e.message; setBusy(btn, false); }
  });
}
