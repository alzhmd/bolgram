// "My review": one editable service rating per store, moderated by the platform owner.
import { api, esc, toFa, toast, setBusy, jDate, ApiError, useStyle, $, $$ } from '../core.js';

const LABELS = ['', 'ضعیف', 'نیاز به بهبود', 'متوسط', 'خوب', 'عالی'];
const STATUS = { pending: ['در انتظار بررسی', 'warn', 'نظر شما پس از بررسی تیم بولگرام در سایت نمایش داده می‌شود.'], approved: ['تأیید و منتشر شد', 'ok', 'نظر شما در بخش نظرات مشتریان بولگرام نمایش داده می‌شود.'], hidden: ['منتشر نمی‌شود', 'bad', 'این نظر در سایت نمایش داده نمی‌شود. برای پیگیری می‌توانید از بخش پشتیبانی تیکت بزنید.'] };
const MAX = 1000;
const CSS = `
.rv-wrap{max-width:720px;display:grid;gap:16px}
.rv-stars{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.rv-stars .stars button{padding:2px;line-height:1;border-radius:8px;transition:transform .12s}
.rv-stars .stars button:hover{transform:scale(1.12)}
.rv-stars .stars button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.rv-stars .stars [data-on="true"]{color:var(--amber)}
.rv-count{font-size:.8rem;color:var(--muted)}.rv-count.over{color:var(--red)}
.rv-reply{border-inline-start:3px solid var(--brand);padding:8px 12px;background:var(--brand-soft);border-radius:8px}
.rv-reply b{display:block;font-size:.85rem;margin-bottom:2px}
`;

export async function render(page) {
  useStyle('review', CSS);
  page.innerHTML = `<div class="page-head"><h1>نظر من</h1></div><p class="muted">در حال بارگذاری…</p>`;
  let review;
  try { review = (await api('/api/v2/review')).review; } catch (e) { page.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  let rating = review?.rating || 0;

  const draw = () => {
    const st = review && STATUS[review.status];
    page.innerHTML = `<div class="page-head"><h1>نظر من</h1></div><div class="rv-wrap">
      <p class="muted" style="margin:0">تجربهٔ شما از کار با بولگرام برای ما و فروشندگان دیگر ارزشمند است. نظر هر فروشگاه فقط یک‌بار ثبت می‌شود و هر زمان می‌توانید آن را ویرایش کنید.</p>
      ${review ? `<section class="card"><div class="card-head"><h3>وضعیت نظر شما</h3><span class="pill ${st[1]}">${st[0]}</span></div><p class="muted" style="margin:0">${st[2]}</p>
        ${review.reply ? `<div class="rv-reply" style="margin-top:12px"><b>پاسخ بولگرام</b><span style="white-space:pre-wrap">${esc(review.reply)}</span></div>` : ''}
        <p class="muted" style="margin:10px 0 0;font-size:.8rem">آخرین ویرایش: ${jDate(review.updated_at)}</p></section>` : ''}
      <form class="card" id="rv-form" novalidate>
        <div class="field"><span id="rv-lbl" style="font-weight:600;font-size:.92rem">امتیاز شما به بولگرام</span>
          <div class="rv-stars"><div class="stars" role="radiogroup" aria-labelledby="rv-lbl">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-n="${n}" aria-checked="${rating === n}" data-on="${n <= rating}" aria-label="${toFa(n)} از ۵ — ${LABELS[n]}" tabindex="${(rating || 1) === n ? 0 : -1}">★</button>`).join('')}</div>
          <span id="rv-label" class="muted" aria-live="polite">${rating ? LABELS[rating] : 'امتیاز را انتخاب کنید'}</span></div>
          <div class="err" data-err="rating"></div></div>
        <div class="field"><label for="rv-text">نظر شما</label><textarea id="rv-text" class="input" rows="6" maxlength="${MAX + 200}" placeholder="مثلاً: چطور از بولگرام استفاده می‌کنید و چه چیزی برایتان مفید بود؟">${esc(review?.text || '')}</textarea>
          <div style="display:flex;justify-content:space-between;gap:8px"><div class="err" data-err="text"></div><span class="rv-count" id="rv-count" aria-live="polite"></span></div></div>
        <label class="check"><input type="checkbox" id="rv-show" ${review && !review.show_name ? '' : 'checked'}> نام فروشگاه من کنار نظر نمایش داده شود <span class="muted">(در غیر این صورت نام کاربری به‌صورت ناقص نمایش داده می‌شود)</span></label>
        <div style="margin-top:14px"><button class="btn btn-primary" type="submit">${review ? 'ذخیرهٔ ویرایش' : 'ثبت نظر'}</button></div>
      </form></div>`;
    const stars = $$('.stars button', page);
    const paint = () => {
      stars.forEach((b) => { const n = Number(b.dataset.n); b.dataset.on = String(n <= rating); b.setAttribute('aria-checked', String(n === rating)); b.tabIndex = (rating || 1) === n ? 0 : -1; });
      $('#rv-label', page).textContent = rating ? LABELS[rating] : 'امتیاز را انتخاب کنید';
    };
    stars.forEach((b) => {
      b.addEventListener('click', () => { rating = Number(b.dataset.n); paint(); });
      b.addEventListener('keydown', (e) => {
        // the stars are laid out left-to-right (direction:ltr), so ArrowRight = more
        const k = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (k) { e.preventDefault(); rating = Math.min(5, Math.max(1, (rating || 0) + k)); paint(); stars[rating - 1].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); rating = 1; paint(); stars[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); rating = 5; paint(); stars[4].focus(); }
        else if (/^[1-5]$/.test(e.key)) { rating = Number(e.key); paint(); stars[rating - 1].focus(); }
      });
    });
    const ta = $('#rv-text', page), cnt = $('#rv-count', page);
    const count = () => { const n = ta.value.trim().length; cnt.textContent = `${toFa(n)} / ${toFa(MAX)}`; cnt.classList.toggle('over', n > MAX); };
    ta.addEventListener('input', count); count();
    $('#rv-form', page).addEventListener('submit', async (e) => {
      e.preventDefault();
      $$('[data-err]', page).forEach((x) => (x.textContent = ''));
      const btn = $('button[type=submit]', page);
      setBusy(btn, true, 'در حال ذخیره…');
      try {
        const r = await api('/api/v2/review', { method: 'PUT', body: { rating, text: ta.value, show_name: $('#rv-show', page).checked } });
        review = r.review;
        toast('نظر شما ذخیره شد و پس از بررسی نمایش داده می‌شود', 'ok');
        draw();
        window.scrollTo({ top: 0 });
      } catch (err) {
        setBusy(btn, false);
        if (err instanceof ApiError && err.body?.errors) for (const [k, v] of Object.entries(err.body.errors)) { const el = $(`[data-err="${k}"]`, page); if (el) el.textContent = v; }
        toast(err.message || 'ذخیره انجام نشد', 'err');
      }
    });
  };
  draw();
}
