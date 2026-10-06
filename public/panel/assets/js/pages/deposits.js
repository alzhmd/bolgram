// Held deposits: bank SMS that matched no open invoice (or came from an unknown sender). The merchant checks the bank
// app, then links the deposit to an invoice or rejects it. Fake deposit SMS is the main card-to-card fraud.
import { api, esc, faNum, toman, jDateTime, ago, $, $$, toast, modal, setBusy, emptyState, ICON, pager, useStyle } from '../core.js';

const TABS = [['open', 'در انتظار بررسی'], ['assigned', 'وصل‌شده به فاکتور'], ['rejected', 'ردشده']];
const REASONS = ['پیامک جعلی است؛ این مبلغ به حسابم نیامده', 'واریز تکراری است', 'مربوط به فروش نیست (واریز شخصی)'];
const INV_STATUS = { PENDING: ['در انتظار پرداخت', 'warn'], EXPIRED: ['منقضی', ''], CANCELLED: ['لغوشده', 'bad'] };

const CSS = `
.dep-page{display:flex;flex-direction:column;gap:16px;min-width:0}
.dep-warn{display:flex;gap:12px;align-items:flex-start;line-height:1.9}
.dep-warn>svg{width:24px;height:24px;flex:none;margin-top:2px}
.dep-warn p{margin:2px 0 0;color:var(--fg)}
.dep-list{display:grid;gap:12px}
.dep-item{display:grid;gap:12px}
.dep-item.dep-risk{border-color:color-mix(in srgb,var(--red) 45%,var(--border))}
.dep-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dep-amt{font-size:1.5rem;font-weight:800;line-height:1.2}
.dep-amt small{font-size:.85rem;font-weight:600;color:var(--muted)}
.dep-top .pill{margin-inline-start:auto}
.dep-top .pill svg{width:14px;height:14px}
.dep-kv{grid-template-columns:minmax(100px,auto) 1fr;font-size:.9rem}
.dep-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid var(--border);padding-top:12px}
.dep-foot .grow{flex:1;min-width:200px;font-size:.9rem}
.dep-item details summary{cursor:pointer;font-weight:600;font-size:.9rem;color:var(--muted)}
.sms-raw{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin:10px 0 0;font-family:inherit;font-size:.88rem;line-height:1.9}
.tabs .cnt{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:var(--surface-2);font-size:.75rem;margin-inline-start:6px}
.tabs [aria-selected="true"] .cnt{background:var(--brand-soft)}
.cand-list{display:grid;gap:8px;margin:0;padding:0;border:0}
.cand-list legend{font-weight:600;font-size:.92rem;margin-bottom:8px;padding:0}
.cand{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:10px 12px;cursor:pointer;background:var(--surface-2)}
.cand:has(input:checked){border-color:var(--brand);background:var(--brand-soft)}
.cand input{width:18px;height:18px;accent-color:var(--brand);flex:none}
.cand .c-main{flex:1;min-width:0}
.cand .c-id{font-size:.82rem;font-weight:700}
.cand .c-note{font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cand .c-amt{text-align:end;flex:none}
.cand .c-amt b{display:block}
.dep-sum{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:12px}
.dep-sum b{font-size:1.25rem}
.reasons{display:grid;gap:8px;margin:0 0 12px;padding:0;border:0}
`;

let pollTimer = null;

