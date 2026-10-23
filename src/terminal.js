/*
 * Amberline Terminal: the front end.
 * Four independent panels driven by a command line, function keys and a
 * ticker tape. All market data comes from data.js and is simulated.
 */
(function () {
  'use strict';

  const D = window.AmberlineData;
  const I = D.inst;
  const STORE_KEY = 'amberline.layout.v1';
  const TYPE_LABEL = { equity: 'Equity', index: 'Index', cmdty: 'Commodity', fx: 'Currency' };

  // ---------- formatting ----------
  const nfCache = {};
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    const f = nfCache[d] || (nfCache[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return f.format(v);
  }
  const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);
  const pctStr = v => signed(v, 2) + '%';
  const dirOf = v => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  function big(v) {
    const a = Math.abs(v);
    if (a >= 1e12) return fmt(v / 1e12, 2) + 'T';
    if (a >= 1e9) return fmt(v / 1e9, 2) + 'B';
    if (a >= 1e6) return fmt(v / 1e6, 2) + 'M';
    if (a >= 1e3) return fmt(v / 1e3, 1) + 'K';
    return fmt(v, 0);
  }
  function hhmm(min) {
    const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayBar = i => i.daily[i.daily.length - 1];
  const chg = i => i.last - i.prevClose;
  const chgPct = i => (i.last / i.prevClose - 1) * 100;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const monFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

  function flash(el, dir) {
    el.classList.remove('fl-up', 'fl-dn');
    void el.offsetWidth; // restart the animation
    el.classList.add(dir === 'up' ? 'fl-up' : 'fl-dn');
  }
  function put(el, text, dir) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (dir) flash(el, dir);
  }
  function setDir(el, v) {
    const d = dirOf(v);
    el.classList.toggle('up', d === 'up');
    el.classList.toggle('dn', d === 'dn');
  }

  // ---------- canvas charts ----------
  const css = getComputedStyle(document.documentElement);
  const C = {};
  ['ink', 'panel', 'rule', 'grid', 'amber', 'amber-dim', 'text', 'muted', 'up', 'dn', 'link', 'key'].forEach(k => { C[k] = css.getPropertyValue('--' + k).trim(); });
  const MONO = css.getPropertyValue('--font-data').trim() || 'monospace';
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function sizeCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  function hline(ctx, x1, x2, y) { ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
  function vline(ctx, x, y1, y2) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke(); }

  // o: { style, dec, vol, ref, ma: {src, off}, hover, xlabel }
  function drawChart(cv, bars, o) {
    const { ctx, W, H } = sizeCanvas(cv);
    const n = bars.length;
    if (W < 60 || H < 60 || !n) return null;
    const line = o.style === 'line';
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const b of bars) {
      lo = Math.min(lo, line ? b.c : b.l);
      hi = Math.max(hi, line ? b.c : b.h);
      vmax = Math.max(vmax, b.v);
    }
    if (o.ref != null) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
    const span = (hi - lo) * 0.08 || hi * 0.01;
    lo -= span; hi += span;

    ctx.font = '600 11px ' + MONO;
    const padL = 4, padT = 10, padB = 20;
    const padR = Math.ceil(ctx.measureText(fmt(hi, o.dec)).width) + 18;
    const hasVol = o.vol && vmax > 0;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const priceH = hasVol ? plotH * 0.8 : plotH;
    const volTop = padT + priceH + 4, volH = hasVol ? plotH - priceH - 4 : 0;
    const bw = plotW / n;
    const y = v => padT + (hi - v) / (hi - lo) * priceH;
    const x = k => padL + bw * (k + 0.5);
    const body = Math.max(1, Math.min(bw * 0.7, 14));

    // grid and price axis
    ctx.font = '11px ' + MONO;
    ctx.lineWidth = 1;
    const step = niceStep(hi - lo, Math.max(3, Math.round(priceH / 44)));
    const axDec = Math.min(o.dec, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = C.grid;
      hline(ctx, padL, padL + plotW, yy);
      ctx.fillStyle = C.muted;
      ctx.fillText(fmt(v, axDec), padL + plotW + 8, yy);
    }

    // time axis
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let k = 0; k < n; k += every) {
      const xx = Math.round(x(k)) + 0.5;
      ctx.strokeStyle = C.grid;
      vline(ctx, xx, padT, padT + plotH);
      const label = o.xlabel(bars[k]);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, Math.max(padL + w / 2, Math.min(xx, padL + plotW - w / 2)), H - 6);
    }

    // previous close
    if (o.ref != null) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = C['amber-dim'];
      hline(ctx, padL, padL + plotW, Math.round(y(o.ref)) + 0.5);
      ctx.restore();
    }

    // volume
    if (hasVol) {
      for (let k = 0; k < n; k++) {
        const b = bars[k], h = b.v / vmax * volH;
        ctx.fillStyle = alpha(b.c >= b.o ? C.up : C.dn, 0.4);
        ctx.fillRect(x(k) - body / 2, volTop + volH - h, body, h);
      }
    }

    // price series
    if (line) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
      grad.addColorStop(0, alpha(C.amber, 0.26));
      grad.addColorStop(1, alpha(C.amber, 0));
      ctx.beginPath();
      bars.forEach((b, k) => (k ? ctx.lineTo(x(k), y(b.c)) : ctx.moveTo(x(k), y(b.c))));
      ctx.lineTo(x(n - 1), padT + priceH);
      ctx.lineTo(x(0), padT + priceH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      bars.forEach((b, k) => (k ? ctx.lineTo(x(k), y(b.c)) : ctx.moveTo(x(k), y(b.c))));
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      for (let k = 0; k < n; k++) {
        const b = bars[k], col = b.c >= b.o ? C.up : C.dn;
        const xx = Math.round(x(k)) + 0.5;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        vline(ctx, xx, y(b.h), y(b.l));
        const y1 = y(Math.max(b.o, b.c)), y2 = y(Math.min(b.o, b.c));
        ctx.fillRect(Math.round(xx - body / 2), Math.round(y1), Math.max(1, Math.round(body)), Math.max(1, Math.round(y2 - y1)));
      }
    }

    // moving averages, computed on the full daily history
    if (o.ma) {
      const src = o.ma.src;
      [[20, C.link], [50, C.key]].forEach(([len, col]) => {
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < n; k++) {
          const end = o.ma.off + k;
          if (end < len - 1) continue;
          let s = 0;
          for (let j = end - len + 1; j <= end; j++) s += src[j].c;
          const yy = y(s / len);
          if (started) ctx.lineTo(x(k), yy); else { ctx.moveTo(x(k), yy); started = true; }
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.lineWidth = 1;
      });
    }

    // crosshair
    if (o.hover != null) {
      const k = Math.min(o.hover, n - 1);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = C.muted;
      vline(ctx, Math.round(x(k)) + 0.5, padT, padT + plotH);
      hline(ctx, padL, padL + plotW, Math.round(y(bars[k].c)) + 0.5);
      ctx.restore();
    }

    // last-price tag on the axis
    const last = bars[n - 1].c, ly = Math.max(padT + 8, Math.min(padT + priceH - 8, y(last)));
    ctx.fillStyle = C.amber;
    ctx.fillRect(padL + plotW + 2, ly - 8, padR - 4, 16);
    ctx.fillStyle = C.ink;
    ctx.font = '600 11px ' + MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(last, o.dec), padL + plotW + 7, ly + 0.5);

    return { padL, bw, n };
  }

  function drawSpark(cv, values, color) {
    const { ctx, W, H } = sizeCanvas(cv);
    if (W < 10 || H < 10) return;
    const lo = Math.min(...values), hi = Math.max(...values);
    const x = k => k / (values.length - 1) * (W - 2) + 1;
    const y = v => 3 + (hi - v) / (hi - lo || 1) * (H - 6);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, alpha(color, 0.22));
    grad.addColorStop(1, alpha(color, 0));
    ctx.beginPath();
    values.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
    ctx.lineTo(W - 1, H);
    ctx.lineTo(1, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    values.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(values.length - 1), y(values[values.length - 1]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function sparkSVG(values) {
    const lo = Math.min(...values), hi = Math.max(...values);
    const pts = values.map((v, k) => `${(k / (values.length - 1) * 78 + 1).toFixed(1)},${(2 + (hi - v) / (hi - lo || 1) * 14).toFixed(1)}`).join(' ');
    return `<svg class="spk" viewBox="0 0 80 18" width="80" height="18" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
  }

  function pctBar(p) {
    const w = Math.min(50, Math.abs(p) * 25);
    return `<span class="pbar"><i style="${p >= 0 ? 'left:50%' : 'right:50%'};width:${w.toFixed(1)}%"></i></span>`;
  }

  // ---------- quote tables ----------
  const COL = {
    sym: { k: 'sym', label: 'Ticker', cls: 'sym', get: i => i.sym },
    name: { k: 'name', label: 'Name', cls: 'name', get: i => i.name },
    last: { k: 'last', label: 'Last', num: 1, live: 1, get: i => fmt(i.last, i.dec) },
    chg: { k: 'chg', label: 'Net chg', num: 1, dir: 1, get: i => signed(chg(i), i.dec) },
    pct: { k: 'pct', label: '% chg', num: 1, dir: 1, get: i => pctStr(chgPct(i)) },
    bar: { k: 'bar', label: '', html: 1, dir: 1, get: i => pctBar(chgPct(i)) },
    y1: { k: 'y1', label: '1Y %', num: 1, dirOf: i => i.last - i.daily[0].c, get: i => pctStr((i.last / i.daily[0].c - 1) * 100) },
    vol: { k: 'vol', label: 'Volume', num: 1, get: i => big(todayBar(i).v) },
    rng: { k: 'rng', label: 'Day range', num: 1, cls: 'muted', get: i => fmt(todayBar(i).l, i.dec) + ' – ' + fmt(todayBar(i).h, i.dec) },
    unit: { k: 'unit', label: 'Unit', cls: 'muted', get: i => i.unit },
    ba: { k: 'ba', label: 'Bid × Ask', num: 1, cls: 'muted', get: i => { const s = Math.max(0.01, i.last * 0.00015); return fmt(i.last - s, i.dec) + ' × ' + fmt(i.last + s, i.dec); } },
    spark: { k: 'spark', label: 'Today', html: 1, dir: 1, get: i => sparkSVG(i.intra.map(b => b.c)) }
  };

  function quoteTable(host, groups, cols, onRow) {
    host.innerHTML = `<table class="qt"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}" scope="col">${c.label}</th>`).join('')}</tr></thead>` +
      groups.map(g => `<tbody>${g.label ? `<tr class="grp"><th colspan="${cols.length}" scope="rowgroup">${esc(g.label)}</th></tr>` : ''}` +
        g.syms.map(s => `<tr data-sym="${s}" tabindex="0">${cols.map(c => `<td class="${[c.cls, c.num && 'num'].filter(Boolean).join(' ')}"></td>`).join('')}</tr>`).join('') +
        '</tbody>').join('') + '</table>';
    const rows = [...host.querySelectorAll('tr[data-sym]')].map(tr => ({ inst: I[tr.dataset.sym], cells: [...tr.children] }));
    function update(first) {
      rows.forEach(r => cols.forEach((c, j) => {
        const td = r.cells[j], v = c.get(r.inst);
        if (c.html) td.innerHTML = v; else put(td, v, !first && c.live ? r.inst.dir : null);
        if (c.dir) setDir(td, chg(r.inst));
        if (c.dirOf) setDir(td, c.dirOf(r.inst));
      }));
    }
    const go = tr => tr && onRow(tr.dataset.sym);
    host.addEventListener('click', e => go(e.target.closest('tr[data-sym]')));
    host.addEventListener('keydown', e => { if (e.key === 'Enter') go(e.target.closest('tr[data-sym]')); });
    update(true);
    return update;
  }

  // ---------- functions ----------
  const FN = {};
  const TFS = ['1D', '1M', '3M', '6M', '1Y'];

  FN.GP = {
    name: 'Price Graph', sec: 'req', example: 'NVTK GP 6M',
    help: 'Candlestick or line chart with volume and 20/50-day moving averages. Add 1D, 1M, 3M, 6M or 1Y.',
    mount(p, s) {
      const i = I[s.sym];
      s.tf = TFS.includes(s.tf) ? s.tf : '1D';
      s.style = s.style === 'line' ? 'line' : 'candle';
      p.body.innerHTML = `
        <div class="gp">
          <div class="gp-top">
            <div class="quote"><span class="q-last"></span><span class="q-chg"></span><span class="q-unit">${esc(i.unit)}</span></div>
            <div class="seg" data-k="tf" role="group" aria-label="Timeframe">${TFS.map(t => `<button type="button" data-v="${t}">${t}</button>`).join('')}</div>
            <div class="seg" data-k="style" role="group" aria-label="Chart style"><button type="button" data-v="candle">Candle</button><button type="button" data-v="line">Line</button></div>
          </div>
          <div class="chart"><canvas role="img" aria-label="Price chart for ${esc(i.name)}"></canvas><div class="legend"></div></div>
        </div>`;
      const cv = p.body.querySelector('canvas');
      const legend = p.body.querySelector('.legend');
      const qLast = p.body.querySelector('.q-last'), qChg = p.body.querySelector('.q-chg');
      let hover = null, geo = null;

      const syncSeg = () => p.body.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s[g.dataset.k]))));
      p.body.querySelectorAll('.seg').forEach(g => g.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        s[g.dataset.k] = b.dataset.v;
        hover = null;
        syncSeg(); save(); draw();
      }));

      function series() {
        if (s.tf === '1D') return { bars: i.intra, intraday: true };
        const len = { '1M': 22, '3M': 63, '6M': 126, '1Y': 252 }[s.tf];
        const off = Math.max(0, i.daily.length - len);
        return { bars: i.daily.slice(off), ma: { src: i.daily, off } };
      }
      function draw() {
        const sr = series();
        if (hover != null) hover = Math.min(hover, sr.bars.length - 1);
        const longRange = s.tf === '6M' || s.tf === '1Y';
        geo = drawChart(cv, sr.bars, {
          style: s.style, dec: i.dec, vol: true, hover,
          ref: sr.intraday ? i.prevClose : null,
          ma: sr.ma || null,
          xlabel: sr.intraday ? b => hhmm(b.t) : b => (longRange ? monFmt : dayFmt).format(b.t)
        });
        const b = sr.bars[hover != null ? hover : sr.bars.length - 1];
        legend.innerHTML = `<span class="lt">${sr.intraday ? hhmm(b.t) + ' ET' : dayFmt.format(b.t)}</span>` +
          `O <b>${fmt(b.o, i.dec)}</b>H <b>${fmt(b.h, i.dec)}</b>L <b>${fmt(b.l, i.dec)}</b>C <b>${fmt(b.c, i.dec)}</b>` +
          (b.v ? `V <b>${big(b.v)}</b>` : '') +
          (sr.ma ? '<span class="ma20">MA20</span><span class="ma50">MA50</span>' : '<span class="ref">--- prev close</span>');
      }
      cv.addEventListener('pointermove', e => {
        if (!geo) return;
        const r = cv.getBoundingClientRect();
        hover = Math.max(0, Math.min(geo.n - 1, Math.floor((e.clientX - r.left - geo.padL) / geo.bw)));
        draw();
      });
      cv.addEventListener('pointerleave', () => { hover = null; draw(); });
      const ro = new ResizeObserver(draw);
      ro.observe(cv);

      function quote() {
        put(qLast, fmt(i.last, i.dec), i.dir);
        qChg.textContent = signed(chg(i), i.dec) + '  ' + pctStr(chgPct(i));
        setDir(qChg, chg(i));
      }
      syncSeg(); quote(); draw();
      return { tick() { quote(); draw(); }, destroy() { ro.disconnect(); } };
    }
  };

  FN.DES = {
    name: 'Description', sec: 'req', example: 'PRSM DES',
    help: 'Company profile, key statistics, 52-week range and peers.',
    mount(p, s) {
      const i = I[s.sym];
      const eq = i.type === 'equity';
      const rows = [['Last', 'last'], ['Net change', 'chg'], ['Open', 'open'], ['Previous close', 'pc'], ['Day range', 'rng']]
        .concat(eq
          ? [['Volume', 'vol'], ['30-day avg volume', 'avg'], ['Market cap', 'cap'], ['P/E (trailing)', 'pe'], ['Dividend yield', 'div'], ['Shares outstanding', 'sh'], ['Beta vs AMX500', 'beta']]
          : [['Quote unit', 'unit'], ['1-year change', 'y1']]);
      const peers = (eq ? D.order.equity.filter(x => x !== i.sym && I[x].sector === i.sector) : [])
        .concat(D.order[i.type].filter(x => x !== i.sym && I[x].group === i.group))
        .concat(D.order[i.type].filter(x => x !== i.sym));
      const peerList = [...new Set(peers)].slice(0, 5);
      p.body.innerHTML = `
        <div class="des">
          <div class="des-head">
            <div><h3>${esc(i.name)}</h3><p class="des-sub">${esc(i.sym)} · ${TYPE_LABEL[i.type]} · ${esc(i.group)}</p></div>
            <div class="quote"><span class="q-last"></span><span class="q-chg"></span></div>
          </div>
          <div class="des-grid">
            <table class="kv"><tbody>${rows.map(([l, k]) => `<tr><th scope="row">${l}</th><td data-f="${k}"></td></tr>`).join('')}</tbody></table>
            <div class="des-side">
              <div class="r52">
                <div class="r52-lbl"><span>52-week low <b data-f="lo52"></b></span><span>high <b data-f="hi52"></b></span></div>
                <div class="r52-track"><i></i></div>
              </div>
              <div class="label spark-lbl">One year, daily close</div>
              <div class="spark-wrap"><canvas role="img" aria-label="One-year price line"></canvas></div>
              ${eq ? `<p class="about">${esc(i.about)}</p>
              <dl class="facts"><div><dt>Headquarters</dt><dd>${esc(i.hq)}</dd></div><div><dt>Founded</dt><dd>${i.founded}</dd></div><div><dt>Employees</dt><dd>${fmt(i.employees, 0)}</dd></div></dl>` : ''}
              <div class="chips"><span class="label">Open</span>
                <button type="button" class="chip" data-go="GP"><span class="fn">GP</span> Price graph</button>
                <button type="button" class="chip" data-go="NEWS"><span class="fn">NEWS</span> Headlines</button>
              </div>
              <div class="chips"><span class="label">Peers</span>${peerList.map(x => `<button type="button" class="chip" data-sym="${x}">${x}</button>`).join('')}</div>
            </div>
          </div>
        </div>`;
      const f = {};
      p.body.querySelectorAll('[data-f]').forEach(el => { f[el.dataset.f] = el; });
      const qLast = p.body.querySelector('.q-last'), qChg = p.body.querySelector('.q-chg');
      const marker = p.body.querySelector('.r52-track i');
      const cv = p.body.querySelector('.spark-wrap canvas');
      const avg30 = i.daily.slice(-31, -1).reduce((a, b) => a + b.v, 0) / 30;
      p.body.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.go) load(p, { fn: b.dataset.go, sym: i.sym });
        if (b.dataset.sym) load(p, { fn: 'DES', sym: b.dataset.sym });
      });
      const spark = () => drawSpark(cv, i.daily.map(b => b.c), i.last >= i.daily[0].c ? C.up : C.dn);
      const ro = new ResizeObserver(spark);
      ro.observe(cv);

      function update() {
        const t = todayBar(i);
        let lo = Infinity, hi = -Infinity;
        i.daily.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
        put(qLast, fmt(i.last, i.dec), i.dir);
        qChg.textContent = signed(chg(i), i.dec) + '  ' + pctStr(chgPct(i));
        setDir(qChg, chg(i));
        const v = {
          last: fmt(i.last, i.dec), chg: signed(chg(i), i.dec) + ' (' + pctStr(chgPct(i)) + ')',
          open: fmt(i.open, i.dec), pc: fmt(i.prevClose, i.dec), rng: fmt(t.l, i.dec) + ' – ' + fmt(t.h, i.dec),
          vol: big(t.v), avg: big(avg30), cap: '$' + big(i.sharesBn * 1e9 * i.last),
          pe: i.pe ? fmt(i.pe * i.last / i.price, 1) + '×' : 'n/m (loss)',
          div: i.div ? fmt(i.div * i.price / i.last, 2) + '%' : 'None',
          sh: fmt(i.sharesBn, 2) + 'B', beta: fmt(i.beta, 2),
          unit: i.unit, y1: pctStr((i.last / i.daily[0].c - 1) * 100),
          lo52: fmt(lo, i.dec), hi52: fmt(hi, i.dec)
        };
        for (const k in f) put(f[k], v[k], k === 'last' ? i.dir : null);
        setDir(f.chg, chg(i));
        marker.style.left = ((i.last - lo) / (hi - lo || 1) * 100).toFixed(2) + '%';
      }
      update();
      let n = 0;
      return { tick() { update(); if (++n % 10 === 0) spark(); }, destroy() { ro.disconnect(); } };
    }
  };

  function tableFn(name, help, groupsFn, cols, row) {
    return {
      name, help, sec: 'none',
      mount(p) {
        p.body.innerHTML = '<div class="tbl-wrap"></div>';
        const update = quoteTable(p.body.firstChild, groupsFn(), cols, sym => load(p, { fn: row(sym), sym }));
        return { tick: () => update(false) };
      }
    };
  }
  const byGroup = type => {
    const g = {};
    D.order[type].forEach(s => { (g[I[s].group] = g[I[s].group] || []).push(s); });
    return Object.keys(g).map(label => ({ label, syms: g[label] }));
  };

  FN.WEI = tableFn('World Equity Indices', 'Benchmark indices by region with net and percent change.',
    () => byGroup('index'), [COL.name, COL.sym, COL.last, COL.chg, COL.pct, COL.bar, COL.y1], () => 'GP');
  FN.CMDTY = tableFn('Commodities', 'Front-month energy, metals and agriculture futures with quote units.',
    () => byGroup('cmdty'), [COL.name, COL.sym, COL.last, COL.chg, COL.pct, COL.rng, COL.unit], () => 'GP');
  FN.MON = tableFn('Equity Monitor', 'Every equity in the universe with bid and ask, volume and an intraday sparkline.',
    () => [{ label: null, syms: D.order.equity }], [COL.sym, COL.name, COL.last, COL.chg, COL.pct, COL.ba, COL.vol, COL.spark], () => 'DES');

  FN.MOST = {
    name: 'Most Active', sec: 'none', example: 'MOST',
    help: 'Equities ranked by volume, or the biggest gainers and losers.',
    mount(p, s) {
      const TABS = { active: 'Most active', gainers: 'Gainers', losers: 'Losers' };
      s.tab = TABS[s.tab] ? s.tab : 'active';
      p.body.innerHTML = `<div class="most"><div class="most-top"><div class="seg" role="group" aria-label="Ranking">${Object.keys(TABS).map(k => `<button type="button" data-v="${k}">${TABS[k]}</button>`).join('')}</div></div><div class="tbl-wrap"></div></div>`;
      const host = p.body.querySelector('.tbl-wrap');
      let update;
      function render() {
        p.body.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s.tab)));
        const all = D.order.equity.map(x => I[x]);
        const sorted = s.tab === 'active' ? all.sort((a, b) => todayBar(b).v * b.last - todayBar(a).v * a.last)
          : all.sort((a, b) => (s.tab === 'gainers' ? 1 : -1) * (chgPct(b) - chgPct(a)));
        const fresh = host.cloneNode(false);
        host.replaceWith(fresh);
        hostRef = fresh;
        update = quoteTable(fresh, [{ label: null, syms: sorted.slice(0, 12).map(x => x.sym) }],
          [COL.sym, COL.name, COL.last, COL.pct, COL.vol, { k: 'tv', label: 'Value traded', num: 1, get: x => '$' + big(todayBar(x).v * x.last) }],
          sym => load(p, { fn: 'DES', sym }));
      }
      let hostRef = host;
      p.body.querySelector('.seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        s.tab = b.dataset.v;
        save();
        render();
      });
      render();
      let n = 0;
      return { tick() { if (++n % 5 === 0 && !hostRef.contains(document.activeElement)) render(); else update(false); } };
    }
  };

  FN.FXC = {
    name: 'Currency Matrix', sec: 'none', example: 'FXC',
    help: 'Cross rates for eight major currencies. Each cell is one unit of the row currency priced in the column currency.',
    mount(p) {
      const cur = D.currencies;
      p.body.innerHTML = `<div class="tbl-wrap"><table class="qt fxc"><caption>One unit of the row currency, priced in the column currency. Green or red shows the move since the previous close.</caption>
        <thead><tr><th scope="col"></th>${cur.map(c => `<th class="num" scope="col">${c}</th>`).join('')}</tr></thead>
        <tbody>${cur.map(r => `<tr><th class="rowh" scope="row">${r}</th>${cur.map(c => r === c ? '<td class="num diag">—</td>' : `<td class="num" data-r="${r}" data-c="${c}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      const cells = [...p.body.querySelectorAll('td[data-r]')];
      const decFor = v => (v >= 100 ? 2 : v >= 10 ? 3 : 4);
      const last = new Map();
      function update(first) {
        const now = D.perUSD(), prev = D.perUSD(true);
        cells.forEach(td => {
          const v = now[td.dataset.c] / now[td.dataset.r];
          const pv = prev[td.dataset.c] / prev[td.dataset.r];
          const old = last.get(td);
          put(td, fmt(v, decFor(v)), !first && old != null && v !== old ? (v > old ? 'up' : 'dn') : null);
          setDir(td, v - pv);
          last.set(td, v);
        });
      }
      update(true);
      return { tick: () => update(false) };
    }
  };

  FN.CRV = {
    name: 'Yield Curve', sec: 'none', example: 'CRV',
    help: 'Simulated government yield curve today, one month ago and one year ago, with changes in basis points.',
    mount(p) {
      p.body.innerHTML = `
        <div class="crv">
          <div class="crv-top"><span class="label">Government curve · yield %</span>
            <span class="key"><i class="k-now"></i>Today</span><span class="key"><i class="k-m1"></i>1 month ago</span><span class="key"><i class="k-y1"></i>1 year ago</span></div>
          <div class="chart"><canvas role="img" aria-label="Yield curve chart"></canvas></div>
          <div class="tbl-wrap crv-tbl"><table class="qt"><thead><tr><th scope="col">Tenor</th><th class="num" scope="col">Yield</th><th class="num" scope="col">1D (bp)</th><th class="num" scope="col">1M (bp)</th><th class="num" scope="col">1Y (bp)</th></tr></thead>
          <tbody>${D.curve.map(c => `<tr><td class="sym">${c.tenor}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>`).join('')}</tbody></table></div>
        </div>`;
      const cv = p.body.querySelector('canvas');
      const trs = [...p.body.querySelectorAll('tbody tr')];
      function draw() {
        const { ctx, W, H } = sizeCanvas(cv);
        if (W < 60 || H < 60) return;
        const series = [['y1', C.muted, [4, 4]], ['m1', C.link, [2, 3]], ['y', C.amber, []]];
        let lo = Infinity, hi = -Infinity;
        D.curve.forEach(c => series.forEach(([k]) => { lo = Math.min(lo, c[k]); hi = Math.max(hi, c[k]); }));
        lo -= 0.08; hi += 0.08;
        const padL = 8, padR = 48, padT = 10, padB = 22;
        const n = D.curve.length;
        const x = k => padL + (W - padL - padR) * k / (n - 1);
        const y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
        ctx.font = '11px ' + MONO;
        ctx.lineWidth = 1;
        const step = niceStep(hi - lo, Math.max(3, Math.round((H - padT - padB) / 40)));
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
          const yy = Math.round(y(v)) + 0.5;
          ctx.strokeStyle = C.grid;
          hline(ctx, padL, W - padR, yy);
          ctx.fillStyle = C.muted;
          ctx.fillText(fmt(v, 2), W - padR + 8, yy);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        D.curve.forEach((c, k) => {
          ctx.strokeStyle = C.grid;
          vline(ctx, Math.round(x(k)) + 0.5, padT, H - padB);
          ctx.fillStyle = C.muted;
          const w = ctx.measureText(c.tenor).width;
          ctx.fillText(c.tenor, Math.max(padL + w / 2, Math.min(x(k), W - padR - w / 2)), H - 6);
        });
        series.forEach(([k, col, dash]) => {
          ctx.save();
          ctx.setLineDash(dash);
          ctx.strokeStyle = col;
          ctx.lineWidth = k === 'y' ? 2 : 1.3;
          ctx.beginPath();
          D.curve.forEach((c, j) => (j ? ctx.lineTo(x(j), y(c[k])) : ctx.moveTo(x(j), y(c[k]))));
          ctx.stroke();
          ctx.restore();
        });
        ctx.fillStyle = C.amber;
        D.curve.forEach((c, j) => { ctx.beginPath(); ctx.arc(x(j), y(c.y), 2.5, 0, Math.PI * 2); ctx.fill(); });
      }
      function update(first) {
        D.curve.forEach((c, k) => {
          const td = trs[k].children;
          put(td[1], fmt(c.y, 3), first ? null : (c.y >= c.open ? 'up' : 'dn'));
          [[2, c.open], [3, c.m1], [4, c.y1]].forEach(([j, ref]) => {
            const bp = (c.y - ref) * 100;
            put(td[j], signed(bp, 1), null);
            setDir(td[j], bp);
          });
        });
      }
      const ro = new ResizeObserver(draw);
      ro.observe(cv);
      update(true);
      return { tick() { update(false); draw(); }, destroy() { ro.disconnect(); } };
    }
  };

  function newsMount(p, sym) {
    p.body.innerHTML = '<ol class="news"></ol>';
    const ol = p.body.firstChild;
    let shown = -1;
    function render() {
      const items = D.news.filter(n => !sym || n.syms.includes(sym)).slice(0, 60);
      const t = D.ticks();
      ol.innerHTML = items.map(n => `<li data-id="${n.id}" tabindex="0" class="${n.hot ? 'hot' : ''} ${n.born && t - n.born < 3 ? 'new' : ''}">
          <time>${hhmm(n.t)}</time><span class="src">${n.src}</span><span class="head">${esc(n.head)}</span><span class="tk">${n.syms.join(' ')}</span></li>`).join('') ||
        `<li class="empty">No ${esc(sym)} stories yet today. New headlines arrive as the session runs.</li>`;
      shown = D.news.length ? D.news[0].id : 0;
    }
    const open = li => li && li.dataset.id && load(p, { fn: 'STORY', id: +li.dataset.id, sym: sym || null });
    ol.addEventListener('click', e => open(e.target.closest('li')));
    ol.addEventListener('keydown', e => { if (e.key === 'Enter') open(e.target.closest('li')); });
    render();
    return { tick() { if (D.news.length && D.news[0].id !== shown) render(); } };
  }

  FN.TOP = { name: 'Top News', sec: 'none', example: 'TOP', help: 'Headlines across the market, newest first. Select one to read it.', mount: p => newsMount(p, null) };
  FN.NEWS = { name: 'Company News', sec: 'req', example: 'NVTK NEWS', help: 'Headlines that mention one security.', mount: (p, s) => newsMount(p, s.sym) };
  FN.STORY = {
    name: 'Story', sec: 'none', hidden: true,
    mount(p, s) {
      const n = D.news.find(x => x.id === s.id);
      if (!n) {
        p.body.innerHTML = '<article class="story"><p class="meta">This story is no longer in the feed.</p><button type="button" class="chip" data-back>Back to headlines</button></article>';
      } else {
        p.body.innerHTML = `<article class="story">
          <button type="button" class="chip" data-back>◀ Headlines</button>
          <p class="meta">${hhmm(n.t)} ET · ${n.src} · Amberline Wire (simulated)</p>
          <h3>${esc(n.head)}</h3>
          ${n.body.map((b, k) => `<p class="${k === n.body.length - 1 ? 'note' : ''}">${esc(b)}</p>`).join('')}
          <div class="chips"><span class="label">Securities</span>${n.syms.map(x => `<button type="button" class="chip" data-sym="${x}">${x}</button>`).join('')}</div>
        </article>`;
      }
      p.body.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-back')) back(p, { fn: s.sym ? 'NEWS' : 'TOP', sym: s.sym });
        if (b.dataset.sym) load(p, { fn: 'GP', sym: b.dataset.sym });
      });
    }
  };

  FN.HELP = {
    name: 'Help', sec: 'none', example: 'HELP',
    help: 'This page: functions, syntax and keyboard shortcuts.',
    mount(p) {
      const fns = Object.keys(FN).filter(k => !FN[k].hidden);
      p.body.innerHTML = `
        <div class="help">
          <section>
            <h3>How to type a command</h3>
            <p>Type a ticker, a function, or both, then press <kbd>Enter</kbd>. <b>NVTK GP</b> charts Novatek Systems. A ticker on its own opens its description. A function on its own reuses the ticker already in the panel. Add <b>P1</b>–<b>P4</b> to send the result to another panel.</p>
          </section>
          <section>
            <h3>Functions</h3>
            <div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Try</th><th scope="col">What it shows</th></tr></thead><tbody>
              ${fns.map(k => `<tr><td><span class="fn">${k}</span></td><td>${FN[k].name}</td><td class="sym"><button type="button" class="link" data-run="${FN[k].example || k}">${FN[k].example || k}</button></td><td class="wrap">${FN[k].help}</td></tr>`).join('')}
            </tbody></table></div>
          </section>
          <section>
            <h3>Keyboard</h3>
            <dl class="keys">
              <div><dt><kbd>F1</kbd>–<kbd>F8</kbd></dt><dd>Load a function into the active panel</dd></div>
              <div><dt><kbd>F9</kbd></dt><dd>Move to the next panel</dd></div>
              <div><dt><kbd>F10</kbd></dt><dd>Maximize or restore the active panel</dd></div>
              <div><dt><kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>4</kbd></dt><dd>Select a panel</dd></div>
              <div><dt><kbd>Tab</kbd></dt><dd>Accept the highlighted suggestion</dd></div>
              <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Command history</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>Clear the command line</dd></div>
              <div><dt>Any letter</dt><dd>Starts typing a command from anywhere</dd></div>
            </dl>
          </section>
          <section>
            <h3>About the data</h3>
            <p>Every company, index name, price, yield and headline is fictional and generated in your browser from a seeded random walk. Nothing here is investment information. Amberline is an independent design study and is not affiliated with any market-data vendor or terminal provider.</p>
          </section>
        </div>`;
      p.body.addEventListener('click', e => {
        const b = e.target.closest('[data-run]');
        if (b) run(b.dataset.run);
      });
    }
  };

  const ALIAS = { G: 'GP', CHART: 'GP', N: 'NEWS', FX: 'FXC', ACT: 'MOST', YC: 'CRV', CMD: 'CMDTY', W: 'MON', '?': 'HELP', INDEX: 'WEI', NI: 'NEWS' };

  // ---------- panels ----------
  const grid = document.getElementById('grid');
  const DEFAULT = [{ fn: 'GP', sym: 'NVTK', tf: '1D' }, { fn: 'WEI' }, { fn: 'TOP' }, { fn: 'MON' }];
  const panels = [];
  let active = 0;

  function makePanel(k) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.setAttribute('aria-label', 'Panel ' + (k + 1));
    el.innerHTML = `<header class="phead"><span class="pnum">${k + 1}</span><button class="pback" type="button" aria-label="Back" title="Back" hidden>◀</button><h2 class="ptitle"></h2><button class="pmax" type="button" aria-label="Maximize panel" title="Maximize (F10)">⤢</button></header><div class="pbody"></div>`;
    grid.appendChild(el);
    const p = { i: k, el, body: el.querySelector('.pbody'), title: el.querySelector('.ptitle'), backBtn: el.querySelector('.pback'), hist: [], state: null, ctl: {} };
    el.addEventListener('pointerdown', () => setActive(k));
    el.addEventListener('focusin', () => setActive(k));
    p.backBtn.addEventListener('click', () => back(p));
    el.querySelector('.pmax').addEventListener('click', () => toggleMax(p));
    el.querySelector('.phead').addEventListener('dblclick', () => toggleMax(p));
    return p;
  }

  function valid(state) {
    const f = state && FN[state.fn];
    return !!f && (f.sec !== 'req' || !!I[state.sym]);
  }

  function load(p, state, push = true) {
    if (!valid(state)) return false;
    const f = FN[state.fn];
    if (p.ctl && p.ctl.destroy) p.ctl.destroy();
    if (push && p.state) { p.hist.push(p.state); if (p.hist.length > 20) p.hist.shift(); }
    p.state = Object.assign({}, state);
    p.backBtn.hidden = !p.hist.length;
    const i = f.sec !== 'none' && state.sym ? I[state.sym] : null;
    const code = state.fn === 'STORY' ? 'NEWS' : state.fn;
    p.title.innerHTML = `${i ? `<span class="psym">${esc(i.sym)}</span>` : ''}<span class="fn">${code}</span><span class="pname">${esc(i ? i.name + ' · ' + f.name : f.name)}</span>`;
    p.body.scrollTop = 0;
    const fresh = p.body.cloneNode(false); // drop listeners from the previous function
    p.body.replaceWith(fresh);
    p.body = fresh;
    p.ctl = f.mount(p, p.state) || {};
    save();
    return true;
  }

  function back(p, fallback) {
    const prev = p.hist.pop();
    if (prev) load(p, prev, false);
    else if (fallback) load(p, fallback, false);
    p.backBtn.hidden = !p.hist.length;
  }

  function setActive(k) {
    if (k === active && panels[k].el.classList.contains('active')) return;
    active = k;
    panels.forEach((p, j) => p.el.classList.toggle('active', j === k));
    document.getElementById('promptPanel').textContent = k + 1;
    save();
  }

  function toggleMax(p) {
    const on = !p.el.classList.contains('max');
    panels.forEach(q => q.el.classList.remove('max'));
    p.el.classList.toggle('max', on);
    grid.classList.toggle('has-max', on);
    p.el.querySelector('.pmax').setAttribute('aria-label', on ? 'Restore panel' : 'Maximize panel');
    setActive(p.i);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ active, panels: panels.map(p => p.state) }));
    } catch (e) { /* storage unavailable: layout simply isn't remembered */ }
  }
  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && Array.isArray(raw.panels)) return raw;
    } catch (e) { /* fall through to defaults */ }
    return null;
  }

  // ---------- command line ----------
  const cmd = document.getElementById('cmd');
  const sug = document.getElementById('suggest');
  const statusEl = document.getElementById('status');
  const hist = [];
  let histIdx = 0, sugItems = [], sugIdx = -1;

  function status(html, kind) {
    statusEl.innerHTML = html;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function run(text) {
    const toks = text.trim().toUpperCase().replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    let target = active, sym = null, fn = null, tf = null;
    for (const t of toks) {
      if (/^P[1-4]$/.test(t)) target = +t[1] - 1;
      else if (!fn && FN[t] && !FN[t].hidden) fn = t;
      else if (!fn && ALIAS[t]) fn = ALIAS[t];
      else if (!sym && I[t]) sym = t;
      else if (TFS.includes(t)) tf = t;
      else if (t === 'GO') continue;
      else {
        status(`<b>${esc(t)}</b> isn't a ticker or a function code. Type <b>HELP</b> to see what's available.`, 'err');
        return;
      }
    }
    const p = panels[target];
    if (!fn && !sym && tf) fn = 'GP';
    if (!fn && !sym) { setActive(target); return; }
    if (!fn) fn = tf || I[sym].type !== 'equity' ? 'GP' : 'DES';
    if (FN[fn].sec === 'req' && !sym) {
      sym = p.state && p.state.sym && I[p.state.sym] ? p.state.sym : null;
      if (!sym) { status(`<b>${fn}</b> needs a ticker first, for example <b>NVTK ${fn}</b>.`, 'err'); return; }
    }
    const state = { fn, sym: FN[fn].sec === 'none' ? null : sym };
    if (fn === 'GP') state.tf = tf || (p.state && p.state.fn === 'GP' && p.state.sym === sym ? p.state.tf : '1D');
    setActive(target);
    load(p, state);
    status(`Panel ${target + 1}: ${sym && state.sym ? esc(sym) + ' ' : ''}${fn} · ${esc(FN[fn].name)}`);
  }

  function buildSuggestions() {
    const parts = cmd.value.split(/\s+/);
    const q = parts[parts.length - 1].toUpperCase();
    if (!q) return closeSug();
    const out = [];
    Object.keys(FN).forEach(code => {
      const f = FN[code];
      if (f.hidden) return;
      const score = code.startsWith(q) ? (code === q ? 0 : 1) : f.name.toUpperCase().includes(q) ? 3 : -1;
      if (score >= 0) out.push({ v: code, sub: f.name, kind: 'Function', score });
    });
    Object.values(I).forEach(i => {
      const score = i.sym.startsWith(q) ? (i.sym === q ? 0 : 1) : i.name.toUpperCase().includes(q) ? 2 : -1;
      if (score >= 0) out.push({ v: i.sym, sub: i.name, kind: TYPE_LABEL[i.type], score });
    });
    out.sort((a, b) => a.score - b.score || a.v.localeCompare(b.v));
    sugItems = out.slice(0, 8);
    sugIdx = -1;
    renderSug();
  }
  function renderSug() {
    sug.innerHTML = sugItems.map((s, k) => `<li role="option" id="sug-${k}" data-k="${k}" aria-selected="${k === sugIdx}"><b>${esc(s.v)}</b><span>${esc(s.sub)}</span><em>${s.kind}</em></li>`).join('');
    sug.hidden = !sugItems.length;
    cmd.setAttribute('aria-expanded', String(!sug.hidden));
    if (sugIdx >= 0) cmd.setAttribute('aria-activedescendant', 'sug-' + sugIdx);
    else cmd.removeAttribute('aria-activedescendant');
  }
  function closeSug() { sugItems = []; sugIdx = -1; renderSug(); }
  function accept(k) {
    const s = sugItems[k];
    const parts = cmd.value.split(/\s+/);
    parts[parts.length - 1] = s.v;
    cmd.value = parts.join(' ') + ' ';
    closeSug();
    cmd.focus();
    return s;
  }
  function submit() {
    const text = cmd.value.trim();
    if (!text) return;
    if (hist[hist.length - 1] !== text) hist.push(text);
    histIdx = hist.length;
    cmd.value = '';
    closeSug();
    run(text);
  }

  cmd.addEventListener('input', buildSuggestions);
  cmd.addEventListener('keydown', e => {
    const open = !sug.hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) { sugIdx = (sugIdx + 1) % sugItems.length; renderSug(); }
      else if (histIdx < hist.length) { histIdx++; cmd.value = hist[histIdx] || ''; }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) { sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length; renderSug(); }
      else if (histIdx > 0) { histIdx--; cmd.value = hist[histIdx]; }
    } else if (e.key === 'Tab' && open) {
      e.preventDefault();
      accept(Math.max(0, sugIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && sugIdx >= 0) accept(sugIdx);
      submit();
    } else if (e.key === 'Escape') {
      if (open) closeSug(); else cmd.value = '';
    }
  });
  cmd.addEventListener('blur', () => setTimeout(closeSug, 120));
  sug.addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    const s = accept(+li.dataset.k);
    if (s.kind === 'Function') submit();
  });
  document.getElementById('goBtn').addEventListener('click', () => { if (cmd.value.trim()) submit(); else cmd.focus(); });

  // ---------- function keys ----------
  const FKEYS = [
    ['F1', 'Help', () => run('HELP')],
    ['F2', 'Top news', () => run('TOP')],
    ['F3', 'Indices', () => run('WEI')],
    ['F4', 'Most active', () => run('MOST')],
    ['F5', 'FX matrix', () => run('FXC')],
    ['F6', 'Commodities', () => run('CMDTY')],
    ['F7', 'Yield curve', () => run('CRV')],
    ['F8', 'Monitor', () => run('MON')],
    ['F9', 'Next panel', () => setActive((active + 1) % panels.length)],
    ['F10', 'Maximize', () => toggleMax(panels[active])]
  ];
  const fkeys = document.getElementById('fkeys');
  fkeys.insertAdjacentHTML('afterbegin', FKEYS.map(([k, l], j) => `<button type="button" class="fkey" data-j="${j}"><kbd>${k}</kbd>${l}</button>`).join(''));
  fkeys.addEventListener('click', e => { const b = e.target.closest('.fkey'); if (b) FKEYS[+b.dataset.j][2](); });

  document.addEventListener('keydown', e => {
    const fk = FKEYS.find(([k]) => k === e.key);
    if (fk && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fk[2](); return; }
    if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); setActive(+e.key - 1); return; }
    if (e.target === cmd || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key.length === 1 && /[A-Za-z0-9?]/.test(e.key)) cmd.focus(); // the keystroke lands in the command line
  });

  // ---------- header and tape ----------
  const simClock = document.getElementById('simClock');
  const mktState = document.getElementById('mktState');
  document.getElementById('dateLbl').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()).toUpperCase();
  function clock() {
    const t = D.simNow();
    simClock.textContent = hhmm(t);
    const open = t < D.SESSION_CLOSE;
    mktState.textContent = open ? 'Market open' : 'After hours';
    mktState.classList.toggle('closed', !open);
  }

  const TAPE = ['AMX500', 'ATC100', 'NVTK', 'QSRV', 'PRSM', 'CDRW', 'ARDN', 'HLXB', 'EZ50', 'JP225', 'CL1', 'GC1', 'EURUSD', 'USDJPY', 'NBLA', 'SKYH', 'MRDN', 'VTRA'];
  const tape = document.getElementById('tape');
  const tapeItem = s => `<button type="button" class="ti" data-tape="${s}" tabindex="-1"><b>${s}</b><span class="tl"></span><span class="tc"></span></button>`;
  tape.innerHTML = TAPE.map(tapeItem).join('') + TAPE.map(tapeItem).join('');
  const tapeEls = [...tape.querySelectorAll('[data-tape]')].map(el => ({ i: I[el.dataset.tape], l: el.querySelector('.tl'), c: el.querySelector('.tc') }));
  function updateTape() {
    tapeEls.forEach(({ i, l, c }) => {
      l.textContent = fmt(i.last, i.dec);
      c.textContent = pctStr(chgPct(i));
      setDir(c, chg(i));
    });
  }
  tape.addEventListener('click', e => { const b = e.target.closest('[data-tape]'); if (b) run(b.dataset.tape + ' GP'); });

  // ---------- boot ----------
  const saved = restore();
  for (let k = 0; k < 4; k++) {
    const p = makePanel(k);
    panels.push(p);
    let st = saved && saved.panels[k];
    if (st && st.fn === 'STORY') st = { fn: st.sym ? 'NEWS' : 'TOP', sym: st.sym };
    if (!load(p, valid(st) ? st : DEFAULT[k], false)) load(p, DEFAULT[k], false);
  }
  setActive(saved && saved.active >= 0 && saved.active < 4 ? saved.active : 0);
  clock();
  updateTape();
  status('Type a ticker and a function, then press <b>Enter</b>. Try <b>PRSM GP 1Y</b>, <b>WEI</b> or <b>HELP</b>.');

  D.onTick(() => {
    panels.forEach(p => { if (p.ctl.tick) p.ctl.tick(); });
    clock();
    updateTape();
  });
  D.start();
})();
