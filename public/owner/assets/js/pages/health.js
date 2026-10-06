import { jDateTime, faNum, toFa, esc, useStyle, setBusy, $ } from '/panel/assets/js/core.js';
import { oapi, showError, head } from '../ui.js';

useStyle('o-health', `
.oh-checks{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.oh-check{display:grid;gap:6px;border-inline-start:4px solid var(--border)}
.oh-check.ok{border-inline-start-color:var(--green)}.oh-check.warn{border-inline-start-color:var(--amber)}.oh-check.error{border-inline-start-color:var(--red)}
.oh-check b{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.oh-check p{margin:0;color:var(--muted);font-size:.9rem}
.oh-val{font-size:.82rem}
`);
const LEVEL = { ok: ['سالم', 'ok'], warn: ['نیاز به توجه', 'warn'], error: ['مشکل جدی', 'bad'] };
const OVERALL = { ok: ['همه‌چیز سالم است', 'alert-ok'], warn: ['چند مورد نیاز به توجه دارد', 'alert-warn'], error: ['مشکل جدی وجود دارد', 'alert-err'] };

export async function render(page) {
  const load = async () => {
    let r;
    try { r = await oapi('/api/owner/health'); } catch (e) { return showError(page, e, load); }
    const [t, c] = OVERALL[r.overall];
    const counts = { ok: 0, warn: 0, error: 0 };
    r.checks.forEach((x) => { counts[x.status]++; });
    page.innerHTML = `${head('سلامت سیستم', '<button class="btn" type="button" id="hl-refresh">بررسی دوباره</button>')}
      <div class="alert ${c}" role="status"><b>${t}</b> — ${faNum(counts.ok)} سالم، ${faNum(counts.warn)} نیازمند توجه، ${faNum(counts.error)} مشکل جدی. آخرین بررسی: ${jDateTime(r.server.time)}</div>
      <div class="oh-checks">${[...r.checks].sort((a, b) => ['error', 'warn', 'ok'].indexOf(a.status) - ['error', 'warn', 'ok'].indexOf(b.status)).map((x) => `<section class="card oh-check ${x.status}"><b>${esc(x.label)} <span class="pill ${LEVEL[x.status][1]}">${LEVEL[x.status][0]}</span></b><p>${esc(x.detail)}</p>${x.value !== undefined && !['uptime', 'db'].includes(x.id) ? `<span class="muted ltr oh-val">${esc(x.value)}</span>` : ''}</section>`).join('')}</div>
      <section class="card"><div class="card-head"><h3>مشخصات سرور</h3></div><dl class="kv">
        <dt>نسخهٔ Node.js</dt><dd class="ltr">${esc(r.server.node)}</dd><dt>حالت اجرا</dt><dd class="ltr">${esc(r.server.env || 'تنظیم نشده')}</dd>
        <dt>زمان کارکرد</dt><dd>${toFa(Math.floor(r.server.uptime_seconds / 3600))} ساعت و ${toFa(Math.floor((r.server.uptime_seconds % 3600) / 60))} دقیقه</dd>
        <dt>حجم پایگاه داده</dt><dd class="num">${toFa((r.server.db_size_bytes / 1024 / 1024).toFixed(1))} مگابایت</dd></dl></section>`;
    $('#hl-refresh', page).addEventListener('click', async (e) => { setBusy(e.target.closest('button'), true, 'در حال بررسی…'); await load(); });
  };
  await load();
}
