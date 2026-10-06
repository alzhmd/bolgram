import { faNum, esc, toast, setBusy, useStyle, fileToDataUrl, $, $$ } from '/panel/assets/js/core.js';
import { oapi, errText, showError, head, field, showErrors, clearErrors } from '../ui.js';

useStyle('o-site', `
.osi-grid{display:grid;gap:0 14px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:760px){.osi-grid{grid-template-columns:1fr}}
.osi-logo{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.osi-logo img{width:72px;height:72px;object-fit:contain;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);padding:6px}
.osi-faq{display:grid;gap:10px}
.osi-q{border:1px solid var(--border);border-radius:14px;padding:12px;display:grid;gap:4px;background:var(--surface-2)}
.osi-q .row{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.osi-save{position:sticky;bottom:12px;z-index:5;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:16px;padding:10px 14px}
`);

const MAX_LOGO = 1024 * 1024;

export async function render(page) {
  let r;
  try { r = await oapi('/api/owner/site'); } catch (e) { return showError(page, e, () => render(page)); }
  const s = r.site;
  let faq = s.faq.map((x) => ({ ...x }));
  let logoUrl = s.logo_url, logoData = null, removeLogo = false;
  const val = (n, v, attrs = '', ltr = false) => `<input class="input${ltr ? ' ltr' : ''}" id="f-${n}" name="${n}" value="${esc(v)}" ${attrs}>`;
  page.innerHTML = `${head('محتوای سایت')}
    <p class="muted" style="margin:0">متن‌های این صفحه روی سایت معرفی بولگرام (بیرون از پنل) نمایش داده می‌شود. تغییرها حداکثر تا یک دقیقه بعد در سایت دیده می‌شود؛ تا آن موقع متن پیش‌فرض سایت می‌ماند. متن‌ها فقط به‌صورت ساده نمایش داده می‌شوند (بدون HTML).</p>
    <form id="si-form" class="grid" novalidate>
      <section class="card"><div class="card-head"><h3>بالای صفحهٔ اصلی</h3></div>
        ${field('hero.title', 'عنوان اصلی', val('hero.title', s.hero.title, 'maxlength="120"'), 'خالی = متن پیش‌فرض سایت')}
        ${field('hero.subtitle', 'زیرعنوان', `<textarea class="input" id="f-hero.subtitle" name="hero.subtitle" rows="3" maxlength="400">${esc(s.hero.subtitle)}</textarea>`)}</section>
      <section class="card"><div class="card-head"><h3>نوار اعلان بالای سایت</h3></div>
        <label class="check" style="margin-bottom:12px"><input type="checkbox" name="announcement.active" ${s.announcement.active ? 'checked' : ''}><span>نمایش نوار اعلان</span></label>
        ${field('announcement.text', 'متن اعلان', val('announcement.text', s.announcement.text, 'maxlength="200"'))}
        ${field('announcement.href', 'لینک (اختیاری)', val('announcement.href', s.announcement.href, 'dir="ltr" maxlength="300" placeholder="/pricing.html یا https://…"', true), 'مسیر داخلی سایت یا آدرس https')}</section>
      <section class="card"><div class="card-head"><h3>اطلاعات تماس</h3></div><div class="osi-grid">
        ${field('contact.phone', 'تلفن', val('contact.phone', s.contact.phone, 'dir="ltr" maxlength="24"', true))}
        ${field('contact.email', 'ایمیل', val('contact.email', s.contact.email, 'dir="ltr" maxlength="120" type="email"', true))}
        ${field('contact.telegram', 'تلگرام', val('contact.telegram', s.contact.telegram, 'dir="ltr" maxlength="200" placeholder="@bolgram_support"', true), 'نام کاربری یا لینک t.me')}
        ${field('contact.instagram', 'اینستاگرام', val('contact.instagram', s.contact.instagram, 'dir="ltr" maxlength="200" placeholder="@bolgram"', true), 'نام کاربری یا لینک instagram.com')}</div>
        ${field('contact.address', 'نشانی', val('contact.address', s.contact.address, 'maxlength="300"'))}</section>
      <section class="card"><div class="card-head"><h3>لوگو</h3></div>
        <div class="osi-logo"><img id="si-logo" alt="پیش‌نمایش لوگو" ${logoUrl ? `src="${esc(logoUrl)}"` : 'hidden'}><div><input id="f-logo" type="file" accept="image/png,image/jpeg,image/webp" class="input" style="max-width:320px"><br><button class="btn btn-sm btn-ghost" type="button" id="si-rmlogo" ${logoUrl ? '' : 'hidden'} style="margin-top:6px">حذف لوگو</button></div></div>
        <span class="hint muted" style="font-size:.8rem">PNG، JPG یا WebP، حداکثر ۱ مگابایت. بدون لوگو، لوگوی پیش‌فرض سایت می‌ماند.</span><span class="err" data-err="logo_data_url" role="alert" style="color:var(--red);font-size:.82rem;display:block"></span></section>
      <section class="card"><div class="card-head"><h3>سؤالات متداول</h3></div>
        <p class="muted" style="margin-top:0;font-size:.86rem">اگر حداقل یک سؤال بنویسید، فهرست زیر جای سؤالات پیش‌فرض سایت می‌نشیند. خالی‌گذاشتن یعنی سؤالات پیش‌فرض.</p>
        <div id="si-faq" class="osi-faq"></div><span class="err" data-err="faq" role="alert" style="color:var(--red);font-size:.82rem"></span>
        <button class="btn btn-sm" type="button" id="si-addq" style="margin-top:8px">افزودن سؤال</button></section>
      <section class="card"><div class="card-head"><h3>پایین سایت</h3></div>
        ${field('footer', 'متن معرفی در فوتر', `<textarea class="input" id="f-footer" name="footer" rows="2" maxlength="300">${esc(s.footer)}</textarea>`)}</section>
      <div class="osi-save"><button class="btn btn-primary" type="submit" id="si-save">ذخیرهٔ تغییرها</button><span class="muted" style="font-size:.84rem" id="si-hint">تغییری ذخیره نشده</span></div>
    </form>`;
  const form = $('#si-form', page);
  const dirty = () => { $('#si-hint', page).textContent = 'تغییرهای ذخیره‌نشده دارید'; };
  form.addEventListener('input', dirty);
  // FAQ editor
  const faqEl = $('#si-faq', page);
  const drawFaq = () => {
    faqEl.innerHTML = faq.length ? faq.map((x, i) => `<div class="osi-q"><div class="field" style="margin:0"><label for="fq-${i}">سؤال ${faNum(i + 1)}</label><input class="input" id="fq-${i}" data-q="${i}" name="faq.${i}.q" value="${esc(x.q)}" maxlength="200"><span class="err" data-err="faq.${i}.q" role="alert"></span></div>
        <div class="field" style="margin:0"><label for="fa-${i}">پاسخ</label><textarea class="input" id="fa-${i}" data-a="${i}" name="faq.${i}.a" rows="3" maxlength="1500">${esc(x.a)}</textarea><span class="err" data-err="faq.${i}.a" role="alert"></span></div>
        <div class="row"><button class="btn btn-sm" type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="انتقال به بالا">بالا</button><button class="btn btn-sm" type="button" data-down="${i}" ${i === faq.length - 1 ? 'disabled' : ''} aria-label="انتقال به پایین">پایین</button><button class="btn btn-sm btn-danger" type="button" data-del="${i}">حذف</button></div></div>`).join('') : '<p class="muted">سؤالی ننوشته‌اید؛ سؤالات پیش‌فرض سایت نمایش داده می‌شود.</p>';
    $$('[data-q]', faqEl).forEach((x) => x.addEventListener('input', () => { faq[+x.dataset.q].q = x.value; }));
    $$('[data-a]', faqEl).forEach((x) => x.addEventListener('input', () => { faq[+x.dataset.a].a = x.value; }));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= faq.length) return; [faq[i], faq[j]] = [faq[j], faq[i]]; drawFaq(); dirty(); };
    $$('[data-up]', faqEl).forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
    $$('[data-down]', faqEl).forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
    $$('[data-del]', faqEl).forEach((b) => b.addEventListener('click', () => { faq.splice(+b.dataset.del, 1); drawFaq(); dirty(); }));
  };
  drawFaq();
  $('#si-addq', page).addEventListener('click', () => { if (faq.length >= 30) return toast('حداکثر ۳۰ سؤال مجاز است', 'err'); faq.push({ q: '', a: '' }); drawFaq(); dirty(); $(`#fq-${faq.length - 1}`, faqEl)?.focus(); });
  // logo
  const img = $('#si-logo', page), rm = $('#si-rmlogo', page);
  $('#f-logo', page).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    clearErrors(form);
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { e.target.value = ''; return showErrors(form, { logo_data_url: 'فقط PNG، JPG یا WebP مجاز است' }); }
    if (f.size > MAX_LOGO) { e.target.value = ''; return showErrors(form, { logo_data_url: 'حجم لوگو باید کمتر از ۱ مگابایت باشد' }); }
    logoData = await fileToDataUrl(f); removeLogo = false;
    img.src = logoData; img.hidden = false; rm.hidden = false; dirty();
  });
  rm.addEventListener('click', () => { logoData = null; removeLogo = true; logoUrl = null; img.removeAttribute('src'); img.hidden = true; rm.hidden = true; $('#f-logo', page).value = ''; dirty(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const f = form.elements;
    const body = {
      hero: { title: f['hero.title'].value.trim(), subtitle: f['hero.subtitle'].value.trim() },
      announcement: { active: f['announcement.active'].checked, text: f['announcement.text'].value.trim(), href: f['announcement.href'].value.trim() },
      contact: { phone: f['contact.phone'].value.trim(), email: f['contact.email'].value.trim(), telegram: f['contact.telegram'].value.trim(), instagram: f['contact.instagram'].value.trim(), address: f['contact.address'].value.trim() },
      faq: faq.map((x) => ({ q: x.q.trim(), a: x.a.trim() })),
      footer: f.footer.value.trim(),
    };
    if (logoData) body.logo_data_url = logoData; else if (removeLogo) body.remove_logo = true;
    const btn = $('#si-save', page);
    setBusy(btn, true, 'در حال ذخیره…');
    try {
      const res = await oapi('/api/owner/site', { method: 'PUT', body });
      toast('محتوای سایت ذخیره شد', 'ok');
      logoData = null; removeLogo = false; logoUrl = res.site.logo_url;
      faq = res.site.faq.map((x) => ({ ...x })); drawFaq();
      $('#si-hint', page).textContent = 'ذخیره شد؛ تا یک دقیقهٔ دیگر روی سایت دیده می‌شود';
    } catch (err) {
      const orphan = showErrors(form, err.body?.errors || {});
      toast(orphan[0] || errText(err), 'err');
    } finally { setBusy(btn, false); }
  });
}
