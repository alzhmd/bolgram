// Trust badge (نماد اعتماد بولگرام): identity verification stepper, then the badge and embed code.
import { api, esc, toFa, toLatin, fixArabic, toast, setBusy, copy, jDateTime, fileToDataUrl, ApiError, ICON, useStyle, session, $, $$ } from '../core.js';

const STEPS = ['اطلاعات کسب‌وکار', 'مدارک هویتی', 'بررسی و ارسال', 'وضعیت'];
const KINDS = { national_card: 'کارت ملی', business_license: 'روزنامهٔ رسمی / جواز کسب', other: 'سایر مدارک' };
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

// Same checksums as the server (کد ملی and شناسه ملی)
export function validNational(v) {
  const s = toLatin(String(v || '')).replace(/\D/g, '');
  if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false;
  const d = [...s].map(Number);
  const r = d.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return d[9] === (r < 2 ? r : 11 - r);
}
export function validCompany(v) {
  const s = toLatin(String(v || '')).replace(/\D/g, '');
  if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  const d = [...s].map(Number), off = d[9] + 2;
  let r = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17].reduce((a, c, i) => a + (d[i] + off) * c, 0) % 11;
  if (r === 10) r = 0;
  return r === d[10];
}

const CSS = `
.tr-wrap{max-width:820px;display:grid;gap:16px}
.tr-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tr-steps li{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-size:.8rem;color:var(--muted);padding:10px 4px;border-radius:12px;border:1px solid var(--border);background:var(--surface)}
.tr-steps b{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--border);font-size:.85rem}
.tr-steps li[aria-current="step"]{color:var(--fg);border-color:var(--brand);background:var(--brand-soft)}
.tr-steps li[aria-current="step"] b{border-color:var(--brand);background:var(--brand);color:var(--brand-ink)}
.tr-steps li.done b{border-color:var(--green);background:var(--green);color:#04130a}
.tr-doc{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);flex-wrap:wrap}
.tr-doc .grow{flex:1;min-width:140px}
.tr-docs{display:grid;gap:10px}
.tr-badge{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.tr-badge img{max-width:100%;height:auto}
.tr-nav{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.tr-sum dd{font-weight:600}
@media (max-width:520px){.tr-steps li{font-size:.7rem}}
`;

