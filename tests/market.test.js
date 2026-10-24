// Session-boundary tests for src/market.js, run with: node tests/market.test.js
// A fake Finnhub client feeds quotes, candles, holidays and streamed trades into the
// live market. Nothing here touches the network: fetch and WebSocket are undefined.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'market.js'), 'utf8');

function boot(opts = {}) {
  let onTrade = null;
  const subs = [];
  const quotes = {};
  const candleSets = opts.candles || {};
  const client = {
    budget: () => ({ used: 0, perMinute: 50, queued: 0 }),
    quote: sym => Promise.resolve(quotes[sym]),
    profile: () => Promise.resolve({}), metrics: () => Promise.resolve({}), peers: () => Promise.resolve([]),
    marketStatus: () => Promise.reject(new Error('not in tests')),
    marketHoliday: () => Promise.resolve({ data: opts.holidays || [] }),
    candles: (sym, res) => Promise.resolve(candleSets[res]),
    stream(t) { onTrade = t; return { set(list) { subs.push(...list); }, close() {} }; }
  };
  const win = {
    localStorage: { getItem: () => 'testkeytestkey', setItem() {}, removeItem() {} },
    location: { hostname: 'example.com', search: '' },
    Finnhub: { create: () => client, FinnhubError: Error, DEFAULT_API: 'x' }
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, {
    Intl, Date, Math, URL, URLSearchParams, Promise, console,
    setInterval: () => 0, fetch: undefined, WebSocket: undefined
  }));
  vm.runInContext(src, ctx);
  return { M: win.AmberlineMarket, quotes, trade: (s, p, ms) => onTrade(s, p, 0, ms), subs };
}

// New York is UTC-4 until early November 2026 and UTC-5 after.
const et = (day, hh, mm) => {
  const off = day < '2026-11-01' ? 4 : 5;
  return Date.parse(`${day}T00:00:00Z`) + ((hh + off) * 60 + mm) * 60000;
};
const sec = ms => ms / 1000;
const tick = () => new Promise(r => setTimeout(r, 0));
let fails = 0;
const check = (name, got, want) => {
  const okv = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
  console.log((okv ? 'PASS ' : 'FAIL ') + name + ' got=' + got + ' want=' + want);
  if (!okv) fails++;
};
const fiveMinBars = (day, fromH, fromM, toH, toM) => {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (let ms = et(day, fromH, fromM); ms <= et(day, toH, toM); ms += 300000) {
    t.push(sec(ms)); o.push(100); h.push(101); l.push(99); c.push(100); v.push(10);
  }
  return { s: 'ok', t, o, h, l, c, v };
};
const dailyBars = (days) => {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  const end = Date.parse('2026-10-22T00:00:00Z');
  for (let k = days - 1; k >= 0; k--) {
    const ms = end - k * 864e5;
    const wd = new Date(ms).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    t.push(sec(ms)); o.push(95); h.push(99); l.push(94); c.push(98); v.push(1);
  }
  return { s: 'ok', t, o, h, l, c, v };
};

