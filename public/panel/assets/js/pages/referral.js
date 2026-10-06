import { api, esc, faNum, toFa, jDate, copy, table, useStyle, emptyState } from '../core.js';

useStyle('referral', `
.rf-link{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rf-link .code{flex:1 1 180px;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere}
.rf-share{display:flex;flex-wrap:wrap;gap:8px}
.rf-qr{width:160px;height:160px;border-radius:12px;background:#fff;padding:6px;flex:none}
.rf-qr svg{width:100%;height:100%;display:block}
.rf-top{display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.rf-top>div:first-child{flex:1 1 240px;min-width:0;display:grid;gap:12px}
`);

const STATUS = { active: ['ok', 'فعال و شارژکرده'], pending: ['warn', 'عضو شده، هنوز شارژ نکرده'], suspended: ['bad', 'تعلیق‌شده'] };

export async function render(page) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  let r, qr = '';
  try {
    [r, qr] = await Promise.all([api('/api/v2/referral'), api('/api/v2/referral/qr').then((x) => x.svg).catch(() => '')]);
  } catch (e) { page.innerHTML = `<div class="alert alert-err" role="alert">${esc(e.message)}</div>`; return; }
  const { rules, totals } = r;
  const text = 'با بولگرام پول فروشت رو مستقیم روی کارت خودت بگیر؛ بدون واسطه و با تأیید خودکار پرداخت. از این لینک ثبت‌نام کن:';
  const enc = encodeURIComponent;
  page.innerHTML = `
    <div class="page-head"><h1>دعوت دوستان</h1></div>
    <section class="card"><div class="rf-top"><div>
      <div><h3 style="margin:0 0 4px">لینک اختصاصی شما</h3><p class="muted" style="margin:0">هر فروشگاهی که با این لینک ثبت‌نام کند، دعوت‌شدهٔ شما حساب می‌شود. کد شما: <b class="ltr num">${esc(r.code)}</b></p></div>
      <div class="rf-link"><div class="code ltr" id="rf-url">${esc(r.link)}</div><button class="btn btn-primary" type="button" id="rf-copy">کپی لینک</button></div>
      <div class="rf-share"><a class="btn btn-sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${enc(r.link)}&text=${enc(text)}">تلگرام</a>
        <a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(text + ' ' + r.link)}">واتساپ</a>
        <a class="btn btn-sm" href="sms:?&body=${enc(text + ' ' + r.link)}">پیامک</a></div></div>
      ${qr ? `<div class="rf-qr" role="img" aria-label="کد QR لینک دعوت">${qr}</div>` : ''}</div></section>
    <div class="grid g3">
      <section class="card stat"><span>دعوت‌شده‌ها</span><b>${faNum(totals.referred)}</b></section>
      <section class="card stat"><span>فعال (حداقل یک شارژ)</span><b>${faNum(totals.active)}</b></section>
      <section class="card stat"><span>پاداش دریافتی</span><b>${faNum(totals.earned_toman)} <small>تومان</small></b></section></div>
    <section class="card"><div class="card-head"><h3>قوانین پاداش</h3></div>
      <ul class="list" style="gap:8px">
        ${rules.reward_percent > 0 ? `<li>هر بار که فروشگاه دعوت‌شده کیف پولش را شارژ کند، <b>${toFa(rules.reward_percent)}٪</b> مبلغ شارژ به‌عنوان پاداش به کیف پول شما اضافه می‌شود.</li><li>پاداش برای <b>${faNum(rules.reward_months)} ماه اول</b> عضویت هر فروشگاه دعوت‌شده پرداخت می‌شود.</li>` : '<li>پاداش درصدی فعلاً غیرفعال است.</li>'}
        ${rules.signup_bonus_toman > 0 ? `<li>دوستی که با لینک شما بیاید، <b>${faNum(rules.signup_bonus_toman)} تومان</b> هدیهٔ عضویت می‌گیرد.</li>` : ''}
        <li>پاداش به‌صورت اعتبار کیف پول است و از کارمزدهای شما کم می‌شود.</li></ul></section>
    <section class="card"><div class="card-head"><h3>فروشگاه‌های دعوت‌شده</h3></div>
      ${r.referred.length ? table([
        { key: 'handle_masked', title: 'فروشگاه', render: (x) => `<span class="ltr num">${esc(x.handle_masked)}</span>` },
        { key: 'joined_at', title: 'تاریخ عضویت', render: (x) => (x.joined_at ? jDate(x.joined_at) : '—') },
        { key: 'status', title: 'وضعیت', render: (x) => `<span class="pill ${STATUS[x.status][0]}">${STATUS[x.status][1]}</span>` },
        { key: 'topups', title: 'تعداد شارژ', render: (x) => faNum(x.topups) },
        { key: 'reward', title: 'پاداش شما (تومان)', render: (x) => `${faNum(x.reward_toman)}${x.in_reward_window ? '' : ' <span class="muted">(پایان بازه)</span>'}` },
      ], r.referred) : emptyState('gift', 'هنوز کسی را دعوت نکرده‌اید', 'لینک بالا را برای صاحبان فروشگاه‌های اینستاگرامی و تلگرامی بفرستید؛ بعد از ثبت‌نام آن‌ها اینجا می‌بینید.')}
    </section>`;
  page.querySelector('#rf-copy').addEventListener('click', (e) => copy(r.link, e.currentTarget));
}
