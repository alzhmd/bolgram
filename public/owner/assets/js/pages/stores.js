import { faNum, toFa, toman, jDate, jDateTime, ago, esc, emptyState, toast, modal, confirmDialog, setBusy, useStyle, debounce, table, pager, $, $$ } from '/panel/assets/js/core.js';
import { oapi, qs, errText, showError, head, pill, sheet, STORE_STATUS, INVOICE_STATUS, CHANNEL, actionName, showErrors, field } from '../ui.js';

useStyle('o-stores', `
.os-grid{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.os-sec{margin-top:18px}.os-sec h3{margin-bottom:8px}
.os-dot{width:9px;height:9px;border-radius:50%;background:var(--border);flex:none;display:inline-block}.os-dot.on{background:var(--green)}
.os-acts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.os-mini li{align-items:flex-start}
`);

const state = { q: '', status: '', plan: '', sort: 'new', page: 1 };

export async function render(page, { sub, go }) {
  const plans = await oapi('/api/owner/plans').then((r) => r.data).catch(() => []);
  page.innerHTML = `${head('فروشگاه‌ها')}
    <div class="toolbar" role="search">
      <label class="sr-only" for="st-q">جستجو</label><input class="input grow" id="st-q" type="search" placeholder="جستجو: نام فروشگاه، آیدی، موبایل، ایمیل یا شناسه" value="${esc(state.q)}" autocomplete="off">
      <label class="sr-only" for="st-s">وضعیت</label><select class="input select" id="st-s"><option value="">همهٔ وضعیت‌ها</option><option value="ACTIVE">فعال</option><option value="SUSPENDED">معلق</option></select>
      <label class="sr-only" for="st-p">پلن</label><select class="input select" id="st-p"><option value="">همهٔ پلن‌ها</option>${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      <label class="sr-only" for="st-o">مرتب‌سازی</label><select class="input select" id="st-o"><option value="new">جدیدترین</option><option value="volume">بیشترین فروش ۳۰ روز</option></select>
    </div>
    <div id="st-list" aria-live="polite"></div>`;
  $('#st-s', page).value = state.status; $('#st-p', page).value = state.plan; $('#st-o', page).value = state.sort;
  const listEl = $('#st-list', page);
  const load = async () => {
    listEl.innerHTML = '<div class="card"><span class="spinner"></span> در حال بارگذاری…</div>';
    let r;
    try { r = await oapi(`/api/owner/merchants${qs({ q: state.q, status: state.status, plan: state.plan, sort: state.sort === 'volume' ? 'volume' : '', page: state.page, per_page: 20 })}`); } catch (e) { return showError(listEl, e, load); }
    const cols = [
      { title: 'فروشگاه', render: (s) => `<a class="o-link" href="#/stores/${encodeURIComponent(s.id)}"><b>${esc(s.name || s.handle)}</b></a><br><span class="muted ltr" style="font-size:.8rem">@${esc(s.handle || '')}</span>` },
      { title: 'موبایل', render: (s) => `<span class="ltr num">${esc(s.mobile || '—')}</span>` },
      { title: 'وضعیت', render: (s) => pill(STORE_STATUS, s.status) },
      { title: 'پلن', render: (s) => esc(s.plan_name) },
      { title: 'فروش ۳۰ روز', cls: 'num nowrap', render: (s) => `${toman(s.paid_30d_rial)}<br><span class="muted" style="font-size:.78rem">${faNum(s.paid_30d_count)} پرداخت</span>` },
      { title: 'کیف پول', cls: 'num nowrap', render: (s) => (s.wallet_balance_rial === null ? '—' : toman(s.wallet_balance_rial)) },
      { title: 'دستگاه آنلاین', cls: 'num', render: (s) => faNum(s.devices_online) },
      { title: 'کارت', cls: 'num', render: (s) => faNum(s.cards_count) },
      { title: 'عضویت', cls: 'nowrap', render: (s) => (s.created_at ? jDate(s.created_at) : '—') },
    ];
    listEl.innerHTML = r.data.length || state.q || state.status || state.plan ? '' : emptyState('users', 'هنوز فروشگاهی ثبت‌نام نکرده', 'وقتی کسی در پنل ثبت‌نام کند، اینجا دیده می‌شود.');
    if (r.data.length) listEl.insertAdjacentHTML('beforeend', table(cols, r.data, { rowAttr: (s) => `data-id="${esc(s.id)}"` }));
    else if (state.q || state.status || state.plan) listEl.innerHTML = `<div class="card">${emptyState('search', 'فروشگاهی پیدا نشد', 'عبارت جستجو یا فیلترها را تغییر دهید.')}</div>`;
    listEl.appendChild(pager(r, (p) => { state.page = p; load(); }));
    $$('tr[data-id]', listEl).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) go(`/stores/${encodeURIComponent(tr.dataset.id)}`); }));
  };
  const reset = () => { state.page = 1; load(); };
  $('#st-q', page).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); reset(); }, 350));
  $('#st-s', page).addEventListener('change', (e) => { state.status = e.target.value; reset(); });
  $('#st-p', page).addEventListener('change', (e) => { state.plan = e.target.value; reset(); });
  $('#st-o', page).addEventListener('change', (e) => { state.sort = e.target.value; reset(); });
  await load();
  if (sub[0]) openDetail(sub[0], go, load);
}