(async () => {
  console.log('-- overnight rollover');
  {
    const { M, quotes, trade } = boot();
    M.watch(['AAPL']);
    M.start();
    quotes.AAPL = { c: 100, pc: 98, o: 99, h: 103, l: 97, t: sec(et('2026-10-22', 16, 0)) };
    await M.ensure('AAPL');
    const i = M.inst.AAPL;
    check('prevClose from quote', i.prevClose, 98);
    trade('AAPL', 105, et('2026-10-23', 4, 30));
    check('rollover prevClose = yesterday close', i.prevClose, 100);
    check('pre-market does not set open', i.open, null);
    check('change vs yesterday close', i.last - i.prevClose, 5);
    trade('AAPL', 106, et('2026-10-23', 9, 31));
    check('regular trade sets open', i.open, 106);
    check('regular trade sets high', i.high, 106);
  }

  console.log('-- late official close corrects the rolled prevClose');
  {
    const { M, quotes, trade } = boot();
    M.start();
    quotes.AAPL = { c: 150.5, pc: 149, o: 149, h: 151, l: 148, t: sec(et('2026-10-22', 15, 58)) };
    await M.ensure('AAPL');
    const i = M.inst.AAPL;
    trade('AAPL', 152, et('2026-10-23', 7, 0));
    check('rolled from last print', i.prevClose, 150.5);
    // the scheduler refreshes the quote: it still describes yesterday, with the official close
    quotes.AAPL = { c: 151, pc: 149, o: 149, h: 151.2, l: 148, t: sec(et('2026-10-22', 16, 0)) };
    i.quotedAt = 0;
    M.watch(['AAPL']); // watching runs the quote scheduler
    await tick(); await tick();
    check('official close replaces last print', i.prevClose, 151);
    check('session stays today', i.session, '2026-10-23');
  }
  {
    const { M, quotes, trade } = boot();
    M.start();
    trade('AAPL', 50, et('2026-10-23', 5, 0)); // a trade arrives before any quote
    quotes.AAPL = { c: 48, pc: 47, o: 47, h: 49, l: 46, t: sec(et('2026-10-22', 16, 0)) };
    await M.ensure('AAPL').catch(() => {});
    check('older quote fills a missing prevClose', M.inst.AAPL.prevClose, 48);
  }

  console.log('-- stale quote never undoes a rollover');
  {
    const { M, quotes, trade } = boot();
    M.start();
    quotes.MSFT = { c: 150.5, pc: 149, o: 149, h: 151, l: 148, t: sec(et('2026-10-22', 15, 58)) };
    await M.ensure('MSFT');
    const i = M.inst.MSFT;
    trade('MSFT', 152, et('2026-10-23', 9, 45));
    // simulate the scheduler refreshing with yesterday's official close
    quotes.MSFT = { c: 151, pc: 149, o: 149, h: 151.2, l: 148, t: sec(et('2026-10-22', 16, 0)) };
    i.quotedAt = 0;
    M.watch(['MSFT']);
    await tick(); await tick();
    check('session stays today', i.session, '2026-10-23');
    check('open stays today', i.open, 152);
  }

  console.log('-- intraday candles use regular hours only');
  {
    const { M, quotes, trade } = boot({ candles: { 5: fiveMinBars('2026-10-22', 4, 0, 19, 55) } });
    M.start();
    quotes.AAPL = { c: 100, pc: 98, o: 99, h: 103, l: 97, t: sec(et('2026-10-22', 16, 0)) };
    await M.ensure('AAPL');
    const r = await M.bars('AAPL', '1D');
    const s = r.series();
    check('78 regular-session bars', s.length, 78);
    check('first bar 09:30', s[0].t, et('2026-10-22', 9, 30));
    check('last bar 15:55', s[s.length - 1].t, et('2026-10-22', 15, 55));
    trade('AAPL', 97, et('2026-10-22', 18, 0));
    check('after-hours trade leaves candles', r.series()[r.series().length - 1].c, 100);
    check('after-hours trade leaves day low', M.inst.AAPL.low, 97);
    trade('AAPL', 104, et('2026-10-23', 9, 35));
    check('new session replaces intraday series', r.series().length, 1);
    check('new session bar starts at its slot', r.series()[0].t, et('2026-10-23', 9, 35));
    check('reference is yesterday close', r.ref(), 100);
    trade('AAPL', 105, et('2026-10-23', 9, 41));
    check('next slot starts a new bar', r.series().length, 2);
  }

  console.log('-- early close from the holiday calendar');
  {
    const { M, quotes, trade } = boot({ holidays: [{ atDate: '2026-11-27', tradingHour: '09:30-13:00' }] });
    M.start();
    await tick();
    quotes.AAPL = { c: 200, pc: 198, o: 199, h: 201, l: 197, t: sec(et('2026-11-27', 13, 0)) };
    await M.ensure('AAPL');
    const i = M.inst.AAPL;
    trade('AAPL', 210, et('2026-11-27', 14, 0));
    check('post-close trade moves last', i.last, 210);
    check('post-close trade leaves high', i.high, 201);
    check('post-close trade leaves close', i.close, 200);
  }

  console.log('-- daily candles');
  {
    const { M, quotes } = boot({ candles: { D: dailyBars(400) } });
    M.start();
    quotes.AAPL = { c: 104, pc: 98, o: 101, h: 106, l: 98.5, t: sec(et('2026-10-23', 11, 0)) };
    await M.ensure('AAPL');
    const y = await M.bars('AAPL', '1Y');
    const b = y.series()[y.series().length - 1];
    check('today open from quote', b.o, 101);
    check('today high from quote', b.h, 106);
    check('today low from quote', b.l, 98.5);
    check('today close from quote', b.c, 104);
    const before = y.series().length, maBefore = y.ma().src.length;
    check('1Y shows 252 bars', before, 252);
  }
  {
    const sets = { D: dailyBars(400) };
    const { M, quotes } = boot({ candles: sets });
    M.start();
    quotes.AAPL = { c: 104, pc: 98, o: 101, h: 106, l: 98.5, t: sec(et('2026-10-23', 11, 0)) };
    await M.ensure('AAPL');
    const y = await M.bars('AAPL', '1Y');
    const maBefore = y.ma().src.length;
    sets.D = dailyBars(60); // a shorter range, as a 1M chart requests
    await M.bars('AAPL', '1M');
    check('1Y chart keeps 252 bars after a 1M load', y.series().length, 252);
    check('1Y moving-average history is kept', y.ma().src.length, maBefore);
  }

  console.log('-- trade ordering and timestamps');
  {
    const { M, quotes, trade } = boot();
    M.start();
    quotes.AAPL = { c: 100, pc: 98, o: 99, h: 103, l: 97, t: sec(et('2026-10-23', 10, 0)) };
    await M.ensure('AAPL');
    const i = M.inst.AAPL;
    trade('AAPL', 101, et('2026-10-23', 10, 59));
    trade('AAPL', 104, et('2026-10-23', 10, 58)); // arrives late
    check('older print does not set last', i.last, 101);
    check('older print can widen the high', i.high, 104);
  }
  {
    const { M, quotes } = boot();
    M.start();
    quotes.AAPL = { c: 100, pc: 0, o: 0, h: 0, l: 0, t: 0 };
    await M.ensure('AAPL').catch(() => {});
    check('quote without time opens no session', M.inst.AAPL.session, undefined);
  }

  console.log('-- stream subscribes symbols registered before start');
  {
    const { M, subs } = boot();
    M.watch(['AAPL', 'SPY']);
    M.start();
    check('subscribed before-start symbols', subs.join(','), 'AAPL,SPY');
  }

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
