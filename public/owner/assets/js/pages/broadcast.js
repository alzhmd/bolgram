import { faNum, toFa, jDateTime, esc, emptyState, toast, confirmDialog, setBusy, useStyle, debounce, table, pager, $, $$ } from '/panel/assets/js/core.js';
import { oapi, qs, errText, showError, head, field, showErrors, clearErrors } from '../ui.js';

useStyle('o-bc', `
.obc-wrap{display:grid;gap:16px;grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
@media (max-width:900px){.obc-wrap{grid-template-columns:1fr}}
.obc-prev{border:1px solid var(--border);border-radius:14px;padding:12px 14px;background:var(--surface-2);display:grid;gap:4px;border-inline-start-width:4px}
.obc-prev.info{border-inline-start-color:var(--brand)}.obc-prev.success{border-inline-start-color:var(--green)}.obc-prev.warning{border-inline-start-color:var(--amber)}.obc-prev.danger{border-inline-start-color:var(--red)}
.obc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
`);

const LEVELS = [['info', 'اطلاع‌رسانی'], ['success', 'خبر خوب'], ['warning', 'هشدار'], ['danger', 'مهم و فوری']];
const LINKS = [['', 'بدون لینک'], ['#/dashboard', 'داشبورد'], ['#/wallet', 'کیف پول'], ['#/plans', 'اشتراک و پلن‌ها'], ['#/devices', 'دستگاه‌ها'], ['#/app', 'اپلیکیشن'], ['#/support', 'پشتیبانی'], ['#/trust', 'نماد اعتماد'], ['#/settings', 'تنظیمات']];
let hpage = 1;

