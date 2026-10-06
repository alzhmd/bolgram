import { jDateTime, esc, emptyState, useStyle, debounce, table, pager, $ } from '/panel/assets/js/core.js';
import { oapi, qs, showError, head, storeLink, actionName } from '../ui.js';

useStyle('o-audit', `
.oa-meta{direction:ltr;text-align:left;unicode-bidi:isolate;font-size:.76rem;color:var(--muted);max-width:280px;overflow-wrap:anywhere;white-space:normal}
`);
const st = { merchant_id: '', action: '', page: 1 };

export async function render(page, { query }) {
  if (query.get('merchant_id') !== null) { st.merchant_id = query.get('merchant_id') || ''; st.page = 1; }
  page.innerHTML = `${head('گزارش فعالیت')}
    <div class="toolbar"><label class="sr-only" for="au-m">شناسهٔ فروشگاه</label><input class="input ltr" id="au-m" type="search" placeholder="شناسهٔ فروشگاه (m_…)" value="${esc(st.merchant_id)}" autocomplete="off" dir="ltr">
      <label class="sr-only" for="au-a">نوع فعالیت</label><select class="input select" id="au-a"><option value="">همهٔ فعالیت‌ها</option></select></div>
    <div id="au-list" aria-live="polite"></div>`;
  const list = $('#au-list', page), sel = $('#au-a', page);
  let actionsFilled = false;
  const load = async () => {
    list.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/audit${qs({ merchant_id: st.merchant_id, action: st.action, page: st.page, per_page: 30 })}`); } catch (e) { return showError(list, e, load); }
    if (!actionsFilled) {
      sel.innerHTML = '<option value="">همهٔ فعالیت‌ها</option><option value="owner.">فقط کارهای مدیر پلتفرم</option>' + r.actions.map((a) => `<option value="${esc(a.action)}">${esc(actionName(a.action))}</option>`).join('');
      sel.value = st.action; actionsFilled = true;
    }
    list.innerHTML = r.data.length ? table([
      { title: 'زمان', cls: 'nowrap', render: (a) => jDateTime(a.created_at) },
      { title: 'فروشگاه', render: (a) => (a.merchant_id ? `${storeLink(a.merchant_id, a.store_name || a.store_handle || a.merchant_id)}${a.store_handle ? `<br><span class="muted ltr" style="font-size:.78rem">@${esc(a.store_handle)}</span>` : ''}` : '<span class="muted">سراسری</span>') },
      { title: 'فعالیت', render: (a) => `<b>${esc(actionName(a.action))}</b>${a.target ? `<br><span class="muted ltr" style="font-size:.78rem">${esc(a.target)}</span>` : ''}` },
      { title: 'انجام‌دهنده', render: (a) => `${esc(a.actor_name || (a.actor_kind === 'system' ? 'سیستم' : a.actor_kind === 'admin' ? 'مدیر پلتفرم' : '—'))}${a.ip ? `<br><span class="muted ltr" style="font-size:.78rem">${esc(a.ip)}</span>` : ''}` },
      { title: 'جزئیات', render: (a) => (a.meta ? `<div class="oa-meta">${esc(JSON.stringify(a.meta))}</div>` : '—') },
    ], r.data) : `<div class="card">${emptyState('receipt', 'فعالیتی ثبت نشده', st.merchant_id || st.action ? 'فیلترها را تغییر دهید.' : 'با فعالیت فروشگاه‌ها و مدیران، گزارش اینجا پر می‌شود.')}</div>`;
    list.appendChild(pager(r, (p) => { st.page = p; load(); window.scrollTo(0, 0); }));
  };
  $('#au-m', page).addEventListener('input', debounce((e) => { st.merchant_id = e.target.value.trim(); st.page = 1; load(); }, 400));
  sel.addEventListener('change', (e) => { st.action = e.target.value; st.page = 1; load(); });
  await load();
}