function openDetail(id, go, refreshList) {
  const sh = sheet({ title: 'جزئیات فروشگاه', body: '<div><span class="spinner"></span> در حال بارگذاری…</div>', onClose: () => go('/stores') });
  const load = async () => {
    let d;
    try { d = await oapi(`/api/owner/merchants/${encodeURIComponent(id)}`); } catch (e) { sh.body.innerHTML = `<div class="alert alert-err" role="alert">${esc(errText(e))}</div>`; return; }
    draw(d);
  };
  const act = async (btn, path, body) => {
    setBusy(btn, true);
    try { await oapi(path, { method: 'POST', body }); return true; } catch (e) { toast(errText(e), 'err'); return false; } finally { setBusy(btn, false); }
  };
  const draw = (d) => {
    const p = d.profile, s = d.stats, base = `/api/owner/merchants/${encodeURIComponent(p.id)}`;
    const trust = d.trust ? { approved: 'تأییدشده', pending: 'در انتظار بررسی', rejected: 'ردشده', draft: 'پیش‌نویس' }[d.trust.status] || d.trust.status : 'ثبت نشده';
    sh.body.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:1.1rem">${esc(p.name || p.handle)}</b>${pill(STORE_STATUS, p.status)}</div>
      <div class="muted ltr" style="margin-bottom:4px">@${esc(p.handle || '')} · ${esc(p.id)}</div>
      ${p.status === 'SUSPENDED' ? `<div class="alert alert-err" style="margin:10px 0">این فروشگاه معلق است${p.suspended_at ? ` (از ${jDate(p.suspended_at)})` : ''}. ${p.suspended_reason ? `دلیل: ${esc(p.suspended_reason)}` : ''}</div>` : ''}
      <div class="os-acts">
        ${p.status === 'SUSPENDED' ? '<button class="btn btn-green btn-sm" type="button" data-act="activate">فعال‌سازی</button>' : '<button class="btn btn-danger btn-sm" type="button" data-act="suspend">تعلیق فروشگاه</button>'}
        <button class="btn btn-sm" type="button" data-act="revoke">خروج همهٔ نشست‌ها</button>
        <a class="btn btn-sm" href="#/wallets?q=${encodeURIComponent(p.handle || p.id)}">کیف پول</a>
        <a class="btn btn-sm" href="#/tickets?q=${encodeURIComponent(p.handle || p.id)}">تیکت‌ها</a>
        <a class="btn btn-sm" href="#/audit?merchant_id=${encodeURIComponent(p.id)}">گزارش فعالیت</a>
      </div>
      <dl class="kv">
        <dt>موبایل</dt><dd><span class="ltr num">${esc(p.mobile || '—')}</span> ${p.mobile_verified ? '<span class="pill ok">تأییدشده</span>' : '<span class="pill warn">تأییدنشده</span>'}</dd>
        <dt>ایمیل</dt><dd class="ltr">${esc(p.email || '—')}</dd>
        <dt>پلن</dt><dd>${esc(p.plan_name)}${p.plan_expires_at ? ` · تا ${jDate(p.plan_expires_at)}` : ''}</dd>
        <dt>عضویت</dt><dd>${p.created_at ? jDateTime(p.created_at) : '—'}</dd>
        <dt>دعوت‌شده توسط</dt><dd>${p.referred_by ? esc(p.referred_by.name || p.referred_by.handle) : '—'}</dd>
        <dt>وب‌هوک</dt><dd>${p.webhook_configured ? 'تنظیم شده' : 'تنظیم نشده'}</dd>
        <dt>نماد اعتماد</dt><dd>${d.trust ? `<a href="#/trust/${encodeURIComponent(p.id)}">${esc(trust)}</a>` : esc(trust)}</dd>
        <dt>همکاران / ربات‌ها</dt><dd>${faNum(d.team_count)} همکار · ${faNum(d.bot_links_count)} ربات متصل</dd>
        <dt>کیف پول</dt><dd class="num">${s.wallet_balance_rial === null ? '—' : toman(s.wallet_balance_rial)}</dd>
      </dl>
      <div class="os-sec"><h3>آمار فروش</h3><div class="os-grid">
        <div class="stat"><b class="num">${toman(s.paid_30d_rial)}</b><span>۳۰ روز اخیر · ${faNum(s.paid_30d_count)} پرداخت</span></div>
        <div class="stat"><b class="num">${toman(s.paid_total_rial)}</b><span>کل · ${faNum(s.paid_total_count)} پرداخت</span></div>
        <div class="stat"><b class="num">${faNum(s.invoices_total)}</b><span>فاکتور · ${faNum(s.open_invoices)} باز</span></div>
        <div class="stat"><b class="num">${faNum(s.held_deposits)}</b><span>واریزی بی‌صاحب${s.last_paid_at ? ` · آخرین پرداخت ${ago(s.last_paid_at)}` : ''}</span></div></div></div>
      <div class="os-sec"><h3>فاکتورهای اخیر</h3>${table([
        { title: 'شناسه', render: (i) => `<span class="ltr" style="font-size:.8rem">${esc(i.id)}</span>` },
        { title: 'مبلغ', cls: 'num', render: (i) => toman(i.amount_rial) },
        { title: 'وضعیت', render: (i) => pill(INVOICE_STATUS, i.status) },
        { title: 'کانال', render: (i) => esc(CHANNEL[i.channel] || i.channel || '—') },
        { title: 'زمان', render: (i) => (i.created_at ? ago(i.created_at) : '—') },
      ], d.recent_invoices, { empty: 'هنوز فاکتوری ساخته نشده' })}</div>
      <div class="os-sec"><h3>دستگاه‌ها</h3>${d.devices.length ? `<ul class="list os-mini">${d.devices.map((v) => `<li><span class="os-dot ${v.online ? 'on' : ''}" aria-hidden="true"></span><span style="flex:1;min-width:0"><b>${esc(v.name || 'دستگاه')}</b> <span class="muted" style="font-size:.8rem">${esc(v.model || '')} ${v.kind === 'ios_shortcut' ? '· شورتکات iOS' : ''}</span><br><span class="muted" style="font-size:.8rem">${v.revoked ? 'ابطال‌شده' : v.last_seen ? `آخرین اتصال ${ago(v.last_seen)}` : 'هنوز متصل نشده'}${v.battery != null ? ` · باتری ${toFa(v.battery)}٪` : ''}</span></span>${v.online ? '<span class="pill ok">آنلاین</span>' : '<span class="pill">آفلاین</span>'}</li>`).join('')}</ul>` : '<p class="muted">دستگاهی متصل نشده است.</p>'}</div>
      <div class="os-sec"><h3>کارت‌های بانکی</h3>${d.cards.length ? `<ul class="list os-mini">${d.cards.map((c) => `<li><span style="flex:1;min-width:0"><b>${esc(c.bank_name)}</b> <span class="ltr num muted">•••• ${esc(c.last4 || '')}</span><br><span class="muted" style="font-size:.8rem">${esc(c.holder || '')}</span></span>${c.active ? '<span class="pill ok">فعال</span>' : '<span class="pill">غیرفعال</span>'}</li>`).join('')}</ul><p class="muted" style="font-size:.8rem">فقط چهار رقم آخر کارت نمایش داده می‌شود.</p>` : '<p class="muted">کارتی ثبت نشده است.</p>'}</div>
      <div class="os-sec"><h3>فعالیت‌های اخیر</h3>${d.audit.length ? `<ul class="timeline">${d.audit.map((a) => `<li><b>${esc(actionName(a.action))}</b><br><span class="muted" style="font-size:.8rem">${jDateTime(a.created_at)}${a.actor_name ? ` · ${esc(a.actor_name)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">فعالیتی ثبت نشده است.</p>'}</div>`;
    sh.body.querySelector('[data-act="activate"]')?.addEventListener('click', async (e) => {
      if (!(await confirmDialog('فعال‌سازی فروشگاه', `فروشگاه «${esc(p.name || p.handle)}» دوباره می‌تواند وارد پنل شود.`, 'فعال‌سازی'))) return;
      if (await act(e.target.closest('button'), `${base}/activate`)) { toast('فروشگاه فعال شد', 'ok'); await load(); refreshList(); }
    });
    sh.body.querySelector('[data-act="revoke"]')?.addEventListener('click', async (e) => {
      if (!(await confirmDialog('خروج همهٔ نشست‌ها', `همهٔ دستگاه‌هایی که با حساب «${esc(p.name || p.handle)}» وارد شده‌اند خارج می‌شوند و باید دوباره وارد شوند.`, 'خروج همه', true))) return;
      if (await act(e.target.closest('button'), `${base}/revoke-sessions`)) { toast('نشست‌ها باطل شد', 'ok'); await load(); }
    });
    sh.body.querySelector('[data-act="suspend"]')?.addEventListener('click', () => {
      const m = modal({
        title: 'تعلیق فروشگاه',
        body: `<p>با تعلیق، «${esc(p.name || p.handle)}» دیگر نمی‌تواند وارد پنل شود و همهٔ نشست‌های فعالش بسته می‌شود. دلیل تعلیق در گزارش فعالیت ثبت می‌شود.</p>
          <form id="sus" novalidate>${field('reason', 'دلیل تعلیق', '<textarea class="input" id="f-reason" name="reason" maxlength="300" rows="3" required></textarea>')}</form>`,
        actions: '<button class="btn" type="button" data-close>انصراف</button><button class="btn btn-danger" type="button" id="sus-ok">تعلیق فروشگاه</button>',
      });
      $('#sus-ok', m.el).addEventListener('click', async (e) => {
        const reason = $('#f-reason', m.el).value.trim();
        if (reason.length < 3) return showErrors(m.el, { reason: 'دلیل تعلیق را بنویسید (حداقل ۳ نویسه)' });
        setBusy(e.target.closest('button'), true);
        try { await oapi(`${base}/suspend`, { method: 'POST', body: { reason } }); m.close(); toast('فروشگاه معلق شد', 'ok'); await load(); refreshList(); }
        catch (err) { setBusy(e.target.closest('button'), false); showErrors(m.el, err.body?.errors || { reason: errText(err) }); }
      });
    });
  };
  load();
}