export async function render(page) {
  let picked = []; // { id, name, handle }
  page.innerHTML = `${head('اعلان همگانی')}
    <div class="obc-wrap">
      <form class="card" id="bc-form" novalidate>
        <div class="card-head"><h3>اعلان جدید</h3></div>
        ${field('title', 'عنوان', '<input class="input" id="f-title" name="title" maxlength="120" autocomplete="off">', '۳ تا ۱۲۰ نویسه')}
        ${field('body', 'متن پیام', '<textarea class="input" id="f-body" name="body" rows="4" maxlength="600"></textarea>', 'حداکثر ۶۰۰ نویسه')}
        <div class="grid g2" style="gap:0 14px">
          ${field('level', 'نوع', `<select class="input select" id="f-level" name="level">${LEVELS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`)}
          ${field('href', 'لینک دکمه (اختیاری)', `<select class="input select" id="f-href" name="href">${LINKS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`)}
        </div>
        <fieldset style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:600;font-size:.92rem;margin-bottom:6px">مخاطبان</legend>
          <div class="seg" role="group" aria-label="مخاطبان"><button type="button" data-aud="all" aria-pressed="true">همهٔ فروشگاه‌ها</button><button type="button" data-aud="some" aria-pressed="false">فروشگاه‌های انتخابی</button></div>
          <div id="bc-pick" class="hidden" style="margin-top:10px"><label class="sr-only" for="bc-q">جستجوی فروشگاه</label><input class="input" id="bc-q" type="search" placeholder="جستجوی فروشگاه برای افزودن" autocomplete="off"><div id="bc-res" class="obc-chips" aria-live="polite"></div><div id="bc-sel" class="obc-chips"></div></div>
          <span class="err" data-err="merchant_ids" role="alert" style="color:var(--red);font-size:.82rem"></span></fieldset>
        <button class="btn btn-primary" type="submit" id="bc-send">ارسال اعلان</button>
      </form>
      <section class="card"><div class="card-head"><h3>پیش‌نمایش در پنل فروشنده</h3></div><div id="bc-prev" class="obc-prev info" aria-live="polite"></div>
        <p class="muted" style="font-size:.84rem">اعلان در «اعلان‌ها»ی پنل هر فروشگاه ظاهر می‌شود و قابل پس‌گرفتن نیست؛ پیش از ارسال متن را دوباره بخوانید.</p></section>
    </div>
    <section class="card"><div class="card-head"><h3>اعلان‌های ارسال‌شده</h3></div><div id="bc-hist" aria-live="polite"></div></section>`;
  const form = $('#bc-form', page);
  let all = true;
  const prev = () => {
    const f = form.elements, t = f.title.value.trim(), b = f.body.value.trim();
    const el = $('#bc-prev', page);
    el.className = `obc-prev ${f.level.value}`;
    el.innerHTML = t || b ? `<b>${esc(t || 'عنوان اعلان')}</b><span>${esc(b)}</span>${f.href.value ? `<span class="muted" style="font-size:.8rem">دکمه: ${esc(LINKS.find(([v]) => v === f.href.value)?.[1] || '')}</span>` : ''}` : '<span class="muted">عنوان و متن را بنویسید.</span>';
  };
  form.addEventListener('input', prev); prev();
  $$('[data-aud]', form).forEach((b) => b.addEventListener('click', () => {
    all = b.dataset.aud === 'all';
    $$('[data-aud]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#bc-pick', page).classList.toggle('hidden', all);
  }));
  const drawSel = () => {
    $('#bc-sel', page).innerHTML = picked.map((s) => `<span class="chip on">${esc(s.name || s.handle)} <button type="button" data-rm="${esc(s.id)}" aria-label="حذف ${esc(s.name || s.handle)}" style="background:none;border:0;color:inherit;cursor:pointer">✕</button></span>`).join('') || '<span class="muted">هنوز فروشگاهی انتخاب نشده</span>';
    $$('[data-rm]', page).forEach((b) => b.addEventListener('click', () => { picked = picked.filter((s) => s.id !== b.dataset.rm); drawSel(); }));
  };
  drawSel();
  $('#bc-q', page).addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim(), res = $('#bc-res', page);
    if (q.length < 2) { res.innerHTML = ''; return; }
    try {
      const r = await oapi(`/api/owner/merchants${qs({ q, per_page: 8 })}`);
      res.innerHTML = r.data.length ? r.data.map((m) => `<button class="chip" type="button" data-add="${esc(m.id)}">${esc(m.name || m.handle)} <span class="ltr">@${esc(m.handle || '')}</span></button>`).join('') : '<span class="muted">فروشگاهی پیدا نشد</span>';
      $$('[data-add]', res).forEach((b) => b.addEventListener('click', () => {
        const m = r.data.find((x) => x.id === b.dataset.add);
        if (!picked.some((s) => s.id === m.id)) picked.push({ id: m.id, name: m.name, handle: m.handle });
        drawSel();
      }));
    } catch (err) { res.innerHTML = `<span class="muted">${esc(errText(err))}</span>`; }
  }, 300));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const f = form.elements;
    const body = { title: f.title.value.trim(), body: f.body.value.trim(), level: f.level.value, ...(f.href.value ? { href: f.href.value } : {}) };
    const errors = {};
    if (body.title.length < 3) errors.title = 'عنوان را بنویسید (حداقل ۳ نویسه)';
    if (!body.body) errors.body = 'متن پیام را بنویسید';
    if (!all) { if (!picked.length) errors.merchant_ids = 'حداقل یک فروشگاه را انتخاب کنید'; else body.merchant_ids = picked.map((s) => s.id); }
    if (Object.keys(errors).length) return showErrors(form, errors);
    let count = picked.length;
    if (all) { try { count = (await oapi('/api/owner/merchants?per_page=1')).total; } catch { count = 0; } }
    const text = all ? `این اعلان برای همهٔ فروشگاه‌ها${count ? ` (${faNum(count)} فروشگاه)` : ''} ارسال می‌شود.` : `این اعلان برای ${faNum(count)} فروشگاه انتخابی ارسال می‌شود.`;
    if (!(await confirmDialog('ارسال اعلان', `${text} پس از ارسال، پس‌گرفتن آن ممکن نیست.`, 'ارسال'))) return;
    const btn = $('#bc-send', page);
    setBusy(btn, true, 'در حال ارسال…');
    try {
      const r = await oapi('/api/owner/notifications/broadcast', { method: 'POST', body });
      toast(`اعلان برای ${faNum(r.delivered)} فروشگاه ارسال شد`, 'ok');
      form.reset(); picked = []; drawSel(); prev(); hpage = 1; loadHist();
    } catch (err) {
      const orphan = showErrors(form, err.body?.errors || {});
      if (orphan.length || !err.body?.errors) toast(errText(err), 'err');
    } finally { setBusy(btn, false); }
  });
  const hist = $('#bc-hist', page);
  const loadHist = async () => {
    hist.innerHTML = '<span class="spinner"></span> در حال بارگذاری…';
    let r;
    try { r = await oapi(`/api/owner/notifications/broadcasts${qs({ page: hpage, per_page: 10 })}`); } catch (e) { return showError(hist, e, loadHist); }
    hist.innerHTML = r.data.length ? table([
      { title: 'عنوان', render: (b) => `<b>${esc(b.title)}</b><br><span class="muted" style="font-size:.8rem">${esc(b.body)}</span>` },
      { title: 'مخاطب', render: (b) => (b.all_stores ? 'همهٔ فروشگاه‌ها' : 'انتخابی') },
      { title: 'تحویل', cls: 'num', render: (b) => faNum(b.delivered) },
      { title: 'خوانده‌شده', cls: 'num', render: (b) => `${faNum(b.read_count)}${b.delivered ? ` (${toFa(Math.round((b.read_count / b.delivered) * 100))}٪)` : ''}` },
      { title: 'ارسال', cls: 'nowrap', render: (b) => `${jDateTime(b.created_at)}<br><span class="muted ltr" style="font-size:.78rem">${esc(b.created_by || '')}</span>` },
    ], r.data) : emptyState('bell', 'هنوز اعلانی ارسال نشده', 'اولین اعلان همگانی را از فرم بالا بفرستید.');
    if (r.data.length) hist.appendChild(pager(r, (p) => { hpage = p; loadHist(); }));
  };
  await loadHist();
}
