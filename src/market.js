/*
 * Amberline Terminal: the market the panels read from.
 *
 * Every instrument is a real US stock or ETF, priced by Finnhub through the
 * viewer's own API key. Without a key the market still lists the real tickers but
 * has no prices; nothing is ever simulated. The terminal never talks to a data
 * source directly, only to this object.
 */
(function (root) {
  'use strict';

  const KEY_STORE = 'amberline.finnhub.key';
  const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const etParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
  const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const utcDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Long charts label months, adding the year only in January: "Nov", "Dec", "Jan '26".
  const monthLabel = (m, y) => (m === 0 ? "Jan '" + String(y).slice(2) : MONTHS[m]);
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

  // ---------------------------------------------------------------- live
  // Market-wide views use US-listed ETFs as stand-ins, because Finnhub's free
  // plan quotes US stocks and ETFs but not index levels, futures, spot FX or yields.
  const LIVE = {
    monitor: [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet Class A'],
      ['META', 'Meta Platforms'], ['TSLA', 'Tesla'], ['AVGO', 'Broadcom'], ['JPM', 'JPMorgan Chase'], ['V', 'Visa'],
      ['LLY', 'Eli Lilly'], ['UNH', 'UnitedHealth Group'], ['XOM', 'Exxon Mobil'], ['WMT', 'Walmart'], ['JNJ', 'Johnson & Johnson'],
      ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'], ['NFLX', 'Netflix'], ['AMD', 'Advanced Micro Devices'], ['BA', 'Boeing']],
    world: [
      ['Americas', [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq-100'], ['DIA', 'Dow Jones Industrial Avg.'], ['IWM', 'Russell 2000'], ['EWC', 'Canada'], ['EWZ', 'Brazil'], ['EWW', 'Mexico']]],
      ['EMEA', [['EZU', 'Eurozone'], ['EWU', 'United Kingdom'], ['EWG', 'Germany'], ['EWQ', 'France'], ['EWL', 'Switzerland']]],
      ['Asia-Pacific', [['EWJ', 'Japan'], ['FXI', 'China large-cap'], ['EWH', 'Hong Kong'], ['EWA', 'Australia'], ['INDA', 'India'], ['EWY', 'South Korea']]]
    ],
    cmdty: [
      ['Energy', [['USO', 'WTI crude oil'], ['BNO', 'Brent crude oil'], ['UNG', 'Natural gas']]],
      ['Metals', [['GLD', 'Gold'], ['SLV', 'Silver'], ['CPER', 'Copper'], ['PPLT', 'Platinum']]],
      ['Agriculture', [['CORN', 'Corn'], ['WEAT', 'Wheat'], ['SOYB', 'Soybeans'], ['DBA', 'Agriculture basket']]]
    ],
    rates: [['BIL', '1–3 month T-bills', 0.2, '0–3M'], ['SHY', '1–3 year', 1.9, '1–3Y'], ['IEI', '3–7 year', 4.3, '3–7Y'], ['IEF', '7–10 year', 7.1, '7–10Y'], ['TLH', '10–20 year', 11.5, '10–20Y'], ['TLT', '20+ year', 16.5, '20Y+']],
    fx: [['UUP', 'US dollar index'], ['FXE', 'Euro'], ['FXB', 'British pound'], ['FXY', 'Japanese yen'], ['FXF', 'Swiss franc'], ['FXC', 'Canadian dollar'], ['FXA', 'Australian dollar']],
    tape: ['SPY', 'QQQ', 'DIA', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'GLD', 'USO', 'TLT', 'UUP']
  };

  function liveMarket(fh, FinnhubError) {
    const I = Object.create(null); // keyed by symbols from the network, so no prototype
    const listeners = [];
    const newsCache = new Map();
    let visible = [], dirty = true, feedState = 'connecting', candlesAllowed = null, status = null;

    function mk(sym, name, type, group, extra) {
      if (!I[sym]) {
        I[sym] = Object.assign({
          sym, name, type, group, dec: 2, unit: 'USD',
          last: null, prevClose: null, open: null, high: null, low: null,
          dir: '', quotedAt: 0, dataAt: 0, tradeAt: 0, ticks: [], series: {}, missing: false
        }, extra || {});
      }
      return I[sym];
    }
    LIVE.monitor.forEach(([s, n]) => mk(s, n, 'equity', 'Large caps'));
    // Named "<market> ETF" so a chart of SPY never reads as the index level itself.
    LIVE.world.forEach(([g, list]) => list.forEach(([s, n]) => mk(s, n + ' ETF', 'etf', g, { proxy: n })));
    LIVE.cmdty.forEach(([g, list]) => list.forEach(([s, n]) => mk(s, n + ' ETF', 'etf', g, { proxy: n })));
    LIVE.rates.forEach(([s, n, dur, short]) => mk(s, n + ' Treasury ETF', 'etf', 'Treasuries', { proxy: n, duration: dur, short }));
    LIVE.fx.forEach(([s, n]) => mk(s, n + ' ETF', 'etf', 'Currencies', { proxy: n }));
    I.BIL.name = '1–3 month T-bill ETF';
    const groups = list => list.map(([label, rows]) => ({ label, syms: rows.map(r => r[0]) }));

    // Sessions are keyed by their New York trading date. Candles and the day's
    // open/high/low only take regular-hours prices (09:30-16:00 ET, or the shorter hours
    // Finnhub's holiday calendar gives); pre-market and after-hours trades move the
    // last price and the tick chart only.
    const etInfo = ms => { const p = {}; etParts.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return { day: p.year + '-' + p.month + '-' + p.day, mins: +p.hour * 60 + +p.minute, wd: p.weekday }; };
    const etDate = ms => etInfo(ms).day;
    const hours = Object.create(null); // 'YYYY-MM-DD' -> [openMins, closeMins], or null when closed
    const regular = ms => {
      const x = etInfo(ms);
      if (x.wd === 'Sat' || x.wd === 'Sun') return false;
      const h = x.day in hours ? hours[x.day] : [570, 960];
      return !!h && x.mins >= h[0] && x.mins < h[1];
    };
    function loadHolidays() {
      fh.marketHoliday().then(r => {
        (r && Array.isArray(r.data) ? r.data : []).forEach(e => {
          if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.atDate)) return;
          const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(e.tradingHour || ''));
          hours[e.atDate] = m ? [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]] : null;
        });
      }, () => {});
    }
    const utcDate = ms => new Date(ms).toISOString().slice(0, 10);
    const BAR = 5 * 60000;

    function pushTick(i, p, ms) {
      const prevTick = i.ticks[i.ticks.length - 1];
      if (prevTick && etDate(prevTick.t) !== etDate(ms)) i.ticks = []; // the tick chart shows one session
      const lt = i.ticks[i.ticks.length - 1];
      if (lt && ms - lt.t < 1000) { lt.c = p; lt.h = Math.max(lt.h, p); lt.l = Math.min(lt.l, p); }
      else i.ticks.push({ t: ms, o: p, h: p, l: p, c: p, v: 0 });
      if (i.ticks.length > 3600) i.ticks.shift();
    }

    // 5-minute bars: extend the current slot, start the next one, or start a new session.
    function mergeIntra(i, p, ms) {
      const intra = i.series['1D'];
      const b = intra && intra[intra.length - 1];
      if (!b || ms < b.t) return;
      const fresh = { t: ms - (ms % BAR), o: p, h: p, l: p, c: p, v: 0 };
      if (etDate(b.t) !== etDate(ms)) { i.series['1D'] = [fresh]; i.refIntra = i.prevClose; }
      else if (ms >= b.t + BAR) intra.push(fresh);
      else { b.c = p; b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); }
    }

    // Daily bars: keep today's bar in step with the session's open, high, low and last.
    function syncDaily(i) {
      const daily = i.series.D;
      const d = daily && daily[daily.length - 1];
      if (!d || !i.session || i.open == null) return;
      const dd = utcDate(d.t);
      const bar = { o: i.open, h: i.high, l: i.low, c: i.close != null ? i.close : i.last };
      if (dd === i.session) Object.assign(d, bar);
      else if (i.session > dd) daily.push(Object.assign({ t: Date.parse(i.session + 'T00:00:00Z'), v: 0 }, bar));
    }

    // A trade from a later trading day starts a new session for this symbol.
    function rollover(i, day) {
      if (i.session && day > i.session) {
        i.prevSession = i.session;
        i.prevRef = i.prevClose; // still the reference line for the previous session's chart
        i.prevClose = i.close != null ? i.close : i.last;
        i.open = i.high = i.low = i.close = null;
      }
      if (!i.session || day > i.session) i.session = day;
    }

    function applyQuote(i, q) {
      if (!q || (!q.c && !q.t)) { i.missing = true; return false; }
      i.quotedAt = Date.now();
      i.missing = false;
      if (!q.t) { // a price with no timestamp can't be placed in a session
        if (i.last == null) i.last = q.c;
        dirty = true;
        return true;
      }
      const qms = q.t * 1000;
      const qday = etDate(qms);
      // Streamed trades already moved this symbol into a newer session: the quote is stale,
      // but its close is the official close of the session we rolled over from.
      if (i.session && qday < i.session) {
        if (qday === i.prevSession || i.prevClose == null) {
          i.prevClose = q.c;
          const intra = i.series['1D'];
          if (intra && intra.length && etDate(intra[intra.length - 1].t) === i.session) i.refIntra = q.c;
        }
        dirty = true;
        return true;
      }
      const prev = i.last;
      const tradeNewer = i.tradeAt > qms;
      if (!tradeNewer) {
        i.last = q.c;
        i.dir = prev == null || q.c === prev ? '' : q.c > prev ? 'up' : 'dn';
      }
      // Finnhub's open, high and low describe the quote's session, so they replace ours.
      i.prevClose = q.pc; i.open = q.o || null; i.high = q.h || null; i.low = q.l || null;
      i.close = q.c;
      if (tradeNewer && regular(i.tradeAt) && etDate(i.tradeAt) === qday && i.high != null) {
        i.high = Math.max(i.high, i.last); i.low = Math.min(i.low, i.last); i.close = i.last;
      }
      i.session = qday;
      i.dataAt = Math.max(qms, i.tradeAt || 0);
      const intra = i.series['1D'];
      if (intra && intra.length && etDate(intra[intra.length - 1].t) === qday) i.refIntra = q.pc;
      if (!tradeNewer) {
        pushTick(i, q.c, qms);
        if (regular(qms)) mergeIntra(i, q.c, qms);
      }
      syncDaily(i);
      dirty = true;
      return true;
    }

    const blocking = err => !!err && (err.kind === 'auth' || err.kind === 'nokey');

    function refresh(i, pri) {
      return fh.quote(i.sym, pri).then(q => applyQuote(i, q), err => { if (blocking(err)) status = err; });
    }

    // Quote scheduler: fill in symbols that are on screen first, then keep them fresh,
    // leaving headroom in the per-minute budget for charts, profiles and news.
    function schedule() {
      if (blocking(status)) return; // a missing or rejected key won't start working on its own
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

    let stream = null, streamError = null;
    function startStream() {
      stream = fh.stream((s, p, v, ms) => {
        const i = I[s];
        if (!i || !(p > 0) || !(ms > 0)) return;
        if (ms < i.tradeAt) { // a late, older print: it can widen the range but never sets the last price
          if (regular(ms) && etDate(ms) === i.session && i.high != null) { i.high = Math.max(i.high, p); i.low = Math.min(i.low, p); }
          return;
        }
        rollover(i, etDate(ms));
        i.dir = i.last == null || p === i.last ? i.dir : p > i.last ? 'up' : 'dn';
        i.last = p;
        i.tradeAt = ms;
        i.dataAt = Math.max(i.dataAt, ms);
        pushTick(i, p, ms);
        if (regular(ms)) {
          if (i.open == null) i.open = p;
          i.high = i.high == null ? p : Math.max(i.high, p);
          i.low = i.low == null ? p : Math.min(i.low, p);
          i.close = p;
          mergeIntra(i, p, ms);
          syncDaily(i);
        }
        dirty = true;
      }, st => { feedState = st; dirty = true; }, msg => { streamError = msg; dirty = true; });
    }

    function marketStatus() {
      fh.marketStatus().then(s => { status = blocking(status) ? status : null; market = s; }, () => {});
    }
    let market = null;

    const fmtDaily = long => (long ? b => monthLabel(new Date(b.t).getUTCMonth(), new Date(b.t).getUTCFullYear()) : b => utcDay.format(b.t));
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
      authError: () => (blocking(status) ? status : null),
      streamError: () => streamError,
      requests: () => fh.budget(),
      candles: () => candlesAllowed,
      feed() {
        if (!api.hasKey) return { label: 'No API key · not connected', state: 'poll' };
        const src = api.mock ? 'Mock API' : 'Finnhub';
        const label = src + (feedState === 'open' ? ' · streaming' : feedState === 'connecting' ? ' · connecting' : ' · polling');
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
          if (x.name === sym) fh.profile(sym).then(p => { if (p && p.name) { x.name = String(p.name); dirty = true; } }, () => {});
          return x;
        });
      },
      find(q) {
        return fh.search(q).then(r => (r && r.result ? r.result : [])
          .filter(x => typeof x.symbol === 'string' && /^[A-Z][A-Z.]{0,5}$/.test(x.symbol))
          .slice(0, 8)
          .map(x => ({ sym: x.symbol, name: String(x.description || x.symbol), kind: x.type === 'ETP' ? 'ETF' : 'Equity' })), () => []);
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
          // Series live on the instrument so every chart of it shares one copy that
          // streamed prices keep current. Charts read them through closures, never a snapshot.
          if (intraday) {
            bars = bars.filter(b => regular(b.t));
            if (!bars.length) return ticks('Finnhub returned no regular-session bars for the last few days.');
            const lastDay = etDate(bars[bars.length - 1].t);
            bars = bars.filter(b => etDate(b.t) === lastDay);
            i.series['1D'] = bars;
            i.refIntra = lastDay === i.session ? i.prevClose : lastDay === i.prevSession ? i.prevRef : null;
            const b = bars[bars.length - 1];
            if (lastDay === i.session && i.close != null) { b.c = i.close; b.h = Math.max(b.h, i.close); b.l = Math.min(b.l, i.close); }
            return { kind: 'intraday', ref: () => i.refIntra, series: () => i.series['1D'] || [], xlabel: b2 => etTime.format(b2.t), tlabel: b2 => etDay.format(b2.t) + ' ' + etTime.format(b2.t) + ' ET' };
          }
          // Merge rather than replace: a 1M fetch must not cut short a 1Y chart of the same symbol.
          const older = (i.series.D || []).filter(b => b.t < bars[0].t);
          i.series.D = older.concat(bars);
          syncDaily(i);
          const len = SPANS[tf];
          const long = tf === '6M' || tf === '1Y';
          const all = () => i.series.D || [];
          return {
            kind: 'daily',
            series: () => all().slice(Math.max(0, all().length - len)),
            ma: () => ({ src: all(), off: Math.max(0, all().length - len) }),
            xlabel: fmtDaily(long), tlabel: fmtDaily(false), monthly: long
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
          if (P.name && !i.proxy) { i.name = String(P.name); dirty = true; }
          const pick = (...ks) => { for (const k of ks) if (Mx[k] != null && isFinite(Mx[k])) return +Mx[k]; return null; };
          const facts = [];
          if (i.proxy) facts.push(['Tracks', i.proxy + (i.duration ? ' · duration about ' + i.duration + ' yrs (approx.)' : '')]);
          if (P.exchange) facts.push(['Exchange', String(P.exchange)]);
          if (P.country) facts.push(['Country', String(P.country)]);
          if (P.ipo) facts.push(['Listed', String(P.ipo)]);
          const web = safeUrl(P.weburl);
          const failed = [p, m].filter(x => x.status === 'rejected').map(x => x.reason);
          return {
            sector: P.finnhubIndustry ? String(P.finnhubIndustry) : i.group,
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
      newsVersion: () => Math.floor(Date.now() / (4 * 60e3)), // refetch headlines every 4 minutes
      story: id => newsCache.get(String(id)) || null,
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
        if (stream) stream.set(visible); // subscribe whatever panels registered before the socket existed
        if (fh.marketHoliday) { loadHolidays(); setInterval(loadHolidays, 12 * 3600e3); }
        marketStatus();
        setInterval(marketStatus, 5 * 60e3);
        setInterval(schedule, 2000);
        setInterval(() => { listeners.forEach(fn => fn()); dirty = false; }, 1000);
      }
    };
    return api;
  }

  // ---------------------------------------------------------------- boot
  // Without a key, every request fails with a "nokey" error that the panels explain.
  function noKeyClient(FinnhubError) {
    const fail = () => Promise.reject(new FinnhubError('nokey', "No Finnhub API key yet, so real prices, charts and news can't load. Type KEY to add one."));
    return {
      budget: () => ({ used: 0, perMinute: 50, queued: 0 }),
      quote: fail, profile: fail, metrics: fail, peers: fail, marketNews: fail, companyNews: fail,
      candles: fail, search: fail, marketStatus: fail,
      stream(onTrade, onState) { onState('off'); return { set() {}, close() {} }; }
    };
  }

  const key = readKey();
  const dev = key ? devEndpoints() : {};
  const fh = key ? root.Finnhub.create(Object.assign({ key }, dev)) : noKeyClient(root.Finnhub.FinnhubError);
  const market = liveMarket(fh, root.Finnhub.FinnhubError);
  market.endpoint = dev.api || root.Finnhub.DEFAULT_API;
  market.mock = !!dev.api; // the local mock server serves made-up data
  market.hasKey = !!key;
  market.setKey = k => { const ok = writeKey(k); return ok; };
  root.AmberlineMarket = market;
})(window);
