/*! HarboR Heatmap tracker */
(function () {
  'use strict';
  if (window.__hmLoaded) return;
  window.__hmLoaded = true;

  var API = '__SUPABASE_URL__/rest/v1/rpc/';
  var APIKEY = '__SUPABASE_KEY__';
  var BUCKETS = 100;
  var MAX_CLICKS = 300;

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="t.js"]');
    return s[s.length - 1];
  })();
  var KEY = (script && (script.getAttribute('data-key') || (script.src.match(/[?&]k=([^&]+)/) || [])[1])) || window.HM_KEY;
  if (!KEY) return;

  var UA = navigator.userAgent || '';
  var IS_BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed/i.test(UA);
  var PREVIEW = (location.search.match(/[?&]hm_preview=([^&]+)/) || [])[1];

  // ---------- utils ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function now() { return Date.now(); }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function ss(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function rpc(name, body, keepalive) {
    try {
      return fetch(API + name, {
        method: 'POST',
        mode: 'cors',
        keepalive: !!keepalive,
        headers: { apikey: APIKEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.ok ? r.json() : null; })['catch'](function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function match(m, p, v) {
    if (!p || v == null) return false;
    try {
      if (m === 'equals') return v === p;
      if (m === 'prefix') return v.indexOf(p) === 0;
      if (m === 'regex') return new RegExp(p).test(v);
    } catch (e) { return false; }
    return v.indexOf(p) >= 0;
  }
  function docH() {
    var d = document.documentElement, b = document.body || {};
    return Math.max(d.scrollHeight || 0, b.scrollHeight || 0, d.offsetHeight || 0);
  }
  function docW() { return document.documentElement.clientWidth || window.innerWidth; }
  function scrollY() { return window.pageYOffset || document.documentElement.scrollTop || 0; }
  function normUrl(u) {
    var a = document.createElement('a');
    a.href = u;
    var path = a.pathname || '/';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return (a.protocol + '//' + a.host).toLowerCase() + path;
  }

  // ---------- identity ----------
  var vid = ls('hm_vid');
  var isNewVisitor = !vid;
  if (!vid) { vid = uuid(); ls('hm_vid', vid); }
  var sid = ls('hm_sid');
  var slast = +(ls('hm_slast') || 0);
  if (!sid || now() - slast > 30 * 60 * 1000) {
    sid = uuid();
    ls('hm_sid', sid);
    ls('hm_ssrc', null);
    if (isNewVisitor) ls('hm_newsid', sid);
  }
  ls('hm_slast', String(now()));
  var isNew = ls('hm_newsid') === sid;

  var dev = (function () {
    var w = window.innerWidth || screen.width;
    var touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (w < 768) return 'sp';
    if (touch && w < 1100) return 'tab';
    return 'pc';
  })();

  var source = ls('hm_ssrc');
  if (!source) {
    var utm = (location.search.match(/[?&]utm_source=([^&]+)/) || [])[1];
    if (utm) source = decodeURIComponent(utm);
    else if (document.referrer) {
      var rh = document.referrer.split('/')[2] || '';
      source = rh && rh !== location.host ? rh.replace(/^www\./, '') : 'internal';
    } else source = 'direct';
    ls('hm_ssrc', source);
  }

  var URLN = normUrl(location.href);
  var PV_ID = uuid();
  var startedAt = now();
  var activeMs = 0;
  var lastTick = now();
  var lastActivity = now();
  var maxBottom = 0;
  var attention = [];
  for (var i = 0; i < BUCKETS; i++) attention.push(0);
  var clicks = [];
  var structureHash = null;
  var dirty = true;
  var stopped = IS_BOT;
  var cfg = null;
  var evQueue = [];
  var cvQueue = [];
  var cvSent = {};

  function basePv() {
    return {
      id: PV_ID, v: vid, s: sid, url: URLN, full_url: location.href.slice(0, 2000), title: document.title,
      ref: document.referrer, src: source, dev: dev, new: isNew,
      vw: window.innerWidth, vh: window.innerHeight, dw: docW(), dh: docH()
    };
  }
  function fullPv() {
    var p = basePv();
    p.ms = Math.round(maxBottom);
    p.dur = Math.round(activeMs);
    p.att = attention.map(function (x) { return Math.round(x); });
    p.clicks = clicks;
    if (structureHash) p.hash = structureHash;
    return p;
  }

  function send(final) {
    if (stopped && !evQueue.length && !cvQueue.length) return;
    var body = { k: KEY, pv: stopped ? basePv() : fullPv() };
    if (cvQueue.length) { body.cv = cvQueue; cvQueue = []; }
    if (evQueue.length) { body.ev = evQueue; evQueue = []; }
    if (final && JSON.stringify(body).length > 60000) body.pv.clicks = clicks.slice(-120);
    dirty = false;
    rpc('hm_track', body, final).then(function (r) {
      if (r && r.limit) stopped = true;
    });
  }
  var flushTimer = null;
  function flushSoon() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { send(false); }, 400);
  }

  // ---------- activity / scroll / attention ----------
  function onActivity() { lastActivity = now(); }
  ['mousemove', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    window.addEventListener(ev, onActivity, { passive: true });
  });

  var lastY = scrollY(), lastYt = now(), upVelocity = 0, upFastAt = 0, reachedDeep = false;
  function onScroll() {
    onActivity();
    var y = scrollY(), t = now();
    var bottom = y + window.innerHeight;
    if (bottom > maxBottom) { maxBottom = bottom; dirty = true; }
    var dt = Math.max(1, t - lastYt);
    var v = (lastY - y) / dt; // >0 = 上方向
    upVelocity = v;
    if (v > 1.2 && y > window.innerHeight * 0.5) upFastAt = t;
    if (y > docH() * 0.3) reachedDeep = true;
    lastY = y; lastYt = t;
    popupOnScroll(y);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  setInterval(function () {
    var t = now();
    var dt = t - lastTick;
    lastTick = t;
    if (document.visibilityState !== 'visible') return;
    if (t - lastActivity > 30000) return;
    activeMs += dt;
    var h = docH();
    if (h <= 0) return;
    var top = scrollY(), bottom = top + window.innerHeight;
    if (bottom > maxBottom) maxBottom = bottom;
    var b0 = Math.max(0, Math.floor(top / h * BUCKETS));
    var b1 = Math.min(BUCKETS - 1, Math.floor(bottom / h * BUCKETS));
    for (var b = b0; b <= b1; b++) attention[b] += dt;
    dirty = true;
  }, 500);

  // ---------- clicks ----------
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      var tag = el.tagName.toLowerCase();
      if (el.id && /^[a-zA-Z][\w-]{0,40}$/.test(el.id) && !/\d{4,}/.test(el.id)) {
        parts.unshift(tag + '#' + el.id);
        break;
      }
      var idx = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) idx++;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      if (tag === 'body') break;
      el = el.parentElement;
    }
    return parts.join('>');
  }
  function inOwnUi(el) { return el && el.closest && el.closest('#hm-popup-root'); }

  document.addEventListener('click', function (e) {
    onActivity();
    var target = e.target;
    if (!target || target.nodeType !== 1 || inOwnUi(target)) return;
    var el = target.closest('a,button,input,select,textarea,label,[onclick],[role=button]') || target;
    checkClickCv(el, target);
    popupOnClick(target);
    if (stopped || clicks.length >= MAX_CLICKS) return;
    var r = el.getBoundingClientRect();
    var c = {
      s: cssPath(el),
      rx: r.width ? +((e.clientX - r.left) / r.width).toFixed(3) : 0,
      ry: r.height ? +((e.clientY - r.top) / r.height).toFixed(3) : 0,
      x: Math.round(e.pageX), y: Math.round(e.pageY), dw: docW(),
      t: el.tagName.toLowerCase()
    };
    var tx = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? '' : (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '');
    if (tx) c.tx = tx.replace(/\s+/g, ' ').trim().slice(0, 40);
    var a = el.closest('a');
    if (a && a.href) c.h = a.href.slice(0, 300);
    clicks.push(c);
    dirty = true;
  }, true);

  // ---------- CV ----------
  var LINE_RE = /(^|\/\/)(line\.me|lin\.ee|page\.line\.me|liff\.line\.me)\//i;
  var ASP_RE = /(px\.a8\.net|a8\.net|af\.moshimo\.com|ck\.jp\.ap\.valuecommerce\.com|valuecommerce\.com|click\.linksynergy\.com|t\.afi-b\.com|h\.accesstrade\.net|accesstrade\.net|track\.affiliate-b\.com|affiliate-b\.com|ad\.presco\.asia|t\.felmat\.net|cl\.link-ag\.net|www\.rentracks\.jp|rentracks\.jp|ad2\.trafficgate\.net|j-a-net\.jp|smart-c\.jp|hb\.afl\.rakuten\.co\.jp|amzn\.to|amazon\.co\.jp\/.*tag=)/i;

  function fireCv(tagId, url) {
    if (cvSent[tagId]) return;
    cvSent[tagId] = 1;
    cvQueue.push({ tag: tagId, url: url || location.href });
    send(true);
  }
  function checkUrlCv() {
    if (!cfg) return;
    (cfg.cv || []).forEach(function (t) {
      if (t.type === 'url' && (match(t.match, t.pattern, location.href) || match(t.match, t.pattern, URLN))) fireCv(t.id);
    });
  }
  function checkHrefCv(href) {
    if (!cfg || !href) return;
    (cfg.cv || []).forEach(function (t) {
      var hit = false;
      if (t.type === 'click_url') hit = match(t.match, t.pattern, href);
      else if (t.type === 'line') hit = t.pattern ? match(t.match, t.pattern, href) : LINE_RE.test(href);
      else if (t.type === 'asp') hit = t.pattern ? match(t.match, t.pattern, href) : ASP_RE.test(href);
      if (hit) fireCv(t.id, href);
    });
  }
  function checkClickCv(el, target) {
    if (!cfg) return;
    var a = el.closest && el.closest('a');
    if (a && a.href) checkHrefCv(a.href);
    (cfg.cv || []).forEach(function (t) {
      if (t.type !== 'selector') return;
      try { if (target.closest(t.pattern)) fireCv(t.id); } catch (e) {}
    });
  }

  // ---------- design snapshot ----------
  function computeHash() {
    var els = document.body ? document.body.getElementsByTagName('*') : [];
    var h = 5381, n = Math.min(els.length, 4000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el.tagName === 'SCRIPT' || inOwnUi(el)) continue;
      var s = el.tagName + (el.id || '');
      for (var j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
    }
    return (h >>> 0).toString(16) + '-' + Math.round(docH() / 200);
  }
  function serialize() {
    var clone = document.documentElement.cloneNode(true);
    var rm = clone.querySelectorAll('script,noscript,#hm-popup-root,iframe[src*="googletagmanager"]');
    for (var i = 0; i < rm.length; i++) rm[i].parentNode.removeChild(rm[i]);
    var inputs = clone.querySelectorAll('input,textarea');
    for (i = 0; i < inputs.length; i++) {
      inputs[i].removeAttribute('value');
      if (inputs[i].tagName === 'TEXTAREA') inputs[i].textContent = '';
    }
    // 遅延読み込み画像を表示状態にする
    var liveImgs = document.images, cloneImgs = clone.querySelectorAll('img');
    for (i = 0; i < cloneImgs.length && i < liveImgs.length; i++) {
      var li = liveImgs[i], ci = cloneImgs[i];
      var src = li.currentSrc || li.src || li.getAttribute('data-src') || li.getAttribute('data-lazy-src');
      if (src && src.indexOf('data:') !== 0) ci.setAttribute('src', src);
      ci.removeAttribute('srcset'); ci.removeAttribute('loading');
    }
    var all = clone.querySelectorAll('*');
    for (i = 0; i < all.length; i++) {
      var attrs = all[i].attributes;
      for (var j = attrs.length - 1; j >= 0; j--) if (/^on/i.test(attrs[j].name)) all[i].removeAttribute(attrs[j].name);
    }
    var head = clone.querySelector('head');
    if (!head) { head = document.createElement('head'); clone.insertBefore(head, clone.firstChild); }
    var base = document.createElement('base');
    base.setAttribute('href', location.href);
    head.insertBefore(base, head.firstChild);
    // CSSOMで追加されたスタイル（CSS-in-JS）を書き出す
    var extra = '';
    try {
      for (i = 0; i < document.styleSheets.length; i++) {
        var sh = document.styleSheets[i], node = sh.ownerNode;
        if (node && node.tagName === 'STYLE' && !(node.textContent || '').trim() && sh.cssRules) {
          for (j = 0; j < sh.cssRules.length; j++) extra += sh.cssRules[j].cssText + '\n';
        }
      }
    } catch (e) {}
    if (extra) {
      var st = document.createElement('style');
      st.textContent = extra;
      head.appendChild(st);
    }
    return '<!DOCTYPE html>' + clone.outerHTML;
  }
  function maybeSnapshot() {
    if (stopped) return;
    structureHash = computeHash();
    dirty = true;
    rpc('hm_snapshot_needed', { p_key: KEY, p_url: URLN, p_device: dev, p_hash: structureHash }).then(function (need) {
      if (need !== true) return;
      var html;
      try { html = serialize(); } catch (e) { return; }
      if (!html || html.length > 2800000) return;
      rpc('hm_snapshot_put', { p_key: KEY, p_url: URLN, p_device: dev, p_hash: structureHash, p_html: html, p_w: docW(), p_h: docH() });
    });
  }

  // =====================================================================
  // ポップアップ
  // =====================================================================
  var root = null, shadow = null, showing = null, shownThisPage = {}, lastHiddenAt = 0;
  var pageStats = null;

  function logEv(popup, cr, ev, extra) {
    if (PREVIEW) return;
    var e = { id: uuid(), popup: popup.id, cr: cr ? cr.id : null, ev: ev };
    if (extra) for (var k in extra) e[k] = extra[k];
    evQueue.push(e);
    flushSoon();
  }

  function withParams(url, settings) {
    if (!url || !settings || !settings.pass_params || !location.search) return url;
    try {
      var u = new URL(url, location.href);
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (k.indexOf('hm_') === 0) return;
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      });
      return u.toString();
    } catch (e) { return url; }
  }

  function freqKey(p) { return 'hm_pf_' + p.id; }
  function passFrequency(p) {
    var f = (p.settings && p.settings.freq) || 'session';
    if (f === 'always') return !shownThisPage[p.id];
    if (f === 'session') return ss(freqKey(p)) !== sid && ls(freqKey(p) + '_s') !== sid;
    var last = +(ls(freqKey(p)) || 0);
    if (f === 'day') return new Date(last).toDateString() !== new Date().toDateString();
    if (f === 'visitor') return !last;
    return true;
  }
  function markShown(p) {
    shownThisPage[p.id] = 1;
    ls(freqKey(p), String(now()));
    ls(freqKey(p) + '_s', sid);
    ss(freqKey(p), sid);
  }

  function hm2min(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function passConditions(p) {
    var c = p.conditions || {};
    if (c.devices && c.devices.length && c.devices.indexOf(dev) < 0) return false;
    var d = new Date();
    var today = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    if (c.start && today < c.start) return false;
    if (c.end && today > c.end) return false;
    if (c.days && c.days.length && c.days.indexOf(d.getDay()) < 0) return false;
    var from = hm2min(c.time_from), to = hm2min(c.time_to), cur = d.getHours() * 60 + d.getMinutes();
    if (from != null && to != null) {
      if (from <= to ? (cur < from || cur > to) : (cur < from && cur > to)) return false;
    }
    if (c.url_include && c.url_include.length) {
      var ok = c.url_include.some(function (r) { return match(r.match, r.pattern, location.href); });
      if (!ok) return false;
    }
    if (c.url_exclude && c.url_exclude.some(function (r) { return match(r.match, r.pattern, location.href); })) return false;
    if (c.sources && c.sources.length) {
      var hit = c.sources.some(function (s) { return s && source.toLowerCase().indexOf(String(s).toLowerCase()) >= 0; });
      if (!hit) return false;
    }
    if (c.visitor === 'new' && !isNew) return false;
    if (c.visitor === 'return' && isNew) return false;
    return true;
  }

  // ベータ分布サンプリング（Thompson Sampling）
  function gammaSample(k) {
    if (k < 1) return gammaSample(1 + k) * Math.pow(Math.random(), 1 / k);
    var d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    while (true) {
      var x, v;
      do {
        var u1 = Math.random(), u2 = Math.random();
        x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      var u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function betaSample(a, b) { var x = gammaSample(a), y = gammaSample(b); return x / (x + y); }

  function pickCreative(p) {
    var list = p.creatives || [];
    if (!list.length) return p.kind === 'scenario' ? { id: null } : null;
    if (list.length === 1) return list[0];
    var key = 'hm_cr_' + p.id, saved = ss(key);
    for (var i = 0; i < list.length; i++) if (list[i].id === saved) return list[i];
    var mode = (p.settings && p.settings.optimize) || 'ab';
    var chosen;
    if (mode === 'auto') {
      var goal = (p.settings && p.settings.goal) || 'click';
      var best = -1;
      list.forEach(function (cr) {
        var succ = goal === 'cv' ? (cr.cv || 0) : (cr.c || 0);
        var s = betaSample(1 + succ, 1 + Math.max(0, (cr.v || 0) - succ));
        if (s > best) { best = s; chosen = cr; }
      });
    } else {
      chosen = list[Math.floor(Math.random() * list.length)];
    }
    ss(key, chosen.id);
    return chosen;
  }

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}',
    '.ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483646;animation:f .25s ease}',
    '.box{position:relative;background:#fff;border-radius:12px;max-width:min(92vw,var(--w,480px));width:100%;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);animation:u .3s ease}',
    '.box.img{background:transparent;box-shadow:none}',
    '.x{position:absolute;top:6px;right:6px;width:32px;height:32px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:18px;line-height:32px;cursor:pointer;z-index:2}',
    '.bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483645;animation:u .3s ease}',
    '.bar .x{top:-14px;right:8px;width:28px;height:28px;line-height:28px;font-size:16px}',
    '.corner{position:fixed;right:16px;bottom:16px;width:var(--w,240px);max-width:60vw;z-index:2147483645;animation:u .3s ease}',
    '.corner .x{top:-12px;right:-12px;width:26px;height:26px;line-height:26px;font-size:14px}',
    'img{display:block;width:100%;height:auto;border-radius:inherit}',
    'a{display:block;color:inherit;text-decoration:none}',
    '.html{padding:0}',
    '.sc{padding:28px 22px 22px;text-align:center;color:#222}',
    '.sc h3{font-size:18px;margin:0 0 16px;line-height:1.5}',
    '.sc p{font-size:14px;line-height:1.7;margin:0 0 16px;white-space:pre-wrap}',
    '.sc .prog{font-size:12px;color:#888;margin-bottom:8px}',
    '.sc .ch{display:block;width:100%;padding:13px;margin:8px 0;border:1.5px solid var(--c,#e8543f);color:var(--c,#e8543f);background:#fff;border-radius:999px;font-size:15px;font-weight:600;cursor:pointer}',
    '.sc .ch:hover{background:var(--c,#e8543f);color:#fff}',
    '.sc .cta{display:block;padding:14px;margin-top:8px;background:var(--c,#e8543f);color:#fff;border-radius:999px;font-weight:700;font-size:16px}',
    '.sc img{margin:0 0 14px;border-radius:8px}',
    '@keyframes f{from{opacity:0}to{opacity:1}}',
    '@keyframes u{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}'
  ].join('');

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'hm-popup-root';
    document.body.appendChild(root);
    shadow = root.attachShadow ? root.attachShadow({ mode: 'open' }) : root;
    var st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);
  }

  function closeEl(el, p, cr) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (showing && showing.el === el) showing = null;
    if (p) logEv(p, cr, 'close');
  }

  function onCta(p, cr, url) {
    logEv(p, cr, 'click');
    if (url) checkHrefCv(url);
    send(true);
  }

  function creativeNode(p, cr) {
    var s = p.settings || {};
    var wrap = document.createElement('div');
    var link = withParams(cr.link_url, s);
    if (cr.type === 'html') {
      wrap.className = 'html';
      wrap.innerHTML = cr.html || '';
      var as = wrap.querySelectorAll('a');
      for (var i = 0; i < as.length; i++) {
        (function (a) {
          a.href = withParams(a.getAttribute('href'), s);
          a.addEventListener('click', function () { onCta(p, cr, a.href); });
        })(as[i]);
      }
      if (link && !as.length) {
        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', function () { onCta(p, cr, link); location.href = link; });
      }
    } else {
      var img = document.createElement('img');
      img.src = cr.image_url || '';
      img.alt = cr.alt || '';
      if (link) {
        var a = document.createElement('a');
        a.href = link;
        if (s.new_tab) { a.target = '_blank'; a.rel = 'noopener'; }
        a.appendChild(img);
        a.addEventListener('click', function () { onCta(p, cr, link); });
        wrap.appendChild(a);
      } else wrap.appendChild(img);
    }
    return wrap;
  }

  function renderScenario(p, box) {
    var sc = p.scenario || {}, s = p.settings || {};
    var steps = sc.steps || [], results = sc.results || [];
    var byId = {};
    steps.forEach(function (st) { byId[st.id] = st; });
    var resById = {};
    results.forEach(function (r) { resById[r.id] = r; });
    var body = document.createElement('div');
    body.className = 'sc';
    box.appendChild(body);
    var count = 0;
    function esc(t) { var d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
    function showStep(stId) {
      var st = byId[stId];
      if (!st) return;
      count++;
      logEv(p, null, 'step', { step: st.id });
      body.innerHTML = '<div class="prog">Q' + count + '</div>' + (st.image_url ? '<img src="' + esc(st.image_url) + '">' : '') + '<h3>' + esc(st.question) + '</h3>';
      (st.choices || []).forEach(function (ch) {
        var b = document.createElement('button');
        b.className = 'ch';
        b.textContent = ch.label;
        b.addEventListener('click', function () {
          logEv(p, null, 'answer', { step: st.id, ans: ch.label });
          if (ch.result) showResult(ch.result);
          else if (ch.next) showStep(ch.next);
          else if (results[0]) showResult(results[0].id);
        });
        body.appendChild(b);
      });
    }
    function showResult(rid) {
      var r = resById[rid];
      if (!r) return;
      logEv(p, null, 'result', { step: r.id });
      var link = withParams(r.link_url, s);
      body.innerHTML = (r.image_url ? '<img src="' + esc(r.image_url) + '">' : '') + '<h3>' + esc(r.title) + '</h3>' + (r.text ? '<p>' + esc(r.text) + '</p>' : '');
      if (link) {
        var a = document.createElement('a');
        a.className = 'cta';
        a.href = link;
        a.textContent = r.button || '詳しく見る';
        if (s.new_tab) { a.target = '_blank'; a.rel = 'noopener'; }
        a.addEventListener('click', function () { onCta(p, { id: null }, link); });
        body.appendChild(a);
      }
    }
    showStep(sc.start || (steps[0] && steps[0].id));
  }

  function show(p, trigger, force) {
    if (!force) {
      if (showing && showing.modal && p.kind !== 'bar' && p.kind !== 'corner') return false;
      if (shownThisPage[p.id] && !(p.settings && p.settings.freq === 'always')) return false;
      if (!passConditions(p) || !passFrequency(p)) return false;
    }
    var cr = pickCreative(p);
    if (!cr) return false;
    ensureRoot();
    var s = p.settings || {};
    var el = document.createElement('div');
    var closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.textContent = '×';
    if (s.color) el.style.setProperty('--c', s.color);

    if (p.kind === 'modal' || p.kind === 'scenario') {
      el.className = 'ov';
      var box = document.createElement('div');
      box.className = 'box' + (p.kind === 'modal' && cr.type !== 'html' ? ' img' : '');
      if (s.width) box.style.setProperty('--w', s.width + 'px');
      box.appendChild(closeBtn);
      if (p.kind === 'scenario') renderScenario(p, box);
      else box.appendChild(creativeNode(p, cr));
      el.appendChild(box);
      if (s.overlay_close !== false) el.addEventListener('click', function (e) { if (e.target === el) closeEl(el, p, cr); });
    } else if (p.kind === 'bar') {
      el.className = 'bar';
      el.appendChild(closeBtn);
      el.appendChild(creativeNode(p, cr));
    } else {
      el.className = 'corner';
      if (s.width) el.style.setProperty('--w', s.width + 'px');
      el.appendChild(closeBtn);
      var node = creativeNode(p, cr);
      if (s.open_popup) {
        // 右下バナークリックで別のポップアップを開く
        node.addEventListener('click', function (e) {
          var target = (cfg.popups || []).filter(function (x) { return x.id === s.open_popup; })[0];
          if (target) { e.preventDefault(); e.stopPropagation(); logEv(p, cr, 'click'); show(target, 'banner', true); }
        }, true);
      }
      el.appendChild(node);
    }
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closeEl(el, p, cr); });
    shadow.appendChild(el);
    if (p.kind === 'modal' || p.kind === 'scenario') showing = { el: el, modal: true };
    markShown(p);
    logEv(p, p.kind === 'scenario' ? null : cr, 'view', { tr: trigger });
    return true;
  }

  function popupsWith(trigger) {
    if (!cfg) return [];
    return (cfg.popups || []).filter(function (p) {
      var t = p.triggers || {};
      if (trigger === 'exit') return t.exit || (dev !== 'pc' && t.predict);
      return !!t[trigger];
    });
  }
  function fire(trigger) {
    var list = popupsWith(trigger);
    for (var i = 0; i < list.length; i++) if (show(list[i], trigger)) return true;
    return false;
  }

  // --- トリガー：スクロール率 / 逆スクロールで最上部 ---
  var scrollFired = {};
  function popupOnScroll(y) {
    if (!cfg) return;
    var h = docH() - window.innerHeight;
    var pct = h > 0 ? y / h * 100 : 100;
    (cfg.popups || []).forEach(function (p) {
      var t = p.triggers || {};
      if (t.scroll && !scrollFired[p.id] && pct >= +t.scroll) {
        scrollFired[p.id] = 1;
        show(p, 'scroll');
      }
    });
    if (reachedDeep && y <= 40) {
      reachedDeep = false;
      fire('reverse_top');
    }
  }

  // --- トリガー：特定要素クリック ---
  function popupOnClick(target) {
    if (!cfg) return;
    (cfg.popups || []).forEach(function (p) {
      var sel = p.triggers && p.triggers.click_selector;
      if (!sel) return;
      try { if (target.closest(sel)) show(p, 'click', true); } catch (e) {}
    });
  }

  // --- トリガー：PCの離脱兆候（カーソルアウト＋上方向への高速移動） ---
  var lastMouse = { y: 0, t: 0 };
  document.addEventListener('mousemove', function (e) {
    var t = now();
    if (dev === 'pc' && lastMouse.t && e.clientY < 80) {
      var vy = (e.clientY - lastMouse.y) / Math.max(1, t - lastMouse.t);
      if (vy < -1.5 && activeMs > 3000) fire('exit');
    }
    lastMouse = { y: e.clientY, t: t };
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', function (e) {
    if (dev !== 'pc') return;
    if (e.clientY <= 5 && activeMs > 2000) fire('exit');
  });

  // --- トリガー：スマホ離脱予測（ヒートマップ実績×行動シグナル） ---
  var edgeSwipe = 0, touchStartX = null;
  window.addEventListener('touchstart', function (e) {
    var t = e.touches && e.touches[0];
    touchStartX = t && t.clientX < 24 ? t.clientX : null;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var t = e.touches && e.touches[0];
    if (touchStartX != null && t && t.clientX - touchStartX > 40) { edgeSwipe = now(); touchStartX = null; }
  }, { passive: true });

  function exitScore() {
    var med = pageStats && pageStats.n >= 20 && pageStats.med_ms ? pageStats.med_ms : 30000;
    var medScroll = pageStats && pageStats.n >= 20 && pageStats.med_scroll ? pageStats.med_scroll : 0.5;
    var h = docH();
    var reach = h ? maxBottom / h : 0;
    var idle = (now() - lastActivity) / 1000;
    var s = 0;
    s += 0.35 * Math.min(activeMs / Math.max(med, 5000), 2);
    s += 0.25 * Math.min(reach / Math.max(medScroll, 0.3), 1.5);
    s += 0.2 * Math.min(idle / 4, 1);
    if (now() - upFastAt < 1200) s += 0.5;
    if (now() - edgeSwipe < 1500) s += 0.8;
    return s;
  }
  setInterval(function () {
    if (!cfg || dev === 'pc' || document.visibilityState !== 'visible' || activeMs < 5000) return;
    if (exitScore() >= 0.9) fire('exit');
  }, 1000);

  // --- トリガー：ページ復帰（ウェルカムバック） ---
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = now();
      send(true);
    } else if (lastHiddenAt && now() - lastHiddenAt > 3000) {
      fire('return_page');
    }
  });
  window.addEventListener('pagehide', function () { send(true); });

  function startTimedTriggers() {
    (cfg.popups || []).forEach(function (p) {
      var t = p.triggers || {};
      if (t.load) setTimeout(function () { show(p, 'load'); }, (+t.load_delay || 0) * 1000);
      if (t.time) {
        var need = +t.time * 1000;
        var iv = setInterval(function () {
          if (activeMs >= need) { clearInterval(iv); show(p, 'time'); }
        }, 500);
      }
      if (t.return_visit && !isNewVisitor) setTimeout(function () { show(p, 'return_visit'); }, 1500);
    });
  }

  // ---------- 起動 ----------
  function boot() {
    var cacheKey = 'hm_cfg_' + KEY + '_' + URLN;
    var cached = ss(cacheKey);
    var p;
    if (cached && !PREVIEW) {
      try {
        var c = JSON.parse(cached);
        if (now() - c.t < 5 * 60 * 1000) p = Promise.resolve(c.d);
      } catch (e) {}
    }
    if (!p) p = rpc('hm_config', { p_key: KEY, p_url: URLN }).then(function (d) {
      if (d) ss(cacheKey, JSON.stringify({ t: now(), d: d }));
      return d;
    });
    p.then(function (d) {
      if (!d) return;
      cfg = d;
      pageStats = d.page;
      checkUrlCv();
      if (PREVIEW) {
        var target = (cfg.popups || []).filter(function (x) { return x.id === PREVIEW; })[0];
        if (target) setTimeout(function () { show(target, 'preview', true); }, 500);
        else rpc('hm_popup_preview', { p_key: KEY, p_popup: PREVIEW }).then(function (pp) {
          if (pp) { cfg.popups = (cfg.popups || []).concat([pp]); show(pp, 'preview', true); }
        });
        return;
      }
      startTimedTriggers();
    });
    onScroll();
    setTimeout(function () { send(false); }, 1000);
    setTimeout(maybeSnapshot, 2500);
    setInterval(function () { if (dirty) send(false); }, 15000);
  }

  window.hm = {
    cv: function (tagId) { fireCv(tagId); },
    show: function (popupId) {
      var p = cfg && (cfg.popups || []).filter(function (x) { return x.id === popupId; })[0];
      if (p) show(p, 'api', true);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
