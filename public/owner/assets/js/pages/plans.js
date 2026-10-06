import { faNum, toFa, esc, emptyState, toast, modal, confirmDialog, setBusy, useStyle, table, $ } from '/panel/assets/js/core.js';
import { oapi, errText, showError, head, field, showErrors } from '../ui.js';

useStyle('o-plans', `
.opl-lim{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}
.opl-checks{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px}
`);

const lim = (v) => (v === null || v === undefined ? 'نامحدود' : faNum(v));
const LIMITS = [['cards', 'کارت بانکی'], ['links', 'لینک پرداخت'], ['team', 'همکار'], ['devices', 'دستگاه']];

export async function render(page) {
  const load = async () => {
    let r;
    try { r = await oapi('/api/owner/plans'); } catch (e) { return showError(page, e, load); }
    page.innerHTML = `${head('پلن‌ها', '<button class="btn btn-primary" type="button" id="pl-new">پلن جدید</button>')}
      <p class="muted" style="margin:0">پلن‌های فعال در صفحهٔ تعرفهٔ سایت و در پنل فروشگاه‌ها نمایش داده می‌شوند. پلنی که مشترک دارد حذف نمی‌شود؛ آن را غیرفعال کنید.</p>
      ${r.data.length ? table([
        { title: 'پلن', render: (p) => `<b>${esc(p.name)}</b> ${p.highlighted ? '<span class="pill ok">پیشنهاد ما</span>' : ''}<br><span class="muted ltr" style="font-size:.8rem">${esc(p.id)}</span>` },
        { title: 'قیمت ماهانه', cls: 'num nowrap', render: (p) => (p.monthly_price_toman ? `${faNum(p.monthly_price_toman)} تومان` : 'رایگان') },
        { title: 'کارمزد', cls: 'num', render: (p) => `${toFa(p.fee_percent)}٪<br><span class="muted" style="font-size:.78rem">${faNum(p.fee_min_toman)} تا ${p.fee_max_toman === null ? 'بدون سقف' : faNum(p.fee_max_toman)} تومان</span>` },
        { title: 'سقف‌ها', render: (p) => `<span class="muted" style="font-size:.84rem">${LIMITS.map(([k, n]) => `${lim(p.limits[k])} ${n}`).join(' · ')}</span>` },
        { title: 'اعتبار منفی', cls: 'num', render: (p) => `${faNum(p.credit_toman)} تومان` },
        { title: 'مشترک', cls: 'num', render: (p) => faNum(p.subscribers) },
        { title: 'وضعیت', render: (p) => (p.active ? '<span class="pill ok">فعال</span>' : '<span class="pill">غیرفعال</span>') },
        { title: 'عملیات', render: (p) => `<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" type="button" data-edit="${esc(p.id)}">ویرایش</button>${p.id === 'free' ? '' : `<button class="btn btn-sm" type="button" data-toggle="${esc(p.id)}">${p.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button><button class="btn btn-sm btn-danger" type="button" data-del="${esc(p.id)}">حذف</button>`}</span>` },
      ], r.data) : `<div class="card">${emptyState('crown', 'پلنی تعریف نشده', 'با «پلن جدید» اولین پلن را بسازید.')}</div>`}`;
    const byId = Object.fromEntries(r.data.map((p) => [p.id, p]));
    $('#pl-new', page).addEventListener('click', () => form(null, load));
    page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(byId[b.dataset.edit], load)));
    page.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const p = byId[b.dataset.toggle];
      setBusy(b, true);
      try { await oapi(`/api/owner/plans/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { active: !p.active } }); toast(p.active ? 'پلن غیرفعال شد' : 'پلن فعال شد', 'ok'); load(); }
      catch (e) { setBusy(b, false); toast(errText(e), 'err'); }
    }));
    page.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = byId[b.dataset.del];
      if (!(await confirmDialog('حذف پلن', `پلن «${esc(p.name)}» برای همیشه حذف می‌شود. این کار برگشت‌پذیر نیست.`, 'حذف پلن', true))) return;
      try { await oapi(`/api/owner/plans/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('پلن حذف شد', 'ok'); load(); } catch (e) { toast(errText(e), 'err'); }
    }));
  };
  await load();
}

function form(plan, done) {
  const edit = !!plan;
  const p = plan || { id: '', name: '', description: '', monthly_price_toman: 0, fee_percent: 1, fee_min_toman: 0, fee_max_toman: null, credit_toman: 0, limits: { cards: 1, links: 5, team: 0, devices: 1 }, features: [], sort: 10, active: true, highlighted: false };
  const num = (name, v, extra = '') => `<input class="input num ltr" id="f-${name}" name="${name}" value="${v === null || v === undefined ? '' : esc(v)}" inputmode="decimal" autocomplete="off" ${extra}>`;
  const m = modal({
    title: edit ? `ویرایش پلن «${esc(plan.name)}»` : 'پلن جدید',
    wide: true,
    body: `<form id="pl-form" novalidate>
      ${edit ? '' : field('id', 'شناسه (انگلیسی)', `<input class="input ltr" id="f-id" name="id" maxlength="24" placeholder="pro" autocomplete="off">`, 'حروف کوچک، عدد و خط تیره؛ ۲ تا ۲۴ نویسه. بعداً قابل تغییر نیست.')}
      ${field('name', 'نام پلن', `<input class="input" id="f-name" name="name" value="${esc(p.name)}" maxlength="40">`)}
      ${field('description', 'توضیح کوتاه', `<input class="input" id="f-description" name="description" value="${esc(p.description)}" maxlength="140">`)}
      <div class="opl-lim">
        ${field('monthly_price_toman', 'قیمت ماهانه (تومان)', num('monthly_price_toman', p.monthly_price_toman), '۰ یعنی رایگان')}
        ${field('credit_toman', 'اعتبار منفی مجاز (تومان)', num('credit_toman', p.credit_toman), 'تا این مقدار کیف پول می‌تواند منفی شود')}
        ${field('fee_percent', 'کارمزد هر تراکنش (٪)', num('fee_percent', p.fee_percent))}
        ${field('sort', 'ترتیب نمایش', num('sort', p.sort), 'عدد کمتر، بالاتر')}
        ${field('fee_min_toman', 'حداقل کارمزد (تومان)', num('fee_min_toman', p.fee_min_toman))}
        ${field('fee_max_toman', 'سقف کارمزد (تومان)', num('fee_max_toman', p.fee_max_toman), 'خالی = بدون سقف')}
      </div>
      <h3 style="margin:6px 0">سقف امکانات <span class="muted" style="font-weight:400;font-size:.84rem">(خالی = نامحدود)</span></h3>
      <div class="opl-lim">${LIMITS.map(([k, n]) => field(`limits.${k}`, n, num(`limits.${k}`, p.limits[k]))).join('')}</div>
      ${field('features', 'ویژگی‌ها (هر خط یک مورد)', `<textarea class="input" id="f-features" name="features" rows="4" maxlength="800">${esc((p.features || []).join('\n'))}</textarea>`)}
      <div class="opl-checks"><label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''} ${p.id === 'free' ? 'disabled' : ''}><span>فعال</span></label>
        <label class="check"><input type="checkbox" name="highlighted" ${p.highlighted ? 'checked' : ''}><span>پیشنهاد ما (فقط یک پلن)</span></label></div>
    </form>`,
    actions: '<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-primary" type="button" id="pl-save">ذخیره</button>',
  });
  $('#pl-save', m.el).addEventListener('click', async (e) => {
    const f = $('#pl-form', m.el);
    const v = (n) => f.elements[n].value.trim();
    const toLatin = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const n = (name) => { const t = toLatin(v(name)); return t === '' ? null : Number(t.replace(/[,٬\s]/g, '')); };
    const body = {
      name: v('name'), description: v('description'),
      monthly_price_toman: n('monthly_price_toman') ?? 0, fee_percent: n('fee_percent') ?? 0, fee_min_toman: n('fee_min_toman') ?? 0, fee_max_toman: n('fee_max_toman'),
      credit_toman: n('credit_toman') ?? 0, sort: n('sort') ?? 0,
      limits: Object.fromEntries(LIMITS.map(([k]) => [k, n(`limits.${k}`)])),
      features: v('features').split('\n').map((x) => x.trim()).filter(Boolean),
      highlighted: f.elements.highlighted.checked,
    };
    if (p.id !== 'free') body.active = f.elements.active.checked;
    if (!edit) body.id = v('id').toLowerCase();
    setBusy(e.target.closest('button'), true);
    try {
      await oapi(edit ? `/api/owner/plans/${encodeURIComponent(plan.id)}` : '/api/owner/plans', { method: edit ? 'PATCH' : 'POST', body });
      m.close(); toast(edit ? 'پلن ذخیره شد' : 'پلن ساخته شد', 'ok'); done();
    } catch (err) {
      setBusy(e.target.closest('button'), false);
      const orphan = showErrors(m.el, err.body?.errors || {});
      if (!err.body?.errors || orphan.length) toast(errText(err), 'err');
    }
  });
}
