/*
 * Live content from the Bolgram API. Loaded by main.js after the page is ready.
 * Reads GET {API_BASE}/api/pub/site, /api/pub/plans and /api/pub/reviews and applies them on top of the static page.
 * Every step is optional: if the API is unreachable or returns nothing, the static HTML stays exactly as it is.
 * All API text is inserted with textContent (never as HTML).
 */
(function () {
  'use strict';
  var S = window.SITE || {};
  var base = String(S.API_BASE || '').replace(/\/+$/, '');
  if (!base || !window.fetch) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var toFa = window.toFa || function (v) { return String(v); };
  var money = function (n) { return toFa(Math.round(n).toLocaleString('en-US').replace(/,/g, '٬')); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var safeUrl = function (u) { return /^https:\/\/[^\s]+$/.test(u || '') || /^\/[A-Za-z0-9\-._~/?#=&%]*$/.test(u || ''); };

  function get(path) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 5000);
    return fetch(base + path, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) { if (timer) clearTimeout(timer); return j && j.success ? j : null; });
  }

  var css = document.createElement('style');
  css.textContent =
    '.live-banner{background:var(--primary-soft);color:var(--ink);border-bottom:1px solid var(--line);font-size:var(--fs-s);padding:8px var(--gutter);text-align:center;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap}' +
    '.live-banner a{font-weight:600;color:var(--primary-text)}' +
    '.live-banner button{background:none;border:0;color:inherit;cursor:pointer;font:inherit;padding:2px 8px;border-radius:6px}' +
    '.live-reviews{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}' +
    '.live-review{background:var(--card);border:1px solid var(--line);border-radius:var(--r-l);padding:20px;display:flex;flex-direction:column;gap:8px;margin:0}' +
    '.live-review .stars{color:var(--amber);letter-spacing:2px;direction:ltr;text-align:start}' +
    '.live-review blockquote{margin:0;overflow-wrap:anywhere}' +
    '.live-review figcaption{color:var(--muted);font-size:var(--fs-s)}' +
    '.live-review .reply{border-inline-start:3px solid var(--primary);padding-inline-start:10px;color:var(--ink-2);font-size:var(--fs-s);overflow-wrap:anywhere}';
  document.head.appendChild(css);

  /* ---------- site content: banner, hero, contact, logo, FAQ, footer ---------- */
  function applySite(site) {
    if (!site) return;
    var h = site.hero || {};
    if (h.title) $$('[data-k="hero.title"]').forEach(function (n) { n.textContent = h.title; });
    if (h.subtitle) $$('[data-k="hero.sub"]').forEach(function (n) { n.textContent = h.subtitle; });
    if (site.footer) $$('[data-k="footer.about"]').forEach(function (n) { n.textContent = site.footer; });

    var a = site.announcement;
    var key = a ? 'bg_banner_' + a.text.length + '_' + a.text.slice(0, 24) : '';
    var closed = false;
    try { closed = !!key && sessionStorage.getItem(key) === '1'; } catch (e) { /* storage blocked */ }
    if (a && a.text && !closed) {
      var b = el('div', 'live-banner');
      b.setAttribute('role', 'region');
      b.setAttribute('aria-label', 'اعلان');
      b.appendChild(el('span', '', a.text));
      if (a.href && safeUrl(a.href)) { var l = el('a', '', 'بیشتر بدانید'); l.href = a.href; if (/^https:/.test(a.href)) l.rel = 'noopener'; b.appendChild(l); }
      var x = el('button', '', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'بستن اعلان');
      x.addEventListener('click', function () { b.remove(); try { sessionStorage.setItem(key, '1'); } catch (e) { /* storage blocked */ } });
      b.appendChild(x);
      var header = $('.site-header');
      if (header && header.parentNode) header.parentNode.insertBefore(b, header);
    }

    var c = site.contact || {};
    if (c.email) $$('a[href^="mailto:"]').forEach(function (n) {
      var old = n.getAttribute('href').replace(/^mailto:/, '').split('?')[0];
      n.setAttribute('href', 'mailto:' + c.email);
      if (n.textContent.trim() === old) n.textContent = c.email;
    });
    if (c.telegram && safeUrl(c.telegram)) $$('[data-href="SUPPORT_TELEGRAM"]').forEach(function (n) { n.href = c.telegram; n.rel = 'noopener'; });
    var slot = function (name) { return $('[data-live="' + name + '"]'); };
    var s = slot('phone');
    if (s && c.phone) { var pa = $('a', s); pa.textContent = c.phone; pa.href = 'tel:' + c.phone.replace(/[^\d+]/g, ''); s.hidden = false; }
    s = slot('instagram');
    if (s && c.instagram && safeUrl(c.instagram)) { var ia = $('a', s); ia.href = c.instagram; ia.textContent = c.instagram.replace(/^https:\/\/(www\.)?instagram\.com\//, '@'); s.hidden = false; }
    s = slot('address');
    if (s && c.address) { $('span', s).textContent = c.address; s.hidden = false; }

    if (site.logo_url && /^https:\/\//.test(site.logo_url)) $$('[data-img="logo"]').forEach(function (i) { i.src = site.logo_url; });

    if (site.faq && site.faq.length) {
      var first = $('.faq-item');
      var box = first && first.parentNode;
      if (box) {
        $$('.faq-item', box).forEach(function (n) { n.remove(); });
        site.faq.forEach(function (f, i) {
          var item = el('div', 'faq-item'), h3 = el('h3'), btn = el('button', '', f.q);
          btn.type = 'button'; btn.id = 'lfaq-q' + i; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'lfaq-a' + i);
          btn.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
          var ans = el('div', 'ans'); ans.id = 'lfaq-a' + i; ans.setAttribute('role', 'region'); ans.setAttribute('aria-labelledby', btn.id); ans.hidden = true;
          ans.appendChild(el('p', '', f.a));
          btn.addEventListener('click', function () { var open = btn.getAttribute('aria-expanded') === 'true'; btn.setAttribute('aria-expanded', String(!open)); ans.hidden = open; });
          h3.appendChild(btn); item.appendChild(h3); item.appendChild(ans); box.appendChild(item);
        });
      }
    }
  }

  /* ---------- pricing: real plans from the panel ---------- */
  function applyPlans(res) {
    var plansEl = $('#plans');
    if (!plansEl || !res || !res.data || !res.data.length) return;
    var plans = res.data.filter(function (p) { return p && p.name; });
    if (!plans.length) return;
    var disc = (res.discounts && res.discounts.length ? res.discounts : [{ months: 1, percent: 0 }]);
    var period = disc[0];
    var aud = $('#audience'); if (aud) aud.hidden = true;
    var oldPeriods = $('#periods');
    var periodsEl = oldPeriods; // a clone drops the static handlers, which would redraw the sample plans
    if (oldPeriods) { periodsEl = oldPeriods.cloneNode(false); oldPeriods.replaceWith(periodsEl); }
    var note = $('.sample-note');
    if (note) note.textContent = 'اشتراک از موجودی کیف پول پرداخت می‌شود. کارمزد هر پرداخت موفق جدا و بر اساس پلن محاسبه می‌شود.';
    var lim = function (v) { return v === null || v === undefined ? 'نامحدود' : toFa(v); };
    var feeText = function (p) {
      var t = toFa(p.fee_percent) + '٪ از هر پرداخت';
      var parts = [];
      if (p.fee_min_toman) parts.push('حداقل ' + money(p.fee_min_toman) + ' تومان');
      if (p.fee_max_toman) parts.push('حداکثر ' + money(p.fee_max_toman) + ' تومان');
      return p.fee_percent ? 'کارمزد ' + t + (parts.length ? ' (' + parts.join('، ') + ')' : '') : 'بدون کارمزد تراکنش';
    };
    var draw = function () {
      plansEl.textContent = '';
      plans.forEach(function (p) {
        var monthly = p.monthly_price_toman * (1 - period.percent / 100);
        var card = el('article', 'plan' + (p.highlighted ? ' featured' : ''));
        if (p.highlighted) { var bd = el('span', 'badge badge-ok', 'پیشنهاد ما'); bd.style.cssText = 'align-self:flex-start;margin:0 0 8px'; card.appendChild(bd); }
        card.appendChild(el('h3', '', p.name));
        if (p.description) card.appendChild(el('p', 'muted', p.description));
        var price = el('p', 'price num', p.monthly_price_toman ? money(monthly) + ' ' : 'رایگان');
        if (p.monthly_price_toman) { var sm = el('small', '', 'تومان'); sm.style.cssText = 'font-size:.9rem;font-weight:600'; price.appendChild(sm); }
        card.appendChild(price);
        if (p.monthly_price_toman) card.appendChild(el('span', 'per', 'در ماه' + (period.months > 1 ? ' — پرداخت ' + toFa(period.months) + ' ماهه: ' + money(monthly * period.months) + ' تومان' : '')));
        var ul = el('ul');
        ul.appendChild(el('li', '', feeText(p)));
        ul.appendChild(el('li', '', lim(p.limits.cards) + ' کارت بانکی · ' + lim(p.limits.links) + ' لینک پرداخت'));
        ul.appendChild(el('li', '', lim(p.limits.team) + ' همکار · ' + lim(p.limits.devices) + ' دستگاه'));
        (p.features || []).forEach(function (f) { ul.appendChild(el('li', '', f)); });
        card.appendChild(ul);
        var cta = el('a', 'btn ' + (p.highlighted ? 'btn-primary' : 'btn-ghost'), 'شروع رایگان');
        cta.href = S.SIGNUP_URL || '#';
        card.appendChild(cta);
        plansEl.appendChild(card);
      });
      calc();
    };
    if (periodsEl) disc.forEach(function (d, i) {
      var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(i === 0));
      b.textContent = (d.months === 1 ? 'ماهانه' : toFa(d.months) + ' ماهه') + (d.percent ? ' ' : '');
      if (d.percent) b.appendChild(el('small', '', toFa(d.percent) + '٪ تخفیف'));
      b.addEventListener('click', function () { period = d; $$('button', periodsEl).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); draw(); });
      periodsEl.appendChild(b);
    });
    // cost calculator on the real model: plan price + a clamped percentage fee on every payment
    var txIn = $('#calc-tx'), amtIn = $('#calc-amt'), out = $('#calc-out');
    var calc = function () {
      if (!txIn || !amtIn || !out) return;
      var tx = Math.max(0, Number(String(txIn.value).replace(/[^\d]/g, '')) || 0);
      var amt = Math.max(0, Number(String(amtIn.value).replace(/[^\d]/g, '')) || 0);
      var best = null;
      plans.forEach(function (p) {
        var fee = amt * p.fee_percent / 100;
        fee = Math.max(p.fee_min_toman || 0, fee);
        if (p.fee_max_toman) fee = Math.min(p.fee_max_toman, fee);
        var total = p.monthly_price_toman * (1 - period.percent / 100) + fee * tx;
        if (!best || total < best.total) best = { p: p, total: total };
      });
      if (!best) return;
      var share = tx * amt ? (best.total / (tx * amt)) * 100 : 0;
      out.textContent = '';
      out.appendChild(el('span', 'muted', 'هزینه تقریبی ماهانه'));
      out.appendChild(el('b', 'num', money(best.total) + ' تومان'));
      out.appendChild(el('span', 'muted', 'ارزان‌ترین گزینه: پلن «' + best.p.name + '»' + (share ? ' · حدود ' + toFa(share.toFixed(2)) + '٪ از فروش' : '')));
    };
    if (txIn) txIn.addEventListener('input', calc);
    if (amtIn) amtIn.addEventListener('input', calc);
    draw();
  }

  /* ---------- testimonials: approved store reviews ---------- */
  function applyReviews(res) {
    var sec = $('#testimonials');
    if (!sec || !res || !res.data || !res.data.length) return;
    sec.textContent = '';
    var wrap = el('div', 'wrap');
    var head = el('div', 'section-head');
    var h2 = el('h2', '', 'نظر فروشندگان'); h2.id = 'rev-title';
    head.appendChild(h2);
    var sum = res.summary || {};
    if (sum.count) head.appendChild(el('p', '', 'میانگین امتیاز ' + toFa(sum.average) + ' از ۵، بر پایهٔ ' + toFa(sum.count) + ' نظر فروشندگانی که با بولگرام کار می‌کنند.'));
    wrap.appendChild(head);
    var grid = el('div', 'live-reviews');
    res.data.slice(0, 6).forEach(function (r) {
      var rating = Math.max(0, Math.min(5, Number(r.rating) || 0));
      var fig = el('figure', 'live-review');
      var st = el('div', 'stars', '★'.repeat(rating) + '☆'.repeat(5 - rating)); st.setAttribute('role', 'img'); st.setAttribute('aria-label', toFa(rating) + ' از ۵');
      fig.appendChild(st);
      fig.appendChild(el('blockquote', '', r.text));
      fig.appendChild(el('figcaption', '', r.name));
      if (r.reply) fig.appendChild(el('div', 'reply', 'پاسخ بولگرام: ' + r.reply));
      grid.appendChild(fig);
    });
    wrap.appendChild(grid);
    sec.appendChild(wrap);
    sec.setAttribute('aria-labelledby', 'rev-title');
    sec.removeAttribute('aria-hidden');
    sec.hidden = false;
  }

  var wantsPlans = !!$('#plans'), wantsReviews = !!$('#testimonials');
  get('/api/pub/site').then(function (r) { if (r) applySite(r.site); });
  if (wantsPlans) get('/api/pub/plans').then(applyPlans);
  if (wantsReviews) get('/api/pub/reviews?limit=6').then(applyReviews);
})();