export async function render(page) {
  useStyle('trust', CSS);
  page.innerHTML = `<div class="page-head"><h1>نماد اعتماد بولگرام</h1></div><p class="muted">در حال بارگذاری…</p>`;
  let d;
  try { d = await api('/api/v2/trust'); } catch (e) { page.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  const v = { business_type: 'individual', business_name: '', owner_name: '', national_code: '', company_national_id: '', website: '', instagram: '', phone: d.default_phone || '', address: '' };
  if (d.request) for (const k of Object.keys(v)) if (d.request[k]) v[k] = d.request[k];
  let step = 0;
  let editing = d.status === 'none' || d.status === 'draft';

  const status = () => d.request?.status || 'none';
  const docsOf = () => d.request?.documents || [];
  const setErrors = (root, errs) => { $$('[data-err]', root).forEach((x) => (x.textContent = errs[x.dataset.err] || '')); const first = Object.keys(errs)[0]; if (first) $(`[data-err="${first}"]`, root)?.closest('.field')?.querySelector('input,select,textarea')?.focus(); };

  const frame = (inner, current) => `<div class="page-head"><h1>نماد اعتماد بولگرام</h1></div><div class="tr-wrap">
    <p class="muted" style="margin:0">با تأیید هویت، نماد اعتماد بولگرام را روی سایت یا صفحهٔ اینستاگرام خود بگذارید تا مشتری مطمئن شود پشت این فروشگاه یک فرد یا شرکت واقعی است. مدارک شما فقط برای بررسی هویت استفاده می‌شود و در دسترس عموم نیست.</p>
    <ol class="tr-steps" aria-label="مراحل">${STEPS.map((t, i) => `<li ${i === current ? 'aria-current="step"' : ''} class="${i < current ? 'done' : ''}"><b>${i < current ? '✓' : toFa(i + 1)}</b>${t}</li>`).join('')}</ol>${inner}</div>`;

  function draw() {
    if (!editing || ['pending', 'approved'].includes(status())) return drawStatus();
    if (step === 0) return drawInfo();
    if (step === 1) return drawDocs();
    return drawSubmit();
  }

  // ------------------------------------------------ step 1
  function drawInfo() {
    const co = v.business_type === 'company';
    page.innerHTML = frame(`<form class="card" id="tr-form" novalidate>
      <div class="field"><span style="font-weight:600;font-size:.92rem" id="tr-type-l">نوع کسب‌وکار</span><div class="seg" role="group" aria-labelledby="tr-type-l"><button type="button" data-type="individual" aria-pressed="${!co}">شخص حقیقی</button><button type="button" data-type="company" aria-pressed="${co}">شرکت یا شخص حقوقی</button></div></div>
      <div class="grid g2">
        <div class="field"><label for="f-bn">نام کسب‌وکار / فروشگاه</label><input id="f-bn" class="input" maxlength="100" value="${esc(v.business_name)}" autocomplete="organization"><div class="err" data-err="business_name"></div></div>
        <div class="field"><label for="f-on">${co ? 'نام مدیرعامل یا نمایندهٔ قانونی' : 'نام و نام خانوادگی (مطابق کارت ملی)'}</label><input id="f-on" class="input" maxlength="100" value="${esc(v.owner_name)}" autocomplete="name"><div class="err" data-err="owner_name"></div></div>
        <div class="field"><label for="f-nc">کد ملی${co ? ' مدیرعامل' : ''}</label><input id="f-nc" class="input ltr" inputmode="numeric" maxlength="14" value="${esc(toFa(v.national_code))}" autocomplete="off"><div class="err" data-err="national_code"></div></div>
        ${co ? `<div class="field"><label for="f-ci">شناسه ملی شرکت (۱۱ رقم)</label><input id="f-ci" class="input ltr" inputmode="numeric" maxlength="14" value="${esc(toFa(v.company_national_id))}" autocomplete="off"><div class="err" data-err="company_national_id"></div></div>` : ''}
        <div class="field"><label for="f-ph">شمارهٔ تماس</label><input id="f-ph" class="input ltr" inputmode="tel" maxlength="20" value="${esc(toFa(v.phone))}" autocomplete="tel"><div class="err" data-err="phone"></div></div>
        <div class="field"><label for="f-web">وب‌سایت</label><input id="f-web" class="input ltr" inputmode="url" maxlength="200" placeholder="https://example.ir" value="${esc(v.website)}"><div class="err" data-err="website"></div></div>
        <div class="field"><label for="f-ig">اینستاگرام</label><input id="f-ig" class="input ltr" maxlength="60" placeholder="@shop_name" value="${esc(v.instagram ? '@' + v.instagram : '')}"><div class="hint">حداقل یکی از وب‌سایت یا اینستاگرام لازم است.</div><div class="err" data-err="instagram"></div></div>
      </div>
      <div class="field"><label for="f-ad">نشانی کامل</label><textarea id="f-ad" class="input" rows="3" maxlength="300">${esc(v.address)}</textarea><div class="err" data-err="address"></div></div>
      <div class="tr-nav"><button class="btn btn-primary" type="submit">ذخیره و ادامه</button></div></form>`, 0);
    $$('[data-type]', page).forEach((b) => b.addEventListener('click', () => { collect(); v.business_type = b.dataset.type; drawInfo(); }));
    $('#tr-form', page).addEventListener('submit', async (e) => {
      e.preventDefault();
      collect();
      const errs = {};
      if (v.business_name.length < 2) errs.business_name = 'نام کسب‌وکار را بنویسید';
      if (v.owner_name.length < 3) errs.owner_name = 'نام و نام خانوادگی را کامل بنویسید';
      if (!v.national_code) errs.national_code = 'کد ملی را وارد کنید';
      else if (!validNational(v.national_code)) errs.national_code = 'کد ملی معتبر نیست؛ ده رقم را دوباره بررسی کنید';
      if (v.business_type === 'company') {
        if (!v.company_national_id) errs.company_national_id = 'شناسه ملی شرکت را وارد کنید';
        else if (!validCompany(v.company_national_id)) errs.company_national_id = 'شناسه ملی معتبر نیست؛ یازده رقم را دوباره بررسی کنید';
      }
      if (!v.phone) errs.phone = 'شمارهٔ تماس را وارد کنید';
      if (!v.website && !v.instagram) errs.website = 'وب‌سایت یا اینستاگرام را وارد کنید';
      if (v.address.length < 10) errs.address = 'نشانی کامل را بنویسید';
      if (Object.keys(errs).length) return setErrors(page, errs);
      const btn = $('button[type=submit]', page);
      setBusy(btn, true, 'در حال ذخیره…');
      try { d = await api('/api/v2/trust', { method: 'PUT', body: v }); step = 1; draw(); window.scrollTo({ top: 0 }); }
      catch (err) { setBusy(btn, false); if (err instanceof ApiError && err.body?.errors) setErrors(page, err.body.errors); toast(err.message || 'ذخیره انجام نشد', 'err'); }
    });
  }
  function collect() {
    const g = (id) => $(id, page)?.value ?? '';
    v.business_name = fixArabic(g('#f-bn')).trim();
    v.owner_name = fixArabic(g('#f-on')).trim();
    v.national_code = toLatin(g('#f-nc')).replace(/\D/g, '');
    if ($('#f-ci', page)) v.company_national_id = toLatin(g('#f-ci')).replace(/\D/g, '');
    v.phone = toLatin(g('#f-ph')).replace(/[^\d+]/g, '');
    v.website = g('#f-web').trim();
    v.instagram = g('#f-ig').trim().replace(/^@/, '');
    v.address = fixArabic(g('#f-ad')).trim();
  }

  // ------------------------------------------------ step 2
  function drawDocs() {
    const co = v.business_type === 'company';
    const need = [['national_card', true], ...(co ? [['business_license', true]] : []), ['other', false]];
    page.innerHTML = frame(`<section class="card"><div class="card-head"><h3>بارگذاری مدارک</h3></div>
      <p class="muted" style="margin-top:0">تصویر واضح و کامل (PNG، JPG یا PDF تا ۵ مگابایت). روی کارت ملی، فقط روی کارت را بفرستید و در صورت تمایل شمارهٔ پشت‌کارت را بپوشانید.</p>
      <div class="tr-docs">${need.map(([k, req]) => {
        const have = docsOf().filter((x) => x.kind === k);
        return `<div class="field" style="margin:0"><label for="up-${k}">${KINDS[k]} ${req ? '<span class="pill bad">الزامی</span>' : '<span class="muted">(اختیاری)</span>'}</label>
          ${have.map((x) => `<div class="tr-doc"><span class="grow">${esc(x.name || KINDS[k])}</span><button class="btn btn-sm" type="button" data-view="${esc(x.file)}">مشاهده</button><button class="btn btn-sm btn-danger" type="button" data-del="${esc(x.file)}" aria-label="حذف ${esc(x.name || KINDS[k])}">حذف</button></div>`).join('')}
          ${!have.length || k === 'other' ? `<input id="up-${k}" class="input" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" data-kind="${k}">` : `<div class="hint">برای جایگزینی، ابتدا فایل را حذف کنید.</div>`}</div>`;
      }).join('')}</div>
      <div class="err" data-err="documents" role="alert" style="margin-top:8px"></div>
      <div class="tr-nav"><button class="btn" type="button" id="tr-back">مرحلهٔ قبل</button><button class="btn btn-primary" type="button" id="tr-next">ادامه</button></div></section>`, 1);
    $$('input[type=file]', page).forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      if (!ACCEPT.includes(f.type)) { toast('فقط تصویر یا PDF مجاز است', 'err'); inp.value = ''; return; }
      if (f.size > MAX_BYTES) { toast('حجم فایل باید کمتر از ۵ مگابایت باشد', 'err'); inp.value = ''; return; }
      inp.disabled = true;
      try { d = await api('/api/v2/trust/documents', { method: 'POST', body: { kind: inp.dataset.kind, name: f.name, data_url: await fileToDataUrl(f) } }); toast('مدرک بارگذاری شد', 'ok'); drawDocs(); }
      catch (err) { inp.disabled = false; inp.value = ''; toast(err.message || 'بارگذاری انجام نشد', 'err'); }
    }));
    $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      setBusy(b, true);
      try { d = await api(`/api/v2/trust/documents/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); drawDocs(); }
      catch (err) { setBusy(b, false); toast(err.message, 'err'); }
    }));
    $$('[data-view]', page).forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/v2/trust/documents/${encodeURIComponent(b.dataset.view)}`, { headers: { Authorization: `Bearer ${session.get()}` } });
        if (!res.ok) throw new Error('دریافت فایل ناموفق بود');
        const url = URL.createObjectURL(await res.blob());
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { toast(err.message, 'err'); }
    }));
    $('#tr-back', page).addEventListener('click', () => { step = 0; draw(); });
    $('#tr-next', page).addEventListener('click', () => {
      const kinds = docsOf().map((x) => x.kind);
      if (!kinds.includes('national_card')) return setErrors(page, { documents: 'تصویر کارت ملی را بارگذاری کنید' });
      if (co && !kinds.includes('business_license')) return setErrors(page, { documents: 'تصویر روزنامهٔ رسمی یا جواز کسب را بارگذاری کنید' });
      step = 2; draw();
    });
  }

  // ------------------------------------------------ step 3
  function drawSubmit() {
    const co = v.business_type === 'company';
    page.innerHTML = frame(`<section class="card"><div class="card-head"><h3>بررسی نهایی</h3></div>
      <dl class="kv tr-sum"><dt>نوع</dt><dd>${co ? 'شرکت / شخص حقوقی' : 'شخص حقیقی'}</dd><dt>نام کسب‌وکار</dt><dd>${esc(v.business_name)}</dd><dt>${co ? 'مدیرعامل' : 'صاحب کسب‌وکار'}</dt><dd>${esc(v.owner_name)}</dd>
      <dt>کد ملی</dt><dd class="ltr">${esc(toFa(v.national_code))}</dd>${co ? `<dt>شناسه ملی</dt><dd class="ltr">${esc(toFa(v.company_national_id))}</dd>` : ''}
      <dt>تماس</dt><dd class="ltr">${esc(toFa(v.phone))}</dd>${v.website ? `<dt>وب‌سایت</dt><dd class="ltr">${esc(v.website)}</dd>` : ''}${v.instagram ? `<dt>اینستاگرام</dt><dd class="ltr">@${esc(v.instagram)}</dd>` : ''}
      <dt>نشانی</dt><dd>${esc(v.address)}</dd><dt>مدارک</dt><dd>${docsOf().map((x) => KINDS[x.kind]).join('، ')}</dd></dl>
      <div class="alert alert-warn" style="margin-top:14px">پس از ارسال، تا اعلام نتیجه امکان ویرایش نیست. بررسی معمولاً چند روز کاری طول می‌کشد و نتیجه در همین صفحه و اعلان‌ها نمایش داده می‌شود.</div>
      <div class="err" data-err="submit" role="alert"></div>
      <div class="tr-nav"><button class="btn" type="button" id="tr-back">مرحلهٔ قبل</button><button class="btn btn-primary" type="button" id="tr-send">ارسال برای بررسی</button></div></section>`, 2);
    $('#tr-back', page).addEventListener('click', () => { step = 1; draw(); });
    $('#tr-send', page).addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true, 'در حال ارسال…');
      try { d = await api('/api/v2/trust/submit', { method: 'POST', body: {} }); editing = false; toast('درخواست شما ارسال شد', 'ok'); draw(); window.scrollTo({ top: 0 }); }
      catch (err) {
        setBusy(e.currentTarget, false);
        const errs = err.body?.errors || {};
        if (errs.documents) { step = 1; draw(); setErrors(page, { documents: errs.documents }); }
        else if (Object.keys(errs).length) { step = 0; draw(); setErrors(page, errs); }
        else $('[data-err="submit"]', page).textContent = err.message || 'ارسال انجام نشد';
        toast(err.message || 'ارسال انجام نشد', 'err');
      }
    });
  }

  // ------------------------------------------------ step 4
  function drawStatus() {
    const s = status();
    let inner = '';
    if (s === 'pending') {
      inner = `<section class="card"><div class="card-head"><h3>در حال بررسی</h3><span class="pill warn">در انتظار تأیید</span></div>
        <p style="margin:0">درخواست شما در ${jDateTime(d.request.submitted_at)} ثبت شد و در صف بررسی تیم بولگرام است. نتیجه در همین صفحه نمایش داده می‌شود.</p></section>`;
    } else if (s === 'approved') {
      const e = d.embed;
      inner = `<section class="card"><div class="card-head"><h3>هویت فروشگاه شما تأیید شد</h3><span class="pill ok">تأییدشده</span></div>
        <div class="tr-badge"><img src="${esc(e.badge_url)}" width="232" height="64" alt="نماد اعتماد بولگرام"><a class="btn btn-sm" href="${esc(e.page_url)}" target="_blank" rel="noopener">مشاهدهٔ صفحهٔ تأیید</a></div>
        ${d.request.note ? `<p class="muted">پیام بولگرام: ${esc(d.request.note)}</p>` : ''}</section>
        <section class="card"><div class="card-head"><h3>کد قرار دادن نماد</h3></div>
        <p class="muted" style="margin-top:0">این کد را در بخش HTML سایت یا فوتر فروشگاه خود قرار دهید. نماد با کلیک به صفحهٔ تأیید بولگرام می‌رود.</p>
        <pre class="code" id="tr-code" tabindex="0" style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10px">${esc(e.html)}</pre>
        <div class="tr-nav" style="margin-top:0"><button class="btn btn-primary" type="button" id="tr-copy">کپی کد</button><button class="btn" type="button" id="tr-copy-link">کپی نشانی صفحهٔ تأیید</button></div></section>`;
    } else if (s === 'rejected') {
      inner = `<section class="card"><div class="card-head"><h3>درخواست تأیید نشد</h3><span class="pill bad">رد شد</span></div>
        <div class="alert alert-err">${esc(d.request.note || 'دلیلی ثبت نشده است.')}</div>
        <p class="muted">مشکل را اصلاح کنید و دوباره ارسال کنید.</p><div class="tr-nav"><button class="btn btn-primary" type="button" id="tr-edit">ویرایش و ارسال مجدد</button></div></section>`;
    }
    page.innerHTML = frame(inner, 3);
    $('#tr-copy', page)?.addEventListener('click', (e) => copy(d.embed.html, e.currentTarget));
    $('#tr-copy-link', page)?.addEventListener('click', (e) => copy(d.embed.page_url, e.currentTarget));
    $('#tr-edit', page)?.addEventListener('click', () => { editing = true; step = 0; draw(); });
  }

  draw();
}
