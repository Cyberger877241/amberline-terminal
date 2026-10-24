/*
 * Amberline Terminal: the market the panels read from.
 *
 * Two implementations share one interface:
 *   live  real US stocks and ETFs from Finnhub, using the viewer's own API key
 *   demo  fictional securities from data.js, used when no key is saved
 * The terminal never talks to a data source directly, only to this object.
 */
(function (root) {
  'use strict';

  const KEY_STORE = 'amberline.finnhub.key';
  const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const etParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
  const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const utcDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const utcMon = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' });
  const pad = n => String(n).padStart(2, '0');
  const hhmm = min => pad(Math.floor(min / 60) % 24) + ':' + pad(Math.floor(min % 60));

  function readKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function writeKey(k) {
    try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); return true; } catch (e) { return false; }
  }

  // Developer override for the bundled mock server (tools/mock_finnhub.py). Honored only
  // when both the page and the endpoint are on this machine, so a crafted link can't
  // send a saved key to someone else's server.
  function devEndpoints() {
    const local = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    const out = {};
    if (!local(location.hostname)) return out;
    const q = new URLSearchParams(location.search);
    if (q.get('ws') === 'off') out.ws = null;
    [['api', /^https?:$/], ['ws', /^wss?:$/]].forEach(([k, proto]) => {
      const v = q.get(k);
      if (!v || v === 'off') return;
      try {
        const u = new URL(v);
        if (proto.test(u.protocol) && local(u.hostname)) out[k] = u.href.replace(/\/$/, '');
      } catch (e) { /* ignore malformed override */ }
    });
    return out;
  }

  function safeUrl(u) {
    try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; }
  }

  function etNow() {
    const p = {};
    etParts.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return { wd: p.weekday, mins: +p.hour * 60 + +p.minute, date: p.year + '-' + p.month + '-' + p.day };
  }

  // ---------------------------------------------------------------- demo
  function demoMarket(D) {
    const I = D.inst;
    const byGroup = type => {
      const g = {};
      D.order[type].forEach(s => { (g[I[s].group] = g[I[s].group] || []).push(s); });
      return Object.keys(g).map(label => ({ label, syms: g[label] }));
    };
    let lastNewsId = -1;
    const newsItem = n => ({ id: n.id, t: n.t, when: hhmm(n.t), src: n.src, head: n.head, body: n.body, url: null, syms: n.syms, hot: n.hot, born: n.born });
    return {
      mode: 'demo',
      demo: D,
      inst: I,
      universe: {
        monitor: D.order.equity,
        world: byGroup('index'),
        cmdty: byGroup('cmdty'),
        tape: ['AMX500', 'ATC100', 'NVTK', 'QSRV', 'PRSM', 'CDRW', 'ARDN', 'HLXB', 'EZ50', 'JP225', 'CL1', 'GC1', 'EURUSD', 'USDJPY', 'NBLA', 'SKYH', 'MRDN', 'VTRA']
      },
      feed: () => ({ label: 'Simulated feed', state: 'demo' }),
      clock() {
        const t = D.simNow(), open = t < D.SESSION_CLOSE;
        return { time: hhmm(t), prefix: 'Session', state: open ? 'Market open' : 'After hours', open };
      },
      day(i) { const b = i.daily[i.daily.length - 1]; return { o: i.open, h: b.h, l: b.l, v: b.v }; },
      ensure(sym) { return I[sym] ? Promise.resolve(I[sym]) : Promise.reject(new Error(`${sym} isn't in the demo universe. Type MON to see the tickers you can use.`)); },
      find(q) { return Promise.resolve([]); },
      bars(sym, tf) {
        const i = I[sym];
        if (tf === '1D') {
          return Promise.resolve({ kind: 'intraday', ref: () => i.prevClose, series: () => i.intra, xlabel: b => hhmm(b.t), tlabel: b => hhmm(b.t) + ' ET' });
        }
        const len = { '1M': 22, '3M': 63, '6M': 126, '1Y': 252 }[tf];
        const long = tf === '6M' || tf === '1Y';
        const local = new Intl.DateTimeFormat('en-US', long ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
        const dayLbl = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
        return Promise.resolve({
          kind: 'daily',
          series: () => i.daily.slice(Math.max(0, i.daily.length - len)),
          ma: () => ({ src: i.daily, off: Math.max(0, i.daily.length - len) }),
          xlabel: b => local.format(b.t), tlabel: b => dayLbl.format(b.t)
        });
      },
      profile(sym) {
        const i = I[sym];
        if (i.type !== 'equity') return Promise.resolve({ sector: i.group, facts: [['Quote unit', i.unit]], stats: {}, peers: D.order[i.type].filter(x => x !== sym && I[x].group === i.group).slice(0, 5), source: 'Simulated' });
        let lo = Infinity, hi = -Infinity;
        i.daily.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
        return Promise.resolve({
          sector: i.sector, about: i.about,
          facts: [['Headquarters', i.hq], ['Founded', String(i.founded)], ['Employees', i.employees.toLocaleString('en-US')]],
          stats: {
            cap: () => i.sharesBn * 1e9 * i.last, sh: i.sharesBn * 1e9,
            pe: i.pe ? () => i.pe * i.last / i.price : null, div: i.div ? () => i.div * i.price / i.last : 0,
            beta: i.beta, hi52: hi, lo52: lo,
            avgVol: i.daily.slice(-31, -1).reduce((a, b) => a + b.v, 0) / 30
          },
          spark: () => i.daily.map(b => b.c),
          peers: D.order.equity.filter(x => x !== sym && I[x].sector === i.sector).concat(D.order.equity.filter(x => x !== sym)).filter((x, k, a) => a.indexOf(x) === k).slice(0, 5),
          source: 'Simulated'
        });
      },
      news(sym) { return Promise.resolve(D.news.filter(n => !sym || n.syms.includes(sym)).slice(0, 60).map(newsItem)); },
      newsChanged() { const id = D.news.length ? D.news[0].id : 0; const changed = id !== lastNewsId; lastNewsId = id; return changed; },
      story(id) { const n = D.news.find(x => String(x.id) === String(id)); return n ? newsItem(n) : null; },
      ticks: () => D.ticks(),
      watch() {},
      onTick: fn => D.onTick(fn),
      start: () => D.start()
    };
  }

  // ---------------------------------------------------------------- live
  // Market-wide views use US-listed ETFs as stand-ins, because Finnhub's free
  // plan quotes US stocks and ETFs but not index levels, futures or FX rates.
  const LIVE = {
    monitor: [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet Class A'],
      ['META', 'Meta Platforms'], ['TSLA', 'Tesla'], ['AVGO', 'Broadcom'], ['JPM', 'JPMorgan Chase'], ['V', 'Visa'],
      ['LLY', 'Eli Lilly'], ['UNH', 'UnitedHealth Group'], ['XOM', 'Exxon Mobil'], ['WMT', 'Walmart'], ['JNJ', 'Johnson & Johnson'],
      ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'], ['NFLX', 'Netflix'], ['AMD', 'Advanced Micro Devices'], ['BA', 'Boeing']],
    world: [
      ['Americas', [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq-100'], ['DIA', 'Dow Jones Industrial Average'], ['IWM', 'Russell 2000'], ['EWC', 'Canada'], ['EWZ', 'Brazil'], ['EWW', 'Mexico']]],
      ['EMEA', [['EZU', 'Eurozone'], ['EWU', 'United Kingdom'], ['EWG', 'Germany'], ['EWQ', 'France'], ['EWL', 'Switzerland']]],
      ['Asia-Pacific', [['EWJ', 'Japan'], ['FXI', 'China large-cap'], ['EWH', 'Hong Kong'], ['EWA', 'Australia'], ['INDA', 'India'], ['EWY', 'South Korea']]]
    ],
    cmdty: [
      ['Energy', [['USO', 'WTI crude oil'], ['BNO', 'Brent crude oil'], ['UNG', 'Natural gas']]],
      ['Metals', [['GLD', 'Gold'], ['SLV', 'Silver'], ['CPER', 'Copper'], ['PPLT', 'Platinum']]],
      ['Agriculture', [['CORN', 'Corn'], ['WEAT', 'Wheat'], ['SOYB', 'Soybeans'], ['DBA', 'Agriculture basket']]]
    ],
    rates: [['BIL', '1–3 month T-bills', 0.2, '0–3M'], ['SHY', '1–3 year', 1.9, '1–3Y'], ['IEI', '3–7 year', 4.3, '3–7Y'], ['IEF', '7–10 year', 7.1, '7–10Y'], ['TLH', '10–20 year', 11.5, '10–20Y'], ['TLT', '20+ year', 16.5, '20Y+']],
    fx: [['UUP', 'US dollar vs. major currencies'], ['FXE', 'Euro'], ['FXB', 'British pound'], ['FXY', 'Japanese yen'], ['FXF', 'Swiss franc'], ['FXC', 'Canadian dollar'], ['FXA', 'Australian dollar']],
    tape: ['SPY', 'QQQ', 'DIA', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'GLD', 'USO', 'TLT', 'UUP']
  };

  function liveMarket(fh, FinnhubError) {
    const I = {};
    const listeners = [];
    const newsCache = new Map();
    let visible = [], dirty = true, feedState = 'connecting', candlesAllowed = null, status = null, newsStamp = 0;

    function mk(sym, name, type, group, extra) {
      if (!I[sym]) {
        I[sym] = Object.assign({
          sym, name, type, group, dec: 2, unit: 'USD',
          last: null, prevClose: null, open: null, high: null, low: null,
          dir: '', quotedAt: 0, tradeAt: 0, ticks: [], series: {}, missing: false
        }, extra || {});
      }
      return I[sym];
    }
    LIVE.monitor.forEach(([s, n]) => mk(s, n, 'equity', 'Large caps'));
    LIVE.world.forEach(([g, list]) => list.forEach(([s, n]) => mk(s, n, 'etf', g, { proxy: n })));
    LIVE.cmdty.forEach(([g, list]) => list.forEach(([s, n]) => mk(s, n, 'etf', g, { proxy: n })));
    LIVE.rates.forEach(([s, n, dur, short]) => mk(s, n + ' Treasuries', 'etf', 'Treasuries', { proxy: n, duration: dur, short }));
    LIVE.fx.forEach(([s, n]) => mk(s, n, 'etf', 'Currencies', { proxy: n }));
    I.BIL.name = '1–3 month T-bills';
    const groups = list => list.map(([label, rows]) => ({ label, syms: rows.map(r => r[0]) }));

    function pushTick(i, p, ms) {
      const last = i.ticks[i.ticks.length - 1];
      if (last && ms - last.t < 1000) { last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); }
      else i.ticks.push({ t: ms, o: p, h: p, l: p, c: p, v: 0 });
      if (i.ticks.length > 3600) i.ticks.shift();
    }

    function applyQuote(i, q) {
      if (!q || (!q.c && !q.t)) { i.missing = true; return false; }
      const prev = i.last;
      // A streamed trade is fresher than a quote that was cached before it arrived.
      if (!(i.tradeAt && i.tradeAt > q.t * 1000)) {
        i.last = q.c;
        i.dir = prev == null || q.c === prev ? '' : q.c > prev ? 'up' : 'dn';
      }
      i.prevClose = q.pc; i.open = q.o;
      i.high = Math.max(q.h || 0, i.high || 0) || q.h; i.low = i.low ? Math.min(q.l, i.low) : q.l;
      i.quotedAt = Date.now();
      i.missing = false;
      Object.values(i.series).forEach(sr => {
        const b = sr[sr.length - 1];
        if (b && !(i.tradeAt > q.t * 1000)) { b.c = i.last; b.h = Math.max(b.h, i.last); b.l = Math.min(b.l, i.last); }
      });
      if (!i.ticks.length) pushTick(i, i.last, q.t * 1000);
      dirty = true;
      return true;
    }

    function refresh(i, pri) {
      return fh.quote(i.sym, pri).then(q => applyQuote(i, q), err => { if (err.kind === 'auth') status = err; });
    }

    // Quote scheduler: fill in symbols that are on screen first, then keep them fresh,
    // leaving headroom in the per-minute budget for charts, profiles and news.
    function schedule() {
      if (status && status.kind === 'auth') return; // a rejected key won't start working on its own
      const b = fh.budget();
      let room = Math.max(0, b.perMinute - 14 - b.used - b.queued);
      if (!room) return;
      const now = Date.now();
      const stale = 60000;
      const want = visible.map(s => I[s]).filter(i => i && !i.missing && now - i.quotedAt > stale && !i.pending);
      want.sort((a, b2) => a.quotedAt - b2.quotedAt);
      want.slice(0, Math.min(room, 8)).forEach(i => {
        i.pending = true;
        refresh(i, i.quotedAt ? 1 : 2).finally(() => { i.pending = false; });
      });
    }

    let stream = null;
    function startStream() {
      stream = fh.stream((s, p, v, ms) => {
        const i = I[s];
        if (!i || !(p > 0)) return;
        i.dir = i.last == null || p === i.last ? i.dir : p > i.last ? 'up' : 'dn';
        i.last = p;
        i.tradeAt = ms;
        if (i.high != null) i.high = Math.max(i.high, p);
        if (i.low != null) i.low = Math.min(i.low, p);
        pushTick(i, p, ms);
        Object.values(i.series).forEach(sr => {
          const b = sr[sr.length - 1];
          if (b) { b.c = p; b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); }
        });
        dirty = true;
      }, st => { feedState = st; dirty = true; });
    }

    function marketStatus() {
      fh.marketStatus().then(s => { status = status && status.kind === 'auth' ? status : null; market = s; }, () => {});
    }
    let market = null;

    const fmtDaily = (long) => b => (long ? utcMon : utcDay).format(b.t);
    const SPANS = { '1M': 22, '3M': 63, '6M': 126, '1Y': 252 };

    const api = {
      mode: 'live',
      inst: I,
      universe: {
        monitor: LIVE.monitor.map(r => r[0]),
        world: groups(LIVE.world),
        cmdty: groups(LIVE.cmdty),
        rates: LIVE.rates.map(r => r[0]),
        fx: LIVE.fx.map(r => r[0]),
        tape: LIVE.tape
      },
      authError: () => (status && status.kind === 'auth' ? status : null),
      requests: () => fh.budget(),
      candles: () => candlesAllowed,
      feed() {
        const label = feedState === 'open' ? 'Finnhub · streaming' : feedState === 'connecting' ? 'Finnhub · connecting' : 'Finnhub · polling';
        return { label, state: feedState === 'open' ? 'live' : 'poll' };
      },
      clock() {
        const n = etNow();
        let state;
        if (market && typeof market.isOpen === 'boolean') {
          state = market.holiday ? 'Closed · ' + market.holiday
            : market.isOpen ? 'Market open'
            : market.session === 'pre-market' ? 'Pre-market'
            : market.session === 'post-market' ? 'After hours' : 'Market closed';
        } else if (n.wd === 'Sat' || n.wd === 'Sun') state = 'Market closed';
        else state = n.mins < 240 ? 'Market closed' : n.mins < 570 ? 'Pre-market' : n.mins < 960 ? 'Market open' : n.mins < 1200 ? 'After hours' : 'Market closed';
        return { time: hhmm(n.mins), prefix: 'New York', state, open: state === 'Market open' };
      },
      day(i) { return { o: i.open, h: i.high, l: i.low, v: null }; },
      ensure(sym) {
        const i = I[sym];
        if (i && i.missing) return Promise.reject(new FinnhubError('notfound', `Finnhub has no quote for ${sym}. Check the ticker.`));
        if (i && i.quotedAt) return Promise.resolve(i);
        return fh.quote(sym, 3).then(q => {
          if (!q || (!q.c && !q.t)) throw new FinnhubError('notfound', `Finnhub has no quote for ${sym}. Check the ticker.`);
          const x = mk(sym, sym, 'equity', 'Search result');
          applyQuote(x, q);
          if (x.name === sym) fh.profile(sym).then(p => { if (p && p.name) { x.name = p.name; dirty = true; } }, () => {});
          return x;
        });
      },
      find(q) {
        return fh.search(q).then(r => (r && r.result ? r.result : [])
          .filter(x => x.symbol && !x.symbol.includes('.') || /^[A-Z]+\.[A-Z]$/.test(x.symbol))
          .slice(0, 8)
          .map(x => ({ sym: x.symbol, name: x.description || x.symbol, kind: x.type === 'ETP' ? 'ETF' : 'Equity' })), () => []);
      },
      bars(sym, tf) {
        const i = I[sym];
        const ticks = note => ({
          kind: 'ticks', note,
          ref: () => i.prevClose,
          series: () => i.ticks,
          xlabel: b => etTime.format(b.t), tlabel: b => etTime.format(b.t) + ' ET'
        });
        const fallback = "Historical candles aren't included in your Finnhub plan, so this chart plots live trades and quotes since you opened the page.";
        if (candlesAllowed === false) return Promise.resolve(ticks(fallback));
        const now = Math.floor(Date.now() / 1000);
        const intraday = tf === '1D';
        const from = intraday ? now - 5 * 86400 : now - Math.ceil((SPANS[tf] + 90) * 1.5) * 86400;
        return fh.candles(sym, intraday ? '5' : 'D', from, now).then(r => {
          candlesAllowed = true;
          let bars = r && r.s === 'ok' && Array.isArray(r.t)
            ? r.t.map((t, k) => ({ t: t * 1000, o: r.o[k], h: r.h[k], l: r.l[k], c: r.c[k], v: r.v ? r.v[k] : 0 }))
            : [];
          if (!bars.length) return ticks('Finnhub returned no bars for this range.');
          if (intraday) {
            const lastDay = etDay.format(bars[bars.length - 1].t);
            bars = bars.filter(b => etDay.format(b.t) === lastDay);
            i.series['1D'] = bars;
            return { kind: 'intraday', ref: () => i.prevClose, series: () => bars, xlabel: b => etTime.format(b.t), tlabel: b => etDay.format(b.t) + ' ' + etTime.format(b.t) + ' ET' };
          }
          i.series.D = bars;
          const len = SPANS[tf];
          const long = tf === '6M' || tf === '1Y';
          return {
            kind: 'daily',
            series: () => bars.slice(Math.max(0, bars.length - len)),
            ma: () => ({ src: bars, off: Math.max(0, bars.length - len) }),
            xlabel: fmtDaily(long), tlabel: fmtDaily(false)
          };
        }, err => {
          if (err.kind === 'premium') { candlesAllowed = false; return ticks(fallback); }
          throw err;
        });
      },
      profile(sym) {
        const i = I[sym];
        return Promise.allSettled([fh.profile(sym), fh.metrics(sym), fh.peers(sym)]).then(([p, m, pe]) => {
          const P = p.status === 'fulfilled' && p.value ? p.value : {};
          const Mx = m.status === 'fulfilled' && m.value && m.value.metric ? m.value.metric : {};
          if (P.name && !i.proxy) { i.name = P.name; dirty = true; }
          const pick = (...ks) => { for (const k of ks) if (Mx[k] != null && isFinite(Mx[k])) return +Mx[k]; return null; };
          const facts = [];
          if (i.proxy) facts.push(['Tracks', i.proxy + (i.duration ? ' · avg. duration ' + i.duration + ' yrs' : '')]);
          if (P.exchange) facts.push(['Exchange', P.exchange]);
          if (P.country) facts.push(['Country', P.country]);
          if (P.ipo) facts.push(['Listed', P.ipo]);
          const web = safeUrl(P.weburl);
          const failed = [p, m].filter(x => x.status === 'rejected').map(x => x.reason);
          return {
            sector: P.finnhubIndustry || i.group,
            about: null,
            facts, web,
            stats: {
              cap: P.marketCapitalization ? P.marketCapitalization * 1e6 : null,
              sh: P.shareOutstanding ? P.shareOutstanding * 1e6 : null,
              pe: pick('peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM'),
              eps: pick('epsTTM', 'epsBasicExclExtraItemsTTM', 'epsExclExtraItemsTTM'),
              div: pick('currentDividendYieldTTM', 'dividendYieldIndicatedAnnual'),
              beta: pick('beta'),
              hi52: pick('52WeekHigh'), lo52: pick('52WeekLow'),
              avgVol: pick('10DayAverageTradingVolume') != null ? pick('10DayAverageTradingVolume') * 1e6 : null
            },
            peers: pe.status === 'fulfilled' && Array.isArray(pe.value) ? pe.value.filter(x => x !== sym && /^[A-Z.]{1,6}$/.test(x)).slice(0, 6) : [],
            source: 'Finnhub',
            error: failed.length === 2 ? failed[0] : null
          };
        });
      },
      news(sym) {
        const req = sym ? fh.companyNews(sym) : fh.marketNews();
        return req.then(list => {
          const out = (Array.isArray(list) ? list : []).filter(n => n && n.headline).slice(0, 60).map(n => {
            const t = (+n.datetime || 0) * 1000;
            const item = {
              id: 'n' + n.id, t,
              when: etDay.format(t) === etDay.format(Date.now()) ? etTime.format(t) : etDay.format(t),
              src: String(n.source || 'Finnhub'),
              head: String(n.headline),
              body: n.summary ? [String(n.summary)] : [],
              url: safeUrl(n.url),
              syms: String(n.related || '').split(',').map(s => s.trim()).filter(s => /^[A-Z.]{1,6}$/.test(s)).slice(0, 4),
              hot: Date.now() - t < 3600e3
            };
            newsCache.set(item.id, item);
            return item;
          });
          return out.sort((a, b) => b.t - a.t);
        });
      },
      newsChanged() { if (Date.now() - newsStamp > 4 * 60e3) { newsStamp = Date.now(); return true; } return false; },
      story: id => newsCache.get(String(id)) || null,
      ticks: () => 0,
      watch(syms) {
        const next = [...new Set(syms.filter(s => I[s]))];
        if (next.join() === visible.join()) return;
        visible = next;
        if (stream) stream.set(visible);
        schedule();
      },
      onTick: fn => listeners.push(fn),
      start() {
        startStream();
        marketStatus();
        setInterval(marketStatus, 5 * 60e3);
        setInterval(schedule, 2000);
        setInterval(() => { listeners.forEach(fn => fn()); dirty = false; }, 1000);
      }
    };
    return api;
  }

  // ---------------------------------------------------------------- boot
  const key = readKey();
  let market;
  if (key && root.Finnhub) {
    const dev = devEndpoints();
    const fh = root.Finnhub.create(Object.assign({ key }, dev));
    market = liveMarket(fh, root.Finnhub.FinnhubError);
    market.endpoint = dev.api || root.Finnhub.DEFAULT_API;
  } else {
    market = demoMarket(root.AmberlineData);
  }
  market.hasKey = !!key;
  market.setKey = k => { const ok = writeKey(k); return ok; };
  root.AmberlineMarket = market;
})(window);
