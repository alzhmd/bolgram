import { api, toFa, toLatin, fixArabic, luhn, esc, modal, toast, confirmDialog, setBusy, emptyState, ICON, $, $$ } from '../core.js';

let banks = null;
async function loadBanks() {
  if (!banks) banks = (await api('/api/v2/banks')).data;
  return banks;
}
const bankOf = (num) => banks?.find((b) => b.bins.includes(num.slice(0, 6))) || null;

export async function renderCards(page) {
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const [{ data }] = await Promise.all([api('/api/v2/cards'), loadBanks()]);
  const name = (id) => banks.find((b) => b.id === id)?.name || id;
  page.innerHTML = `
    <div class="page-head"><h1>کارت‌ها</h1><div class="actions"><button class="btn btn-primary" type="button" id="add-card">${ICON.plus} افزودن کارت</button></div></div>
    <p class="muted" style="margin:0">شمارهٔ کامل کارت رمزنگاری‌شده ذخیره می‌شود و در پنل هرگز نمایش داده نمی‌شود؛ فقط ۴ رقم آخر. بدون کارت فعال، فاکتور ساخته نمی‌شود.</p>
    <section class="card"><div class="card-head"><h3>کارت‌های این فروشگاه</h3><span class="muted" style="margin-inline-start:auto;font-size:.85rem">سقف روزانهٔ کارت‌به‌کارت هر کارت حدود ۱۵ میلیون تومان است.</span></div>
      ${data.length ? `<ul class="list">${data.map((c) => `<li data-id="${esc(c.id)}">
          <span class="ico" style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand)">${ICON.card}</span>
          <div style="flex:1;min-width:0"><b>${esc(c.title || name(c.bank))}</b><div class="muted" style="font-size:.85rem">${esc(name(c.bank))} · <span class="ltr num">•••• ${toFa(c.last4)}</span> · ${esc(c.holder || '')}</div></div>
          <span class="pill ${c.active ? 'ok' : ''}">${c.active ? 'فعال' : 'غیرفعال'}</span>
          <label class="check" style="margin:0"><input type="checkbox" data-toggle ${c.active ? 'checked' : ''} aria-label="فعال بودن کارت"></label>
          <button class="btn btn-sm btn-danger" type="button" data-del>حذف</button></li>`).join('')}</ul>`
        : emptyState('card', 'هنوز کارتی ثبت نکرده‌اید', 'اولین کارت بانکی را اضافه کنید تا مشتری بتواند به آن واریز کند.', '<button class="btn btn-primary" type="button" data-add>افزودن کارت</button>')}
    </section>
    <section class="card"><div class="card-head"><h3>چرخش کارت‌ها</h3><span class="pill">به‌زودی</span></div><p class="muted" style="margin:0">پخش فاکتورها بین کارت‌ها یا پر کردن یک کارت تا سقف و رفتن سراغ کارت بعدی در مرحلهٔ بعد فعال می‌شود. فعلاً اگر کارت هم‌بانک با مشتری داشته باشید، همان نمایش داده می‌شود.</p></section>`;

  const reload = () => renderCards(page);
  $$('#add-card, [data-add]', page).forEach((b) => b.addEventListener('click', () => addCard(reload)));
  $$('[data-toggle]', page).forEach((inp) => inp.addEventListener('change', async () => {
    const id = inp.closest('li').dataset.id;
    try { await api(`/api/v2/cards/${id}`, { method: 'PATCH', body: { active: inp.checked } }); toast(inp.checked ? 'کارت فعال شد' : 'کارت غیرفعال شد', 'ok'); reload(); }
    catch (e) { inp.checked = !inp.checked; toast(e.message, 'err'); }
  }));
  $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('li').dataset.id;
    const last = data.filter((c) => c.active).length <= 1;
    const ok = await confirmDialog('حذف کارت', last ? 'این آخرین کارت فعال شماست؛ بعد از حذف، فاکتور جدید ساخته نمی‌شود. مطمئن هستید؟' : 'این کارت حذف شود؟', 'حذف کارت', true);
    if (!ok) return;
    try { await api(`/api/v2/cards/${id}`, { method: 'DELETE' }); toast('کارت حذف شد', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  }));
}

function addCard(done) {
  const m = modal({
    title: 'افزودن کارت',
    body: `<form id="ac" novalidate>
      <div class="field"><label for="ac-num">شمارهٔ کارت</label><input class="input ltr num" id="ac-num" inputmode="numeric" autocomplete="cc-number" placeholder="۶۰۳۷-۹۹۷۵-۰۰۰۰-۰۰۰۰" maxlength="23"><div class="hint" id="ac-bank" aria-live="polite"></div><div class="err" id="ac-num-err" role="alert"></div></div>
      <div class="field"><label for="ac-holder">نام صاحب کارت</label><input class="input" id="ac-holder" autocomplete="cc-name" maxlength="80"><div class="err" id="ac-holder-err" role="alert"></div></div>
      <div class="field"><label for="ac-label">برچسب (اختیاری)</label><input class="input" id="ac-label" maxlength="40" placeholder="مثلاً کارت اصلی"></div>
      <button class="btn btn-primary btn-block" type="submit">ثبت کارت</button></form>`,
  });
  const f = $('#ac', m.el), num = $('#ac-num', m.el), bankHint = $('#ac-bank', m.el);
  const digits = () => toLatin(num.value).replace(/\D/g, '').slice(0, 16);
  num.addEventListener('input', () => {
    const d = digits();
    num.value = toFa(d.replace(/(\d{4})(?=\d)/g, '$1-'));
    const b = d.length >= 6 ? bankOf(d) : null;
    bankHint.textContent = d.length >= 6 ? (b ? `بانک ${b.name}` : 'بانک این کارت شناخته نشد') : '';
  });
  const setErr = (id, msg) => { $(`#${id}-err`, m.el).textContent = msg; $(`#${id}`, m.el).setAttribute('aria-invalid', msg ? 'true' : 'false'); return !msg; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = digits();
    let ok = setErr('ac-num', luhn(d) ? (bankOf(d) ? '' : 'بانک این کارت شناخته نشد') : 'شمارهٔ کارت معتبر نیست (۱۶ رقم)');
    const holder = fixArabic($('#ac-holder', m.el).value.trim());
    ok = setErr('ac-holder', holder.length >= 3 ? '' : 'نام صاحب کارت را وارد کنید') && ok;
    if (!ok) return f.querySelector('[aria-invalid="true"]').focus();
    const btn = f.querySelector('[type="submit"]');
    setBusy(btn, true, 'در حال ثبت…');
    try {
      await api('/api/v2/cards', { method: 'POST', body: { number: d, holder, label: $('#ac-label', m.el).value } });
      m.close(); toast('کارت ثبت شد', 'ok'); done();
    } catch (er) {
      setBusy(btn, false);
      const errs = er.body?.errors || {};
      if (errs.number) setErr('ac-num', errs.number);
      if (errs.holder) setErr('ac-holder', errs.holder);
      if (!errs.number && !errs.holder) toast(er.message, 'err');
    }
  });
}
