import { api, toFa, esc, toast, confirmDialog, setBusy, emptyState, ICON, $, $$, copy, jDateTime } from '../core.js';

const NAMES = { telegram: 'تلگرام', bale: 'بله' };
const ABOUT = {
  telegram: 'پیام‌های غنی با جدول فشرده، دکمه‌های رنگی داخل پیام و کپی یک‌لمسی لینک پرداخت.',
  bale: 'بدون فیلترشکن و از داخل ایران؛ همان منوها به‌صورت متن و دکمهٔ شیشه‌ای.',
};
let timer = null;

export async function renderBots(page) {
  clearInterval(timer);
  page.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
  const d = await api('/api/v2/bots');
  const ready = d.platforms.filter((p) => p.configured);
  page.innerHTML = `
    <div class="page-head"><h1>ربات تلگرام و بله</h1></div>
    <p class="muted" style="margin:0">در پیام‌رسان فاکتور بسازید، کارت‌ها را مدیریت کنید، واریزی‌های بی‌صاحب را بررسی کنید و هر پرداخت تأییدشده را همان لحظه ببینید.</p>
    <div class="grid g2">${d.platforms.map((p) => `
      <section class="card"><div class="card-head">${ICON.bot}<h3>ربات ${NAMES[p.platform]}</h3>
        <span class="pill ${p.configured ? 'ok' : ''}" style="margin-inline-start:auto">${p.configured ? (p.username ? `<span class="ltr">@${esc(p.username)}</span>` : 'فعال') : 'راه‌اندازی نشده'}</span></div>
        <p class="muted" style="margin:0">${ABOUT[p.platform]}</p></section>`).join('')}
    </div>
    <section class="card"><div class="card-head"><h3>اتصال گفتگوی جدید</h3></div>
      ${ready.length ? `<p class="muted" style="margin-top:0">کد یک‌بارمصرف بگیرید و روی دکمهٔ پیام‌رسان بزنید، یا کد را در ربات بفرستید. کد ۱۰ دقیقه اعتبار دارد.</p>
        <div id="code-box"><button class="btn btn-primary" type="button" id="get-code">${ICON.plus} دریافت کد اتصال</button></div>`
        : emptyState('bot', 'رباتی روی سرور فعال نیست', 'مدیر سرویس باید توکن ربات را در تنظیمات سرور (TELEGRAM_BOT_TOKEN یا BALE_BOT_TOKEN) ثبت کند.')}
    </section>
    <section class="card"><div class="card-head"><h3>گفتگوهای متصل</h3></div>
      ${d.links.length ? `<ul class="list">${d.links.map((l) => `<li data-id="${esc(l.id)}">
          <span class="ico" style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand)">${ICON.bot}</span>
          <div style="flex:1;min-width:0"><b>${esc(l.name || 'بدون نام')}</b>${l.username ? ` <span class="ltr muted">@${esc(l.username)}</span>` : ''}
            <div class="muted" style="font-size:.85rem">${NAMES[l.platform] || esc(l.platform)} · متصل از ${jDateTime(l.created_at)}</div></div>
          <label class="check" style="margin:0" title="اعلان پرداخت"><input type="checkbox" data-notify ${l.notify ? 'checked' : ''} aria-label="اعلان پرداخت در این گفتگو"> اعلان</label>
          <button class="btn btn-sm btn-danger" type="button" data-unlink>قطع اتصال</button></li>`).join('')}</ul>`
        : emptyState('bot', 'هنوز گفتگویی وصل نشده', 'بعد از اتصال، هر پرداخت تأییدشده و هر واریزی بی‌صاحب در همان گفتگو اعلام می‌شود.')}
    </section>`;

  $('#get-code', page)?.addEventListener('click', (e) => issueCode(page, e.currentTarget, ready));
  $$('[data-notify]', page).forEach((inp) => inp.addEventListener('change', async () => {
    try { await api(`/api/v2/bots/${inp.closest('li').dataset.id}`, { method: 'PATCH', body: { notify: inp.checked } }); toast(inp.checked ? 'اعلان روشن شد' : 'اعلان خاموش شد', 'ok'); }
    catch (er) { inp.checked = !inp.checked; toast(er.message, 'err'); }
  }));
  $$('[data-unlink]', page).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('قطع اتصال', 'این گفتگو دیگر اعلان نمی‌گیرد و نمی‌تواند فروشگاه را مدیریت کند. ادامه می‌دهید؟', 'قطع اتصال', true))) return;
    try { await api(`/api/v2/bots/${b.closest('li').dataset.id}`, { method: 'DELETE' }); toast('اتصال قطع شد', 'ok'); renderBots(page); } catch (er) { toast(er.message, 'err'); }
  }));
}

async function issueCode(page, btn, ready) {
  setBusy(btn, true, 'در حال ساخت کد…');
  let c;
  try { c = await api('/api/v2/bots/link-code', { method: 'POST' }); } catch (er) { setBusy(btn, false); return toast(er.message, 'err'); }
  const box = $('#code-box', page);
  const pretty = `${c.code.slice(0, 4)}-${c.code.slice(4)}`;
  const open = [['telegram', c.telegram_url], ['bale', c.bale_url]].filter(([p, u]) => u && ready.some((r) => r.platform === p));
  box.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
      <code class="ltr num" style="font-size:1.6rem;font-weight:800;letter-spacing:.12em;padding:8px 14px;border:1px dashed var(--border);border-radius:12px" aria-label="کد اتصال">${pretty}</code>
      <button class="btn" type="button" id="copy-code">کپی کد</button>
      ${open.map(([p, u]) => `<a class="btn btn-primary" href="${esc(u)}" target="_blank" rel="noopener">باز کردن در ${NAMES[p]}</a>`).join('')}
      <span class="muted" id="code-left" aria-live="polite"></span>
    </div>
    <p class="muted" style="margin-bottom:0">بعد از اتصال، این صفحه را دوباره باز کنید تا گفتگو در فهرست پایین دیده شود.</p>`;
  $('#copy-code', box).addEventListener('click', (e) => copy(c.code, e.currentTarget));
  const end = new Date(c.expires_at).getTime();
  const tick = () => {
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    const left = $('#code-left', box);
    if (!left || !document.contains(box)) return clearInterval(timer);
    if (s) return void (left.textContent = `اعتبار: ${toFa(String(Math.floor(s / 60)).padStart(2, '0'))}:${toFa(String(s % 60).padStart(2, '0'))}`);
    clearInterval(timer);
    left.innerHTML = 'کد منقضی شد. <button class="btn btn-sm" type="button" id="new-code">کد تازه</button>';
    $('#new-code', box).addEventListener('click', (e) => issueCode(page, e.currentTarget, ready));
  };
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
}
