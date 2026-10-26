/* Small hand-built SVG charts. No libraries, no network.
   A chart keeps its SVG between calls: new data tweens the bars in place instead of redrawing. */
(function () {
  'use strict';
  const C = self.ReelCore;
  const NS = 'http://www.w3.org/2000/svg';

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const instant = () => !!(self.matchMedia && self.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.hidden;

  function el(name, attrs, text) {
    const n = document.createElementNS(NS, name);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function setAttr(n, k, v) { if (n.getAttribute(k) !== v) n.setAttribute(k, v); }
  function setText(n, v) { if (n.textContent !== v) n.textContent = v; }

  /** Column with a rounded top and a square base, so it grows from the baseline. */
  function columnPath(x, top, w, base, r) {
    const hgt = base - top;
    r = Math.max(0, Math.min(r, w / 2, hgt));
    if (r < 0.5) return 'M' + x + ',' + base + 'V' + top + 'h' + w + 'V' + base + 'Z';
    return (
      'M' + x + ',' + base + 'V' + (top + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + -r +
      'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + base + 'Z'
    );
  }

  function dayLabel(key, long) {
    const d = C.parseDayKey(key);
    return long
      ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  function valueOf(day, metric) {
    return metric === 'r' ? day.r : Math.round(day.s / 60);
  }

  function describe(day, isToday) {
    return (isToday ? 'Today · ' : '') + dayLabel(day.key, true) + '\n' + day.r + (day.r === 1 ? ' reel' : ' reels') + ' · ' + C.formatDuration(day.s);
  }

  /**
   * Draw (or update) a column chart in `host`.
   *   days   - [{key, r, s}] oldest first
   *   opts   - { metric: 'r' | 'm', height, axes, limit, valueLabels }
   * Tooltips are wired by the caller through attachTooltip (data-tip attributes).
   */
  function columns(host, days, opts) {
    opts = opts || {};
    const metric = opts.metric || 'r';
    const compact = !opts.axes;
    const width = Math.max(160, Math.round(host.clientWidth) || 320);
    const height = opts.height || (compact ? 96 : 240);
    const m = compact ? { l: 2, r: 2, t: opts.valueLabels ? 22 : 14, b: 22 } : { l: 40, r: 8, t: 26, b: 28 };
    const innerW = width - m.l - m.r;
    const innerH = height - m.t - m.b;
    const base = m.t + innerH;
    const n = days.length;

    const vals = days.map((d) => valueOf(d, metric));
    const limit = opts.limit || 0;
    const peak = Math.max(0, ...vals, limit);
    const scale = C.niceScale(peak);
    const y = (v) => base - (v / scale.max) * innerH;
    const target = vals.map((v) => (v > 0 ? Math.max(3, base - y(v)) : 0));
    const limitY = limit ? y(limit) : base;
    const peakVal = Math.max(0, ...vals);
    const peakIdx = peakVal > 0 ? vals.indexOf(peakVal) : -1;

    const sk = [compact ? 1 : 0, height, n, opts.valueLabels ? 1 : 0].join('|');
    let st = host._rc;
    const grow = !st || st.sk !== sk;
    if (!st || grow || st.width !== width) {
      const keep = st && !grow ? st : null;
      if (st && st.cancel) st.cancel();
      st = build(host, { sk, width, height, m, innerW, innerH, base, n, compact, valueLabels: !!opts.valueLabels }, keep);
      host._rc = st;
    }

    // ---- text, tooltips, grid: updated in place
    st.svg.setAttribute('aria-label', metric === 'r' ? 'Reels per day' : 'Minutes per day');
    days.forEach((d, i) => {
      const tip = describe(d, i === n - 1);
      setAttr(st.groups[i], 'data-tip', tip);
      setAttr(st.groups[i], 'aria-label', tip.replace('\n', ', '));
      if (st.xtexts[i]) setText(st.xtexts[i], xLabel(days, i, st.compact));
    });

    const sig = compact ? 'c' : scale.ticks.join(',') + '|' + innerH;
    if (st.gridSig !== sig) {
      const fresh = st.gridSig !== '';
      st.gridSig = sig;
      st.gGrid.replaceChildren();
      if (compact) {
        st.gGrid.appendChild(el('line', { class: 'axis', x1: 0, x2: width, y1: base, y2: base }));
      } else {
        for (const t of scale.ticks) {
          st.gGrid.appendChild(el('line', { class: t === 0 ? 'axis' : 'grid', x1: m.l, x2: width - m.r, y1: y(t), y2: y(t) }));
          st.gGrid.appendChild(el('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, C.formatCompact(t)));
        }
      }
      if (fresh && !instant()) {
        st.gGrid.classList.remove('fade-in');
        void st.gGrid.getBoundingClientRect();
        st.gGrid.classList.add('fade-in');
      }
    }

    st.limit = limit;
    st.limitLine.setAttribute('display', limit ? 'inline' : 'none');
    st.limitText.setAttribute('display', limit ? 'inline' : 'none');
    if (limit) setText(st.limitText, 'Limit ' + C.formatCompact(limit));
    st.vals = vals;
    st.peakIdx = peakIdx;

    // ---- animate the bars to their new heights
    const from = st.cur.slice();
    const fromLim = st.limY;
    if (st.cancel) st.cancel();
    if (instant() || (!grow && from.every((v, i) => Math.abs(v - target[i]) < 0.05) && Math.abs(fromLim - limitY) < 0.05)) {
      st.cur = target.slice();
      st.limY = limitY;
      paint(st);
      return;
    }
    const stagger = grow ? Math.max(3, Math.min(16, 280 / n)) : 0;
    const dur = grow ? 520 : 360;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now) => {
      const t = now - t0;
      let done = true;
      for (let i = 0; i < n; i++) {
        const k = Math.min(1, Math.max(0, (t - i * stagger) / dur));
        if (k < 1) done = false;
        st.cur[i] = from[i] + (target[i] - from[i]) * easeOut(k);
      }
      const kl = Math.min(1, t / dur);
      st.limY = fromLim + (limitY - fromLim) * easeOut(kl);
      paint(st);
      raf = done ? 0 : requestAnimationFrame(frame);
    };
    st.cancel = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    raf = requestAnimationFrame(frame);
  }

  function xLabel(days, i, compact) {
    if (i === days.length - 1) return 'Today';
    return days.length <= 7
      ? dayLabel(days[i].key, false)
      : C.parseDayKey(days[i].key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function build(host, g, keep) {
    const { width, height, m, innerW, base, n, compact } = g;
    const svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, height, role: 'group' });
    const gGrid = el('g', { 'aria-hidden': 'true' });
    const limitLine = el('line', { class: 'limit-line', x1: m.l, x2: width - m.r, y1: base, y2: base, display: 'none' });
    const limitText = el('text', { class: 'limit-text', x: width - m.r, y: base - 5, 'text-anchor': 'end', display: 'none' }, '');
    svg.append(gGrid);

    const band = innerW / n;
    const barW = Math.max(2, Math.min(compact ? 28 : 44, band * 0.62));
    const every = Math.max(1, Math.ceil(60 / band));
    const groups = [];
    const bars = [];
    const xtexts = [];
    const vtexts = [];
    const cx = [];
    for (let i = 0; i < n; i++) {
      const c = m.l + band * i + band / 2;
      cx.push(c);
      const grp = el('g', { tabindex: i === n - 1 ? 0 : -1, role: 'img' });
      grp.appendChild(el('rect', { class: 'hit', x: m.l + band * i, y: m.t - 4, width: band, height: g.innerH + m.b + 4, rx: 4 }));
      const bar = el('path', { class: 'bar', d: '' });
      grp.appendChild(bar);
      svg.appendChild(grp);
      groups.push(grp);
      bars.push(bar);
    }
    svg.append(limitLine, limitText);
    for (let i = 0; i < n; i++) {
      if (g.valueLabels) {
        const t = el('text', { class: i === n - 1 ? 'label' : '', x: cx[i], y: base - 4, 'text-anchor': 'middle', 'aria-hidden': 'true' }, '');
        svg.appendChild(t);
        vtexts.push(t);
      }
      const show = compact ? true : (n - 1 - i) % every === 0;
      if (show) {
        const t = el('text', { class: i === n - 1 ? 'today' : '', x: cx[i], y: height - (compact ? 4 : 8), 'text-anchor': i === n - 1 && !compact && n > 7 ? 'middle' : 'middle', 'aria-hidden': 'true' }, '');
        svg.appendChild(t);
        xtexts.push(t);
      } else xtexts.push(null);
    }
    const peakText = el('text', { class: 'label', x: 0, y: 0, 'text-anchor': 'middle', display: 'none', 'aria-hidden': 'true' }, '');
    svg.appendChild(peakText);

    // roving tab stop: arrows move between days
    svg.addEventListener('keydown', (e) => {
      const at = groups.indexOf(document.activeElement);
      if (at < 0) return;
      let to = at;
      if (e.key === 'ArrowRight') to = Math.min(n - 1, at + 1);
      else if (e.key === 'ArrowLeft') to = Math.max(0, at - 1);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = n - 1;
      else return;
      e.preventDefault();
      groups.forEach((x, k) => x.setAttribute('tabindex', k === to ? '0' : '-1'));
      groups[to].focus();
    });

    host.replaceChildren(svg);
    const st = {
      sk: g.sk, width, height, m, base, n, compact, svg, gGrid, gridSig: keep ? '' : '', limitLine, limitText, peakText,
      groups, bars, xtexts, vtexts, cx, barW, painted: new Array(n).fill(-1), vals: [], peakIdx: -1,
      cur: keep ? keep.cur.slice() : new Array(n).fill(0), limY: keep ? keep.limY : base, limit: 0, cancel: null,
      valueLabels: g.valueLabels,
    };
    return st;
  }

  function paint(st) {
    const { n, base, barW, cx, cur } = st;
    for (let i = 0; i < n; i++) {
      const hgt = cur[i];
      if (Math.abs(hgt - st.painted[i]) >= 0.05) {
        st.painted[i] = hgt;
        st.bars[i].setAttribute('d', hgt < 0.5 ? '' : columnPath(cx[i] - barW / 2, base - hgt, barW, base, Math.min(6, barW / 2.4)));
      }
      if (st.valueLabels) {
        const v = st.vals[i];
        const t = st.vtexts[i];
        setText(t, v > 0 ? C.formatCompact(v) : '');
        t.setAttribute('y', base - Math.max(hgt, 0) - 5);
      }
    }
    if (!st.valueLabels) {
      const i = st.peakIdx;
      if (i >= 0) {
        st.peakText.setAttribute('display', 'inline');
        st.peakText.setAttribute('x', cx[i]);
        st.peakText.setAttribute('y', base - cur[i] - 6);
        setText(st.peakText, C.formatCompact(st.vals[i]));
      } else st.peakText.setAttribute('display', 'none');
    }
    if (st.limit) {
      st.limitLine.setAttribute('y1', st.limY);
      st.limitLine.setAttribute('y2', st.limY);
      st.limitText.setAttribute('y', st.limY - 5);
    }
  }

  /** One tooltip for everything inside `root` that carries data-tip. */
  function attachTooltip(root, tip) {
    let current = null;
    const fill = (text) => {
      const parts = String(text).split('\n');
      const head = document.createElement('b');
      head.textContent = parts[0];
      const kids = [head];
      for (const p of parts.slice(1)) {
        const s = document.createElement('span');
        s.textContent = p;
        kids.push(s);
      }
      tip.replaceChildren(...kids);
    };
    const show = (target, cursorX) => {
      if (target !== current) { fill(target.getAttribute('data-tip')); current = target; }
      const bar = target.querySelector && target.querySelector('.bar');
      let r = target.getBoundingClientRect();
      let ax = r.left + r.width / 2;
      let ay = r.top;
      if (bar) {
        const b = bar.getBoundingClientRect();
        ax = r.left + r.width / 2;
        ay = b.height > 1 ? b.top : r.bottom - 30;
      } else if (r.width > 140 && cursorX != null) {
        ax = cursorX;
      }
      tip.classList.add('on');
      const w = tip.offsetWidth;
      const hgt = tip.offsetHeight;
      let top = ay - hgt - 10;
      if (top < 8) top = (bar ? ay + 24 : r.bottom + 10);
      tip.style.left = Math.round(Math.min(window.innerWidth - w - 8, Math.max(8, ax - w / 2))) + 'px';
      tip.style.top = Math.round(Math.max(8, top)) + 'px';
    };
    const hide = () => { current = null; tip.classList.remove('on'); };
    root.addEventListener('mouseover', (e) => {
      const t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!t) return hide();
      show(t, e.clientX);
    });
    root.addEventListener('mouseleave', hide);
    root.addEventListener('focusin', (e) => {
      const t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t) show(t, null);
    });
    root.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  }

  self.ReelCharts = { columns, attachTooltip };
})();
