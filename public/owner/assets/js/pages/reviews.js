import { faNum, jDate, esc, emptyState, toast, modal, setBusy, useStyle, pager, $, $$ } from '/panel/assets/js/core.js';
import { oapi, qs, errText, showError, head, pill, stars, storeLink, field, showErrors } from '../ui.js';

useStyle('o-reviews', `
.orv-list{display:grid;gap:12px}
.orv{display:grid;gap:8px}
.orv blockquote{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.orv .reply{border-inline-start:3px solid var(--brand);padding-inline-start:10px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}
.orv .acts{display:flex;gap:8px;flex-wrap:wrap}
`);

const STATUS = { pending: ['در انتظار بررسی', 'warn'], approved: ['منتشرشده', 'ok'], hidden: ['پنهان', ''] };
const st = { status: 'pending', page: 1 };

export async function render(page) {
  page.innerHTML = `${head('نظرها')}<p class="muted" style="margin:0">فقط نظرهای «منتشرشده» در سایت نمایش داده می‌شوند. نظرِ تازه تا زمانی که تأیید نکنید پنهان می‌ماند.</p>
    <div class="seg" role="group" aria-label="وضعیت" id="rv-f" style="align-self:flex-start"></div><div id="rv-list" aria-live="polite"></div>`;
  const list = $('#rv-list', page), seg = $('#rv-f', page);
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/reviews${qs({ status: st.status, page: st.page, per_page: 20 })}`); } catch (e) { return showError(list, e, load); }
    seg.innerHTML = [['pending', 'در انتظار'], ['approved', 'منتشرشده'], ['hidden', 'پنهان']].map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${st.status === v}">${t} (${faNum(r.counts[v] || 0)})</button>`).join('');
    $$('[data-f]', seg).forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; st.page = 1; load(); }));
    list.innerHTML = r.data.length ? `<div class="orv-list">${r.data.map((v) => `<article class="card orv" data-id="${esc(v.id)}">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${stars(v.rating)} ${pill(STATUS, v.status)}<span class="muted" style="font-size:.82rem;margin-inline-start:auto">${jDate(v.updated_at || v.created_at)}</span></div>
        <div>${v.store ? `${storeLink(v.store.id, v.store.name || v.store.handle)} <span class="muted ltr" style="font-size:.8rem">@${esc(v.store.handle || '')}</span>` : ''} <span class="muted" style="font-size:.8rem">· ${v.show_name ? 'نام فروشگاه نمایش داده می‌شود' : 'نام پنهان (آیدی ماسک‌شده)'}</span></div>
        <blockquote>${esc(v.text)}</blockquote>
        ${v.reply ? `<div class="reply"><b>پاسخ بولگرام:</b> ${esc(v.reply)}</div>` : ''}
        <div class="acts">${v.status !== 'approved' ? `<button class="btn btn-sm btn-green" type="button" data-st="approved">انتشار</button>` : ''}${v.status !== 'hidden' ? `<button class="btn btn-sm" type="button" data-st="hidden">پنهان‌کردن</button>` : ''}<button class="btn btn-sm" type="button" data-reply>${v.reply ? 'ویرایش پاسخ' : 'پاسخ'}</button></div></article>`).join('')}</div>` : `<div class="card">${emptyState('star', 'نظری نیست', st.status === 'pending' ? 'نظر بررسی‌نشده‌ای وجود ندارد.' : 'در این بخش نظری نیست.')}</div>`;
    list.appendChild(pager(r, (p) => { st.page = p; load(); }));
    const byId = Object.fromEntries(r.data.map((v) => [v.id, v]));
    $$('.orv', list).forEach((card) => {
      const v = byId[card.dataset.id];
      $$('[data-st]', card).forEach((b) => b.addEventListener('click', async () => {
        setBusy(b, true);
        try { await oapi(`/api/owner/reviews/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: { status: b.dataset.st } }); toast(b.dataset.st === 'approved' ? 'نظر منتشر شد' : 'نظر پنهان شد', 'ok'); load(); }
        catch (e) { setBusy(b, false); toast(errText(e), 'err'); }
      }));
      $('[data-reply]', card).addEventListener('click', () => {
        const m = modal({
          title: 'پاسخ به نظر',
          body: `<form id="rv-form" novalidate>${field('reply', 'پاسخ شما (در سایت زیر نظر نمایش داده می‌شود)', `<textarea class="input" id="f-reply" name="reply" rows="4" maxlength="1000">${esc(v.reply || '')}</textarea>`, 'خالی‌گذاشتن، پاسخ قبلی را حذف می‌کند')}</form>`,
          actions: '<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-primary" type="button" id="rv-ok">ذخیرهٔ پاسخ</button>',
        });
        $('#rv-ok', m.el).addEventListener('click', async (e) => {
          setBusy(e.target.closest('button'), true);
          try { await oapi(`/api/owner/reviews/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: { reply: $('#f-reply', m.el).value.trim() || null } }); m.close(); toast('پاسخ ذخیره شد', 'ok'); load(); }
          catch (err) { setBusy(e.target.closest('button'), false); showErrors(m.el, err.body?.errors || { reply: errText(err) }); }
        });
      });
    });
  };
  await load();
}
