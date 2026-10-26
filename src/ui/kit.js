/* Shared UI helpers for the popup and dashboard: element builder, icons, count-up numbers,
   toast, segmented control, stepper, platform rows. No libraries, no network, no page access. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'text', 'polyline']);
  const COLORS = { youtube: 'var(--series-1)', instagram: 'var(--series-2)', tiktok: 'var(--series-3)', facebook: 'var(--series-4)' };

  const reduced = () => !!(self.matchMedia && self.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const instant = () => reduced() || document.hidden;

  /** h('div', {class: 'x', text: 'hi'}, child, 'text') - builds DOM nodes from text, never from HTML strings. */
  function h(tag, attrs) {
    const n = SVG_TAGS.has(tag) ? document.createElementNS(NS, tag) : document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'text') n.textContent = v;
        else if (k === 'style') n.style.cssText = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      for (const kid of kids) {
        if (kid == null || kid === false) continue;
        n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return n;
  }

  // 24x24 stroke icons. A string is a path, an array is a circle [cx, cy, r].
  const ICONS = {
    play: ['M8 5.5v13l11-6.5z'],
    clock: [[12, 12, 9], 'M12 7v5l3 2'],
    bars: ['M5 20V11M12 20V4M19 20v-6'],
    pulse: ['M3 12h4l3-8 4 16 3-8h4'],
    hash: ['M5 9h14M5 15h14M10 4L8 20M16 4l-2 16'],
    up: ['M3 17l6-6 4 4 8-8M15 7h6v6'],
    down: ['M3 7l6 6 4-4 8 8M15 17h6v-6'],
    moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
    flame: ['M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z'],
    check: ['M4 12.5l5 5L20 6.5'],
    x: ['M6 6l12 12M18 6L6 18'],
    plus: ['M12 5v14M5 12h14'],
    minus: ['M5 12h14'],
    download: ['M12 4v11M7 11l5 5 5-5M5 20h14'],
    trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
    sliders: ['M4 7h8M18 7h2M4 17h2M12 17h8', [15, 7, 2.2], [9, 17, 2.2]],
    external: ['M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    pause: ['M8 5v14M16 5v14'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
    lock: ['M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3'],
    sparkle: ['M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'],
    info: [[12, 12, 9], 'M12 11v5M12 8v.01'],
    gauge: ['M4 18a8 8 0 1 1 16 0M12 18l4-6'],
    bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0'],
    grid: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
    pin: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', [12, 10, 2.5]],
    undo: ['M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'],
    table: ['M4 5h16v14H4zM4 10h16M4 15h16M10 5v14'],
    calendar: ['M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'],
    inbox: ['M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5'],
  };

  function icon(name, cls) {
    const s = h('svg', { viewBox: '0 0 24 24', class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' });
    for (const part of ICONS[name] || []) {
      s.appendChild(Array.isArray(part) ? h('circle', { cx: part[0], cy: part[1], r: part[2] }) : h('path', { d: part }));
    }
    return s;
  }

  /** Fill every <span data-icon="name"> with its SVG. */
  function hydrateIcons(root) {
    for (const n of (root || document).querySelectorAll('[data-icon]')) {
      if (!n.firstChild) n.appendChild(icon(n.getAttribute('data-icon')));
    }
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  /** Count a number up (or between values). fmt turns the number into text. */
  function countTo(el, to, fmt, opts) {
    fmt = fmt || String;
    const prev = el._cv;
    if (el._raf) { cancelAnimationFrame(el._raf); el._raf = 0; }
    const from = prev == null ? 0 : prev;
    if (from === to || instant()) { el._cv = to; setText(el, fmt(to)); return; }
    const dur = (opts && opts.duration) || (prev == null ? 750 : 380);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const v = k >= 1 ? to : from + (to - from) * easeOut(k);
      el._cv = v;
      setText(el, fmt(k >= 1 ? to : Math.round(v)));
      el._raf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    el._cv = from;
    el._raf = requestAnimationFrame(step);
  }

  /** One toast at a time. host should be an aria-live="polite" container. */
  function toaster(host) {
    let timer = 0;
    return function show(message, opts) {
      opts = opts || {};
      clearTimeout(timer);
      host.replaceChildren();
      const t = h('div', { class: 'toast' + (opts.tone ? ' ' + opts.tone : '') },
        h('span', { class: 'tick' }, icon(opts.tone === 'info' ? 'info' : 'check')),
        h('span', { text: message }));
      if (opts.action) {
        const b = h('button', { type: 'button', text: opts.action.label });
        b.addEventListener('click', () => { clearTimeout(timer); hide(t); opts.action.onClick(); });
        t.appendChild(b);
      }
      host.appendChild(t);
      requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
      timer = setTimeout(() => hide(t), opts.duration || (opts.action ? 9000 : 2400));
    };
    function hide(t) {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 320);
    }
  }

  /** Adds the sliding thumb to a .seg group of aria-pressed buttons. Returns sync(). */
  function seg(root) {
    const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
    root.prepend(thumb);
    root.classList.add('has-thumb');
    function sync() {
      const b = root.querySelector('button[aria-pressed="true"]');
      if (!b || !b.offsetWidth) return;
      thumb.style.width = b.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + b.offsetLeft + 'px)';
      if (!root.classList.contains('ready')) requestAnimationFrame(() => root.classList.add('ready'));
    }
    if (self.ResizeObserver) new ResizeObserver(sync).observe(root);
    sync();
    return sync;
  }

  /** Number stepper: [-] input [+]. Fires 'input' while holding and 'change' when done. */
  function stepper(root) {
    const input = root.querySelector('input');
    const minus = root.querySelector('[data-dir="-1"]');
    const plus = root.querySelector('[data-dir="1"]');
    const num = (a, d) => (a === '' || a == null ? d : Number(a));
    const step = num(input.step, 1);
    const min = num(input.min, -Infinity);
    const max = num(input.max, Infinity);
    let holdTimer = 0;
    let repeat = 0;

    function sync() {
      const v = num(input.value, 0);
      minus.setAttribute('aria-disabled', String(v <= min));
      plus.setAttribute('aria-disabled', String(v >= max));
    }
    function bump(dir) {
      const cur = num(input.value, 0);
      const mult = repeat > 12 ? 5 : 1;
      const next = Math.min(max, Math.max(min, Math.round((cur + dir * step * mult) / step) * step));
      if (next !== cur) { input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })); }
      sync();
    }
    function stop() {
      if (!holdTimer) return;
      clearTimeout(holdTimer);
      holdTimer = 0;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function begin(dir) {
      repeat = 0;
      bump(dir);
      const loop = () => { repeat++; bump(dir); holdTimer = setTimeout(loop, 70); };
      holdTimer = setTimeout(loop, 420);
    }
    for (const b of [minus, plus]) {
      const dir = Number(b.getAttribute('data-dir'));
      b.addEventListener('pointerdown', (e) => { if (e.button === 0) begin(dir); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
      b.addEventListener('click', (e) => {
        if (e.detail !== 0) return; // a pointer click was already handled on pointerdown
        bump(dir);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
    return sync;
  }

  /** The four platform rows (dot, name, bar, numbers). Rows stay in place, so nothing jumps on updates. */
  function platformRows(host, C, o) {
    o = o || {};
    const rows = {};
    for (const p of C.PLATFORM_ORDER) {
      const fill = h('i', { class: 'pb-fill', style: 'background:' + COLORS[p] });
      const reels = h('b', { class: 'count', text: '0' });
      const rest = h('span');
      const row = h('div', { class: 'pb is-zero', 'data-p': p },
        h('span', { class: 'pb-name' }, h('i', { class: 'dot', style: 'background:' + COLORS[p] }), C.PLATFORMS[p].label),
        h('span', { class: 'pb-track' }, fill),
        h('span', { class: 'pb-num' }, reels, rest));
      host.appendChild(row);
      rows[p] = { row, fill, reels, rest };
    }
    void host.offsetWidth; // so the first fill grows from zero instead of appearing
    return {
      update(totals, key) {
        const val = (p) => (totals[p] ? totals[p][key] || 0 : 0);
        const max = Math.max(1, ...C.PLATFORM_ORDER.map(val));
        for (const p of C.PLATFORM_ORDER) {
          const v = totals[p] || { r: 0, s: 0 };
          const r = rows[p];
          countTo(r.reels, v.r || 0, (n) => Math.round(n).toLocaleString());
          setText(r.rest, (o.words ? (v.r === 1 ? ' reel' : ' reels') : '') + ' · ' + C.formatDuration(v.s || 0));
          const w = val(p) > 0 ? Math.max(3, (val(p) / max) * 100) + '%' : '0%';
          if (r.fill.style.width !== w) r.fill.style.width = w;
          r.row.classList.toggle('is-zero', !(v.r || v.s));
          r.row.setAttribute('data-tip', C.PLATFORMS[p].label + '\n' + (v.r || 0) + ' reels · ' + C.formatDuration(v.s || 0));
        }
      },
    };
  }

  function empty(iconName, title, text, extra) {
    return h('div', { class: 'empty' },
      h('span', { class: 'empty-ico' }, icon(iconName)),
      h('p', { class: 'empty-t', text: title }),
      text ? h('p', { class: 'empty-s', text }) : null,
      extra || null);
  }

  /** Fade sections up as they scroll into view. Elements stay visible if this cannot run. */
  function reveal(nodes) {
    if (reduced() || !self.IntersectionObserver) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    nodes.forEach((n, i) => {
      n.style.setProperty('--d', Math.min(i, 3) * 40 + 'ms');
      n.classList.add('will-reveal');
      io.observe(n);
    });
  }

  self.ReelKit = { h, icon, hydrateIcons, setText, countTo, toaster, seg, stepper, platformRows, empty, reveal, reduced, COLORS };
})();
