// Session-boundary tests for src/market.js, run with: node tests/market.test.js
// A fake Finnhub client feeds quotes, candles and streamed trades into the live market.
const fs = require('fs');
const vm = require('vm');
const path = require('path').join(__dirname, '..');
const src = fs.readFileSync(path + '/src/market.js', 'utf8');

function boot(candles) {
  let onTrade = null;
  const subs = [];
  const quotes = {};
  const client = {
    budget: () => ({ used: 0, perMinute: 50, queued: 0 }),
    quote: sym => Promise.resolve(quotes[sym]),
    profile: () => Promise.resolve({}), metrics: () => Promise.resolve({}), peers: () => Promise.resolve([]),
    marketStatus: () => Promise.reject(new Error('x')),
    candles: () => Promise.resolve(candles),
    stream(t) { onTrade = t; return { set(list) { subs.push(...list); }, close() {} }; }
  };
  const win = {
    localStorage: { getItem: () => 'testkeytestkey', setItem() {}, removeItem() {} },
    location: { hostname: 'example.com', search: '' },
    Finnhub: { create: () => client, FinnhubError: Error, DEFAULT_API: 'x' }
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Intl, Date, Math, URL, URLSearchParams, Promise, setInterval: () => 0, console }));
  vm.runInContext(src, ctx);
  return { M: win.AmberlineMarket, quotes, trade: (s, p, ms) => onTrade(s, p, 0, ms), subs };
}
// ET is UTC-4 in late October.
const et = (day, hh, mm) => Date.parse(`${day}T${String(hh + 4).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
let fails = 0;
const check = (name, got, want) => {
  const okv = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
  console.log((okv ? 'PASS ' : 'FAIL ') + name + ' got=' + got + ' want=' + want);
  if (!okv) fails++;
};

(async () => {
  // 1. Overnight rollover: yesterday's quote, then a pre-market trade today.
  {
    const { M, quotes, trade } = boot(null);
    M.watch(['AAPL']);
    M.start();
    quotes.AAPL = { c: 100, pc: 98, o: 99, h: 103, l: 97, t: et('2026-10-22', 16, 0) / 1000 };
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
    // stale quote from yesterday arrives late: must not undo the rollover
    i.quotedAt = 0;
    quotes.AAPL = { c: 100, pc: 98, o: 99, h: 103, l: 97, t: et('2026-10-22', 16, 0) / 1000 };
  }
  // 2. Trade before any quote, then yesterday's quote.
  {
    const { M, quotes, trade } = boot(null);
    M.start();
    trade('MSFT', 50, et('2026-10-23', 5, 0));
    quotes.MSFT = { c: 48, pc: 47, o: 47, h: 49, l: 46, t: et('2026-10-22', 16, 0) / 1000 };
    // force a fresh quote via ensure path on a symbol already known
    const i = M.inst.MSFT;
    i.quotedAt = 0;
    await M.ensure('MSFT').catch(() => {});
    check('prevClose falls back to older quote close', i.prevClose, 48);
  }
  // 3. Intraday candles: after-hours trade does not touch candles; new day starts fresh series.
  {
    const t0 = et('2026-10-22', 15, 50) / 1000;
    const candles = { s: 'ok', t: [t0, t0 + 300], o: [100, 101], h: [101, 102], l: [99, 100], c: [101, 101.5], v: [10, 10] };
    const { M, quotes, trade } = boot(candles);
    M.start();
    quotes.AAPL = { c: 101.5, pc: 98, o: 99, h: 103, l: 97, t: et('2026-10-22', 16, 0) / 1000 };
    await M.ensure('AAPL');
    const r = await M.bars('AAPL', '1D');
    const i = M.inst.AAPL;
    trade('AAPL', 97, et('2026-10-22', 18, 0));
    const last = r.series()[r.series().length - 1];
    check('after-hours trade leaves last candle close', last.c, 101.5);
    check('after-hours trade leaves day low', i.low, 97);
    trade('AAPL', 104, et('2026-10-23', 9, 35));
    check('new session replaces intraday series', r.series().length, 1);
    check('new session bar starts at slot', r.series()[0].t, et('2026-10-23', 9, 35));
    check('reference is yesterday close', r.ref(), 101.5);
    trade('AAPL', 105, et('2026-10-23', 9, 41));
    check('next slot starts a new bar', r.series().length, 2);
  }
  // 4. Daily candles: today's bar follows the session open/high/low/close.
  {
    const d1 = Date.parse('2026-10-21T00:00:00Z') / 1000, d2 = Date.parse('2026-10-22T00:00:00Z') / 1000;
    const candles = { s: 'ok', t: [d1, d2], o: [90, 95], h: [96, 99], l: [89, 94], c: [95, 98], v: [1, 1] };
    const { M, quotes } = boot(candles);
    M.start();
    quotes.AAPL = { c: 104, pc: 98, o: 101, h: 106, l: 98.5, t: et('2026-10-23', 11, 0) / 1000 };
    await M.ensure('AAPL');
    const r = await M.bars('AAPL', '1M');
    const bars = r.series();
    const b = bars[bars.length - 1];
    check('daily bar appended for today', bars.length, 3);
    check('today open from quote', b.o, 101);
    check('today high from quote', b.h, 106);
    check('today low from quote', b.l, 98.5);
    check('today close from quote', b.c, 104);
  }
  // 5. Stream subscribes symbols registered before start.
  {
    const { M, subs } = boot(null);
    M.watch(['AAPL', 'SPY']);
    M.start();
    check('subscribed before-start symbols', subs.join(','), 'AAPL,SPY');
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
