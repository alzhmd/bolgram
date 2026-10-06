import { esc, toast, setBusy, useStyle, debounce, $, $$ } from '/panel/assets/js/core.js';
import { oapi, qs, errText, showError, head, field, showErrors, clearErrors } from '../ui.js';

useStyle('o-billing', `
.ob-grid{display:grid;gap:0 14px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:760px){.ob-grid{grid-template-columns:1fr}}
.ob-tier{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:start;margin-bottom:8px}
.ob-pick{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.ob-cur{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
`);

const toLatin = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬\s]/g, '');
const intOf = (s) => (toLatin(s) === '' ? NaN : Number(toLatin(s)));

export async function render(page) {
  let r;
  const load = async () => {
    try { r = await oapi('/api/owner/billing/settings'); } catch (e) { return showError(page, e, load); }
    draw();
  };
  const draw = () => {
    const s = r.settings;
    let platform = r.platform_merchant;
    let platformId = s.platform_merchant_id || '';
    const tiers = s.bonus_tiers.map((t) => ({ ...t }));
    page.innerHTML = `${head('تنظیمات مالی')}
      <form id="bl-form" class="grid" novalidate>
        <section class="card"><div class="card-head"><h3>فروشگاه پلتفرم</h3></div>
          <p class="muted" style="margin-top:0">پولِ شارژ کیف پول و خرید پلن مستقیم به کارت‌های همین فروشگاه واریز می‌شود. فروشگاهی را انتخاب کنید که کارت فعال دارد و متعلق به خود شماست.</p>
          <div id="bl-cur" class="ob-cur"></div>
          ${field('platform_merchant_id', 'جستجوی فروشگاه', '<input class="input" id="f-platform_merchant_id" name="platform_merchant_id" type="search" placeholder="نام، آیدی یا موبایل فروشگاه" autocomplete="off">')}
          <div id="bl-pick" class="ob-pick" aria-live="polite"></div></section>
        <section class="card"><div class="card-head"><h3>شارژ کیف پول</h3></div><div class="ob-grid">
          ${field('topup_min_toman', 'حداقل مبلغ شارژ (تومان)', `<input class="input num ltr" id="f-topup_min_toman" name="topup_min_toman" value="${esc(s.topup_min_toman)}" inputmode="numeric" autocomplete="off">`)}
          ${field('low_balance_toman', 'هشدار کمبود موجودی از (تومان)', `<input class="input num ltr" id="f-low_balance_toman" name="low_balance_toman" value="${esc(s.low_balance_toman)}" inputmode="numeric" autocomplete="off">`, 'زیر این مقدار، به فروشنده اعلان داده می‌شود')}
        </div>
          <h3 style="margin:6px 0">هدیهٔ شارژ (پله‌ها)</h3>
          <p class="muted" style="margin-top:0;font-size:.86rem">اگر شارژ از حداقل هر پله بیشتر باشد، درصد همان پله به‌عنوان هدیه به کیف پول اضافه می‌شود.</p>
          <div id="bl-tiers"></div><span class="err" data-err="bonus_tiers" role="alert" style="color:var(--red);font-size:.82rem"></span>
          <button class="btn btn-sm" type="button" id="bl-addtier" style="margin-top:6px">افزودن پله</button></section>
        <section class="card"><div class="card-head"><h3>دعوت دوستان</h3></div><div class="ob-grid">
          ${field('referral_percent', 'پاداش دعوت‌کننده (٪ از شارژ دعوت‌شده)', `<input class="input num ltr" id="f-referral_percent" name="referral_percent" value="${esc(s.referral_percent)}" inputmode="decimal" autocomplete="off">`, 'بین ۰ تا ۵۰')}
          ${field('referral_months', 'مدت پاداش (ماه)', `<input class="input num ltr" id="f-referral_months" name="referral_months" value="${esc(s.referral_months)}" inputmode="numeric" autocomplete="off">`)}
          ${field('referral_signup_bonus_toman', 'هدیهٔ عضویت (تومان)', `<input class="input num ltr" id="f-referral_signup_bonus_toman" name="referral_signup_bonus_toman" value="${esc(s.referral_signup_bonus_toman)}" inputmode="numeric" autocomplete="off">`, '۰ یعنی بدون هدیه')}
        </div></section>
        <div><button class="btn btn-primary" type="submit" id="bl-save">ذخیرهٔ تنظیمات</button></div>
      </form>`;
    const form = $('#bl-form', page);
    const curEl = $('#bl-cur', page), pick = $('#bl-pick', page), tierEl = $('#bl-tiers', page);
    const drawCur = () => {
      curEl.innerHTML = platform
        ? `<span><b>${esc(platform.name || platform.handle)}</b> <span class="muted ltr">@${esc(platform.handle)}</span></span>${platform.has_active_card ? '<span class="pill ok">کارت فعال دارد</span>' : '<span class="pill bad">کارت فعال ندارد</span>'}<button class="btn btn-sm btn-ghost" type="button" id="bl-clear">برداشتن انتخاب</button>`
        : '<span class="pill warn">هنوز انتخاب نشده؛ شارژ کیف پول و خرید پلن کار نمی‌کند</span>';
      $('#bl-clear', curEl)?.addEventListener('click', () => { platform = null; platformId = ''; drawCur(); });
    };
    drawCur();
    const drawTiers = () => {
      tierEl.innerHTML = tiers.length ? tiers.map((t, i) => `<div class="ob-tier"><div><label class="sr-only" for="tm-${i}">حداقل شارژ</label><input class="input num ltr" id="tm-${i}" data-tm="${i}" value="${esc(t.min_toman)}" inputmode="numeric" placeholder="حداقل شارژ (تومان)" autocomplete="off"></div><div><label class="sr-only" for="tp-${i}">درصد</label><input class="input num ltr" id="tp-${i}" data-tp="${i}" value="${esc(t.percent)}" inputmode="decimal" placeholder="درصد هدیه" autocomplete="off"></div><button class="icon-btn" type="button" data-rm="${i}" aria-label="حذف پله">✕</button></div>`).join('') : '<p class="muted">بدون پله؛ هدیهٔ شارژ نداریم.</p>';
      $$('[data-tm]', tierEl).forEach((x) => x.addEventListener('input', () => { tiers[+x.dataset.tm].min_toman = x.value; }));
      $$('[data-tp]', tierEl).forEach((x) => x.addEventListener('input', () => { tiers[+x.dataset.tp].percent = x.value; }));
      $$('[data-rm]', tierEl).forEach((x) => x.addEventListener('click', () => { tiers.splice(+x.dataset.rm, 1); drawTiers(); }));
    };
    drawTiers();
    $('#bl-addtier', page).addEventListener('click', () => { if (tiers.length >= 10) return toast('حداکثر ۱۰ پله مجاز است', 'err'); tiers.push({ min_toman: '', percent: '' }); drawTiers(); $$('[data-tm]', tierEl).pop()?.focus(); });
    $('#f-platform_merchant_id', page).addEventListener('input', debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) { pick.innerHTML = ''; return; }
      try {
        const res = await oapi(`/api/owner/merchants${qs({ q, per_page: 8 })}`);
        pick.innerHTML = res.data.length ? res.data.map((m) => `<button class="chip" type="button" data-pick="${esc(m.id)}">${esc(m.name || m.handle)} <span class="ltr">@${esc(m.handle || '')}</span></button>`).join('') : '<span class="muted">فروشگاهی پیدا نشد</span>';
        $$('[data-pick]', pick).forEach((b) => b.addEventListener('click', () => {
          const m = res.data.find((x) => x.id === b.dataset.pick);
          platformId = m.id; platform = { id: m.id, handle: m.handle, name: m.name, has_active_card: m.cards_count > 0 };
          pick.innerHTML = ''; e.target.value = ''; drawCur();
        }));
      } catch (err) { pick.innerHTML = `<span class="muted">${esc(errText(err))}</span>`; }
    }, 300));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const btn = $('#bl-save', page);
      const f = form.elements;
      const body = {
        platform_merchant_id: platformId,
        topup_min_toman: intOf(f.topup_min_toman.value), low_balance_toman: intOf(f.low_balance_toman.value),
        referral_percent: Number(toLatin(f.referral_percent.value)), referral_months: intOf(f.referral_months.value), referral_signup_bonus_toman: intOf(f.referral_signup_bonus_toman.value),
        bonus_tiers: tiers.map((t) => ({ min_toman: intOf(String(t.min_toman)), percent: Number(toLatin(String(t.percent))) })),
      };
      setBusy(btn, true);
      try {
        r = await oapi('/api/owner/billing/settings', { method: 'PUT', body });
        toast('تنظیمات ذخیره شد', 'ok');
        draw();
      } catch (err) {
        setBusy(btn, false);
        const orphan = showErrors(form, err.body?.errors || {});
        toast(orphan[0] || errText(err), 'err');
      }
    });
  };
  await load();
}