export async function render(page, { query }) {
  useStyle('deposits', CSS);
  const state = { status: TABS.some(([v]) => v === query.get('status')) ? query.get('status') : 'open', page: Math.max(1, Number(query.get('page')) || 1) };
  const root = document.createElement('div');
  root.className = 'dep-page';
  page.replaceChildren(root);
  root.innerHTML = `
    <div class="page-head"><h1>واریزی‌های بی‌صاحب</h1><span class="muted">واریزهایی که خودکار به هیچ فاکتوری وصل نشدند</span></div>
    <div class="alert alert-warn dep-warn" role="note">${ICON.shield}<div><b>قبل از هر تأیید، حساب بانکی خودتان را نگاه کنید.</b>
      <p>رایج‌ترین کلاهبرداری در کارت‌به‌کارت «پیامک جعلی واریز» است. فقط وقتی تأیید کنید که در اپ بانک یا اینترنت‌بانک دیدید این مبلغ واقعاً به حسابتان نشسته. پیامکی که با برچسب «فرستندهٔ ناشناس» آمده، تقریباً همیشه جعلی است.</p></div></div>
    <div class="tabs" role="tablist" aria-label="وضعیت واریزی‌ها">${TABS.map(([v, t]) => `<button type="button" role="tab" id="tab-${v}" aria-controls="dep-list" data-tab="${v}" aria-selected="${state.status === v}">${t}<span class="cnt num" data-cnt="${v}">…</span></button>`).join('')}</div>
    <div id="dep-list" class="dep-list" role="tabpanel" aria-labelledby="tab-${state.status}" aria-live="polite"><div class="card"><span class="spinner"></span> در حال بارگذاری…</div></div>`;
  const listEl = $('#dep-list', root);
  let seq = 0, lastKey = '';

  const commit = () => {
    const p = new URLSearchParams();
    if (state.status !== 'open') p.set('status', state.status);
    if (state.page > 1) p.set('page', state.page);
    const url = `#/deposits${p.toString() ? '?' + p : ''}`;
    if (url !== location.hash) history.pushState(null, '', url);
    load();
  };

  async function load({ quiet = false } = {}) {
    const my = ++seq;
    let r;
    try { r = await api(`/api/v2/deposits?status=${state.status}&page=${state.page}&per_page=20`); }
    catch (e) {
      if (my !== seq || quiet) return;
      listEl.innerHTML = `<div class="card"><div class="alert alert-err" role="alert">${esc(e.body?.message || e.message)}</div><button class="btn" style="margin-top:12px" type="button" id="dep-retry">تلاش دوباره</button></div>`;
      return $('#dep-retry', listEl).addEventListener('click', () => load());
    }
    if (my !== seq) return;
    for (const [v] of TABS) $(`[data-cnt="${v}"]`, root).textContent = faNum(r.counts[v] || 0);
    const key = JSON.stringify([state, r.data.map((d) => d.id + d.status), r.total]);
    if (quiet && key === lastKey) return;
    lastKey = key;
    if (!r.data.length && r.total && state.page > 1) { state.page = 1; return commit(); }
    paint(r);
  }

  function paint(r) {
    if (!r.data.length) {
      const empty = {
        open: emptyState('check', 'واریزی بی‌صاحبی ندارید', 'هر واریزی که با هیچ فاکتور بازی جور نشود، یا پیامکش از فرستندهٔ ناشناس بیاید، اینجا می‌ماند تا خودتان بررسی کنید.', '<a class="btn" href="#/invoices">رفتن به فاکتورها</a>'),
        assigned: emptyState('receipt', 'هنوز واریزی را دستی وصل نکرده‌اید', 'واریزهایی که از اینجا به فاکتور وصل کنید، در این بخش می‌مانند.'),
        rejected: emptyState('inbox', 'واریزی رد نشده است', 'واریزهایی که رد کنید، با دلیل و نام ردکننده اینجا ثبت می‌شوند.'),
      }[state.status];
      listEl.innerHTML = `<div class="card">${empty}</div>`;
      return;
    }
    listEl.innerHTML = r.data.map(item).join('');
    if (r.total > r.per_page) listEl.appendChild(pager(r, (p) => { state.page = p; commit(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    $$('[data-approve]', listEl).forEach((b) => b.addEventListener('click', () => approveFlow(r.data.find((d) => d.id === b.dataset.approve), b)));
    $$('[data-reject]', listEl).forEach((b) => b.addEventListener('click', () => rejectFlow(r.data.find((d) => d.id === b.dataset.reject))));
  }

  function item(d) {
    const badge = d.trusted === false
      ? `<span class="pill bad">${ICON.alert} فرستندهٔ ناشناس — احتمال جعل</span>`
      : d.trusted ? `<span class="pill ok">${ICON.check} فرستندهٔ شناخته‌شدهٔ بانک</span>` : '';
    const by = [d.handled_by ? `توسط ${esc(d.handled_by)}` : '', d.handled_at ? `<span class="num">${jDateTime(d.handled_at)}</span>` : ''].filter(Boolean).join(' · ');
    const foot = d.status === 'open'
      ? d.already_used
        ? `<div class="grow alert alert-warn">این واریز قبلاً برای <span class="ltr">${esc(d.used_by || 'سفارش دیگری')}</span> ثبت شده و دوباره قابل استفاده نیست. آن را رد کنید.</div><button class="btn btn-danger" type="button" data-reject="${esc(d.id)}">رد</button>`
        : `<span class="grow muted">${d.trusted === false ? 'اول در اپ بانک مطمئن شوید این پول واقعاً رسیده است.' : 'فاکتوری با دقیقاً همین مبلغ باز نبود؛ اگر پول رسیده، به فاکتور درست وصلش کنید.'}</span>
           <button class="btn btn-danger" type="button" data-reject="${esc(d.id)}">رد</button><button class="btn btn-primary" type="button" data-approve="${esc(d.id)}">${ICON.link} اتصال به فاکتور</button>`
      : d.status === 'assigned'
        ? `<span class="grow"><span class="pill ok">وصل شد</span> به فاکتور <a class="ltr" href="#/invoices/${encodeURIComponent(d.invoice_id || '')}">${esc(d.invoice_id || '')}</a>${by ? ` · <span class="muted">${by}</span>` : ''}</span>`
        : `<span class="grow"><span class="pill bad">رد شد</span> ${d.reject_reason ? esc(d.reject_reason) : ''}${by ? ` · <span class="muted">${by}</span>` : ''}</span>`;
    return `<article class="card dep-item ${d.status === 'open' && d.trusted === false ? 'dep-risk' : ''}" aria-label="واریز ${faNum(d.amount_toman)} تومان">
      <div class="dep-top"><div class="dep-amt num">${faNum(d.amount_toman)} <small>تومان</small></div>${badge}</div>
      <dl class="kv dep-kv">
        <dt>بانک</dt><dd>${esc(d.bank_name || '—')}</dd>
        <dt>زمان پیامک</dt><dd><span class="num">${d.created_at ? jDateTime(d.created_at) : '—'}</span> <span class="muted">${d.created_at ? `(${ago(d.created_at)})` : ''}</span></dd>
        <dt>فرستندهٔ پیامک</dt><dd><span class="ltr num">${esc(d.sender || 'نامشخص')}</span></dd>
        ${d.payer_last4 ? `<dt>کارت واریزکننده</dt><dd><span class="ltr num">**** ${esc(d.payer_last4)}</span></dd>` : ''}
        <dt>کد پیگیری</dt><dd><span class="ltr num">${esc(d.trx_id || '—')}</span></dd>
        ${d.device_name ? `<dt>گوشی</dt><dd>${esc(d.device_name)}</dd>` : ''}
      </dl>
      ${d.raw_sms ? `<details><summary>متن کامل پیامک</summary><pre class="sms-raw">${esc(d.raw_sms)}</pre></details>` : ''}
      <div class="dep-foot">${foot}</div>
    </article>`;
  }

  const summary = (d) => `<div class="dep-sum"><b class="num">${toman(d.amount_rial)}</b><span class="muted">${esc(d.bank_name || '')} · <span class="num">${d.created_at ? jDateTime(d.created_at) : ''}</span></span></div>`;
  const diffBadge = (diffRial) => {
    if (!diffRial) return '<span class="pill ok">دقیقاً برابر</span>';
    const t = faNum(Math.abs(diffRial) / 10);
    return diffRial > 0 ? `<span class="pill bad">${t} تومان کمتر واریز شده</span>` : `<span class="pill warn">${t} تومان بیشتر واریز شده</span>`;
  };

  async function approveFlow(d, btn) {
    if (!d) return;
    setBusy(btn, true, 'در حال یافتن فاکتورها…');
    let c;
    try { c = await api(`/api/v2/deposits/${encodeURIComponent(d.id)}/candidates`); }
    catch (e) { setBusy(btn, false); toast(e.body?.message || e.message, 'err'); if (e.status === 409 || e.status === 404) load(); return; }
    setBusy(btn, false);
    const m = modal({
      title: 'اتصال واریز به فاکتور',
      wide: true,
      body: `<form id="ap-form" novalidate>
        ${summary(d)}
        ${d.trusted === false ? `<div class="alert alert-err" style="margin-bottom:12px">این پیامک از <b>فرستندهٔ ناشناس</b> آمده و به احتمال زیاد جعلی است. فقط اگر در اپ بانک همین واریز را دیدید، ادامه دهید.</div>` : ''}
        <fieldset class="cand-list"><legend>فاکتورهای نزدیک به این مبلغ (۲۴ ساعت اخیر)</legend>
          ${c.invoices.length ? c.invoices.map((x, i) => `<label class="cand"><input type="radio" name="inv" value="${esc(x.id)}" ${i === 0 && !x.difference_rial ? 'checked' : ''}>
            <span class="c-main"><span class="c-id ltr">${esc(x.id)}</span> ${INV_STATUS[x.status] ? `<span class="pill ${INV_STATUS[x.status][1]}">${INV_STATUS[x.status][0]}</span>` : ''}
              <span class="c-note muted" style="display:block">${esc(x.note || 'بدون توضیح')} · ${ago(x.created_at)}</span></span>
            <span class="c-amt"><b class="num">${toman(x.amount_rial)}</b>${diffBadge(x.difference_rial)}</span></label>`).join('')
            : '<p class="muted" style="margin:0">در ۲۴ ساعت اخیر فاکتور پرداخت‌نشده‌ای نیست. شمارهٔ فاکتور را خودتان وارد کنید.</p>'}
        </fieldset>
        <div class="field" style="margin-top:14px"><label for="ap-id">یا شمارهٔ فاکتور را وارد کنید</label><input class="input ltr" id="ap-id" maxlength="64" autocomplete="off" placeholder="INV…"><div class="hint">برای فاکتورهای قدیمی‌تر یا وقتی فاکتور در فهرست بالا نیست.</div></div>
        <label class="check"><input type="checkbox" id="ap-ok"> <span>در اپ یا اینترنت‌بانک خودم دیدم که <b class="num">${toman(d.amount_rial)}</b> به حسابم نشسته است.</span></label>
        <div class="err" id="ap-err" role="alert" style="margin-top:10px;color:var(--red);font-size:.88rem"></div>
        <div class="modal-actions"><button class="btn" type="button" data-close>انصراف</button><button class="btn btn-green" type="submit" id="ap-go" disabled>تأیید و ثبت پرداخت</button></div>
      </form>`,
    });
    const f = $('#ap-form', m.el), go = $('#ap-go', m.el), ok = $('#ap-ok', m.el), manual = $('#ap-id', m.el), err = $('#ap-err', m.el);
    const chosen = () => manual.value.trim() || $('input[name="inv"]:checked', m.el)?.value || '';
    const sync = () => { go.disabled = !(ok.checked && chosen()); };
    manual.addEventListener('input', () => { if (manual.value.trim()) $$('input[name="inv"]', m.el).forEach((x) => (x.checked = false)); sync(); });
    $$('input[name="inv"]', m.el).forEach((x) => x.addEventListener('change', () => { manual.value = ''; sync(); }));
    ok.addEventListener('change', sync);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const invoiceId = chosen();
      if (!invoiceId || !ok.checked) return;
      err.textContent = '';
      setBusy(go, true, 'در حال ثبت…');
      try {
        const r = await api(`/api/v2/deposits/${encodeURIComponent(d.id)}/approve`, { method: 'POST', body: { invoice_id: invoiceId } });
        m.close();
        toast(`واریز به فاکتور ${r.invoice.id} وصل شد و فاکتور پرداخت‌شده ثبت شد`, 'ok');
        window.dispatchEvent(new CustomEvent('data-changed'));
        load();
      } catch (er) {
        setBusy(go, false); sync();
        err.textContent = er.body?.errors?.invoice_id || er.body?.message || er.message;
        if (er.body?.error === 'already_handled' || er.body?.error === 'already_used') load();
      }
    });
  }

  function rejectFlow(d) {
    if (!d) return;
    const m = modal({
      title: 'رد واریزی',
      body: `<form id="rj-form" novalidate>
        ${summary(d)}
        <fieldset class="reasons"><legend class="sr-only">دلیل رد</legend>
          ${[...REASONS, 'دلیل دیگر'].map((t, i) => `<label class="check"><input type="radio" name="rs" value="${i}" ${i === (d.trusted === false || d.already_used ? (d.already_used ? 1 : 0) : 0) ? 'checked' : ''}> <span>${t}</span></label>`).join('')}
        </fieldset>
        <div class="field hidden" id="rj-other"><label for="rj-text">دلیل</label><textarea class="input" id="rj-text" maxlength="200" rows="3"></textarea></div>
        <p class="muted" style="font-size:.85rem;margin:0">رد کردن پولی را جابه‌جا نمی‌کند؛ فقط این مورد از صف بررسی خارج می‌شود. اگر واریز واقعی است و مشتری پولش را می‌خواهد، از اپ بانک خودتان برگردانید.</p>
        <div class="err" id="rj-err" role="alert" style="margin-top:10px;color:var(--red);font-size:.88rem"></div>
        <div class="modal-actions"><button class="btn" type="button" data-close>انصراف</button><button class="btn btn-danger" type="submit" id="rj-go">رد واریزی</button></div>
      </form>`,
    });
    const f = $('#rj-form', m.el), other = $('#rj-other', m.el), text = $('#rj-text', m.el), err = $('#rj-err', m.el);
    $$('input[name="rs"]', m.el).forEach((x) => x.addEventListener('change', () => { other.classList.toggle('hidden', x.value !== String(REASONS.length) || !x.checked); if (!other.classList.contains('hidden')) text.focus(); }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pick = Number($('input[name="rs"]:checked', m.el)?.value ?? 0);
      const reason = pick < REASONS.length ? REASONS[pick] : text.value.trim();
      if (reason.length < 2) { err.textContent = 'دلیل رد را بنویسید'; text.setAttribute('aria-invalid', 'true'); return text.focus(); }
      const go = $('#rj-go', m.el);
      setBusy(go, true, 'در حال ثبت…');
      try {
        await api(`/api/v2/deposits/${encodeURIComponent(d.id)}/reject`, { method: 'POST', body: { reason } });
        m.close();
        toast('واریزی رد شد', 'ok');
        window.dispatchEvent(new CustomEvent('data-changed'));
        load();
      } catch (er) {
        setBusy(go, false);
        err.textContent = er.body?.errors?.reason || er.body?.message || er.message;
        if (er.status === 409) load();
      }
    });
  }

  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === state.status) return;
    state.status = b.dataset.tab; state.page = 1;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    listEl.setAttribute('aria-labelledby', b.id);
    commit();
  }));
  $('.tabs', root).addEventListener('keydown', (e) => {
    const tabs = $$('[data-tab]', root), i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const n = tabs[(i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length]; // RTL: left = next
    n.focus(); n.click(); e.preventDefault();
  });

  // New held deposits show up without a reload while the page is open.
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!root.isConnected) return clearInterval(pollTimer);
    if (document.hidden || document.querySelector('.overlay') || state.status !== 'open') return;
    load({ quiet: true });
  }, 30_000);

  await load();
}
