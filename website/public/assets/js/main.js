/* Bolgram site interactions. No dependencies. Loaded with defer. */
(function () {
  'use strict';
  var S = window.SITE || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var FA = '۰۱۲۳۴۵۶۷۸۹';
  function toFa(v) { return String(v).replace(/\d/g, function (d) { return FA[d]; }); }
  function money(n) { return toFa(Math.round(n).toLocaleString('en-US').replace(/,/g, '٬')); }
  window.toFa = toFa;

  /* ---------- theme ---------- */
  var root = document.documentElement;
  function applyTheme(t) {
    root.dataset.theme = t;
    $$('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', String(t === 'dark')); });
  }
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', next); } catch (e) {}
      applyTheme(next);
    });
  });
  applyTheme(root.dataset.theme || 'light');

  /* ---------- config-driven links ---------- */
  $$('[data-href]').forEach(function (a) { var v = S[a.dataset.href]; if (v) a.href = v; });
  $$('[data-store]').forEach(function (a) {
    var url = (S.APP_LINKS || {})[a.dataset.store];
    if (url) { a.href = url; a.removeAttribute('aria-disabled'); var b = $('.badge', a); if (b) b.remove(); }
    else { a.setAttribute('aria-disabled', 'true'); a.removeAttribute('href'); }
  });
  $$('[data-year]').forEach(function (el) { el.textContent = toFa(el.dataset.year); });

  /* ---------- editable content (admin panel writes assets/content/content.json) ---------- */
  if (window.fetch) {
    fetch('/assets/content/content.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) {
        $$('[data-k]').forEach(function (el) { if (typeof c[el.dataset.k] === 'string') el.textContent = c[el.dataset.k]; });
        if (c['img.logo']) $$('[data-img="logo"]').forEach(function (i) { i.src = c['img.logo']; });
      })
      .catch(function () {});
  }

  /* ---------- mobile menu ---------- */
  var menu = $('#mobile-menu');
  var openBtn = $('[data-menu-open]');
  function setMenu(open) {
    if (!menu) return;
    menu.dataset.open = String(open);
    openBtn && openBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) { var f = $('a,button', menu); f && f.focus(); } else openBtn && openBtn.focus();
  }
  openBtn && openBtn.addEventListener('click', function () { setMenu(true); });
  $$('[data-menu-close], #mobile-menu a').forEach(function (b) { b.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu && menu.dataset.open === 'true') setMenu(false); });

  /* ---------- bank marquee ---------- */
  var track = $('.marquee-track');
  if (track && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    track.innerHTML += track.innerHTML.replace(/<li/g, '<li aria-hidden="true"');
  }
  var mq = $('.marquee'), mqBtn = $('[data-marquee-toggle]');
  mqBtn && mqBtn.addEventListener('click', function () {
    var p = mq.dataset.paused === 'true';
    mq.dataset.paused = String(!p);
    mqBtn.textContent = p ? 'توقف حرکت' : 'ادامه حرکت';
    mqBtn.setAttribute('aria-pressed', String(!p));
  });

  /* ---------- generic tabs (role=tablist) ---------- */
  $$('[role="tablist"]').forEach(function (list) {
    var tabs = $$('[role="tab"]', list);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) p.hidden = !on;
      });
      if (focus) tab.focus();
      list.dispatchEvent(new CustomEvent('tabchange', { detail: tab }));
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, n = tabs.length;
        // RTL: ArrowLeft moves forward
        if (k === 'ArrowLeft') select(tabs[(i + 1) % n], true);
        else if (k === 'ArrowRight') select(tabs[(i - 1 + n) % n], true);
        else if (k === 'Home') select(tabs[0], true);
        else if (k === 'End') select(tabs[n - 1], true);
        else return;
        e.preventDefault();
      });
    });
  });

  /* ---------- copy buttons ---------- */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var src = document.getElementById(b.dataset.copy);
      var text = src ? src.innerText : '';
      var done = function () { var o = b.textContent; b.textContent = 'کپی شد ✓'; setTimeout(function () { b.textContent = o; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
    });
  });

  /* ---------- accordion ---------- */
  $$('.faq-item button').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open));
      document.getElementById(b.getAttribute('aria-controls')).hidden = open;
    });
  });

  /* ---------- hero demo ---------- */
  var demo = $('#demo');
  if (demo) {
    var live = $('#demo-live'), dots = $$('.demo-steps li', demo), timers = [];
    var msgs = ['فاکتور ساخته شد؛ مبلغ یکتا رزرو شد.', 'پیامک واریز بانک رسید.', 'مبلغ با فاکتور تطبیق خورد؛ پرداخت تأیید شد.'];
    var setStep = function (n) {
      demo.dataset.step = String(n);
      dots.forEach(function (d, i) { d.classList.toggle('on', i < n); });
      $('.state', demo).textContent = n >= 3 ? 'پرداخت‌شده' : 'در انتظار واریز';
      live.textContent = msgs[n - 1];
    };
    var run = function () {
      timers.forEach(clearTimeout); timers = [];
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStep(3); return; }
      setStep(1);
      timers.push(setTimeout(function () { setStep(2); }, 1400));
      timers.push(setTimeout(function () { setStep(3); }, 2900));
    };
    $('[data-demo-run]').addEventListener('click', run);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { run(); io.disconnect(); } });
      io.observe(demo);
    } else run();
  }

  /* ---------- phone mockup ---------- */
  var phone = $('#phone');
  if (phone) {
    $$('.tabbar button', phone).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.tabbar button', phone).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        $$('.panel', phone).forEach(function (p) { p.classList.toggle('on', p.id === b.getAttribute('aria-controls')); });
      });
    });
    var toastBtn = $('[data-toast]');
    toastBtn && toastBtn.addEventListener('click', function () {
      var t = $('.toast', phone);
      t.classList.add('show');
      $('#phone-live').textContent = 'اعلان: واریز تأیید شد.';
      setTimeout(function () { t.classList.remove('show'); }, 3200);
    });
  }

  /* ---------- pricing ---------- */
  var plansEl = $('#plans');
  if (plansEl && S.PLANS) {
    var state = { period: (S.PERIODS || [])[0], audience: 'personal' };
    var periodsEl = $('#periods');
    (S.PERIODS || []).forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === 0));
      b.innerHTML = p.label + (p.discount ? ' <small>' + toFa(p.discount) + '٪ تخفیف</small>' : '');
      b.addEventListener('click', function () {
        state.period = p;
        $$('button', periodsEl).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        render();
      });
      periodsEl.appendChild(b);
    });
    var aud = $('#audience');
    aud && aud.addEventListener('tabchange', function (e) { state.audience = e.detail.dataset.audience; render(); });
    var render = function () {
      var p = state.period, list = S.PLANS[state.audience] || [];
      plansEl.innerHTML = list.map(function (pl) {
        var monthly = pl.price * (1 - p.discount / 100);
        return '<article class="plan' + (pl.featured ? ' featured' : '') + '">' +
          (pl.featured ? '<span class="badge badge-ok" style="align-self:flex-start;margin:0 0 8px">پیشنهاد ما</span>' : '') +
          '<h3>' + pl.name + '</h3>' +
          '<p class="price num">' + money(monthly) + ' <small style="font-size:.9rem;font-weight:600">تومان</small></p>' +
          '<span class="per">در ماه' + (p.months > 1 ? ' — پرداخت ' + toFa(p.months) + ' ماهه: ' + money(monthly * p.months) + ' تومان' : '') + '</span>' +
          '<ul><li>' + (pl.tx === Infinity ? 'تراکنش نامحدود' : toFa(pl.tx.toLocaleString('en-US').replace(/,/g, '٬')) + ' پرداخت موفق در ماه') + '</li>' +
          '<li>' + toFa(pl.cards) + ' کارت بانکی · ' + toFa(pl.devices) + ' دستگاه</li>' +
          pl.features.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul>' +
          '<a class="btn ' + (pl.featured ? 'btn-primary' : 'btn-ghost') + '" href="' + (S.SIGNUP_URL || '#') + '">شروع رایگان</a></article>';
      }).join('');
      calc();
    };

    /* cost calculator: logic comes from SITE.FEE_TIERS */
    var txIn = $('#calc-tx'), amtIn = $('#calc-amt'), out = $('#calc-out');
    var calc = function () {
      if (!txIn) return;
      var tx = Math.max(0, Number(String(txIn.value).replace(/[^\d]/g, '')) || 0);
      var amt = Math.max(0, Number(String(amtIn.value).replace(/[^\d]/g, '')) || 0);
      var F = S.FEE_TIERS || {}, cost = 0, note = '';
      if (F.model === 'tiered') {
        var vol = tx * amt, tier = F.tiered.find(function (t) { return vol <= t.upTo; }) || F.tiered[F.tiered.length - 1];
        var per = Math.min(F.tieredMaxPerTx, Math.max(F.tieredMinPerTx, amt * tier.percent / 100));
        cost = per * tx; note = 'کارمزد پلکانی ' + toFa(tier.percent) + '٪ (حداقل/حداکثر هر تراکنش رعایت شده)';
      } else if (F.model === 'credit') {
        cost = tx * F.creditPerTx; note = 'اعتبار هر تراکنش موفق: ' + money(F.creditPerTx) + ' تومان';
      } else {
        var list = (S.PLANS[state.audience] || []).slice().map(function (pl) {
          var m = pl.price * (1 - state.period.discount / 100);
          return { pl: pl, total: m + Math.max(0, tx - pl.tx) * (F.overagePerTx || 0) };
        }).sort(function (a, b) { return a.total - b.total; });
        if (list[0]) { cost = list[0].total; note = 'ارزان‌ترین گزینه: پلن «' + list[0].pl.name + '»' + (tx > list[0].pl.tx ? ' + ' + money(tx - list[0].pl.tx) + ' تراکنش مازاد' : ''); }
      }
      var share = tx * amt ? (cost / (tx * amt)) * 100 : 0;
      out.innerHTML = '<span class="muted">هزینه تقریبی ماهانه</span><b class="num">' + money(cost) + ' تومان</b>' +
        '<span class="muted">' + note + (share ? ' · حدود ' + toFa(share.toFixed(2)) + '٪ از فروش' : '') + '</span>';
    };
    txIn && txIn.addEventListener('input', calc);
    amtIn && amtIn.addEventListener('input', calc);
    render();
  }

  /* ---------- contact form → mailto (no backend yet) ---------- */
  var cf = $('#contact-form');
  cf && cf.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = new FormData(cf);
    var body = 'نام: ' + d.get('name') + '\nایمیل/موبایل: ' + d.get('reply') + '\n\n' + d.get('message');
    location.href = 'mailto:' + (S.SUPPORT_EMAIL || '') + '?subject=' + encodeURIComponent(d.get('topic') + ' — ' + (S.BRAND || '')) + '&body=' + encodeURIComponent(body);
  });
})();
