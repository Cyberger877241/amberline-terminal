// Tests for src/astral.js, run with: node tests/astral.test.js
// A fake claude.use("mcp") answers Astral tool calls; nothing touches the network.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'astral.js'), 'utf8');

class FinnhubError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

function load(mcp) {
  const calls = [];
  const fake = mcp && {
    callTool(server, tool, input) { calls.push({ server, tool, input }); return mcp(tool, input); }
  };
  const win = { claude: { use: name => Promise.resolve(name === 'mcp' ? fake : null) } };
  win.window = win;
  vm.runInContext(src, vm.createContext(Object.assign(win, { Intl, Date, Promise, setTimeout, console })));
  return { client: win.AstralPlugin.create(FinnhubError), plugin: win.AstralPlugin, calls };
}

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' got=' + got + ' want=' + want);
  if (!ok) fails++;
};
const reject = p => p.then(() => null, e => e);

(async () => {
  {
    const { client, plugin, calls } = load((tool, input) => {
      if (tool === 'astral_research_full_quote_list') {
        return Promise.resolve({ payload: { rows: [
          { symbol: 'AAPL', name: 'Apple Inc.', price: 101, previousClose: 100, open: 99, dayHigh: 102, dayLow: 98, change: 1, changesPercentage: 1, yearHigh: 120, yearLow: 80, marketCap: 2e12, pe: 30, eps: 3.4, exchange: 'NASDAQ', sharesOutstanding: 1.5e10 },
          { symbol: 'MSFT', name: 'Microsoft', price: 50, previousClose: 49, open: 49, dayHigh: 51, dayLow: 48 }
        ] } });
      }
      if (tool === 'astral_price_get') {
        return Promise.resolve({ payload: { bars: [{ t: '2026-11-04T05:00:00+0000', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: '2026-11-05T05:00:00+0000', o: 1.5, h: 2.5, l: 1, c: 2, v: 20 }] } });
      }
      if (tool === 'astral_research_sec_filings') {
        return Promise.resolve({ payload: { rows: [{ document_id: 'x1', payload: { filing_date: '2026-09-03', sec_form_type: '8-K', document_type: 'Current Report', source_url: 'https://www.sec.gov/x' } }] } });
      }
      return Promise.resolve({ payload: {} });
    });
    check('plugin needs claude.use', plugin.available(), true);
    const [a, m, z] = await Promise.all([client.quote('AAPL'), client.quote('MSFT'), client.quote('ZZZZ')]);
    check('quotes batched into one call', calls.filter(c => c.tool === 'astral_research_full_quote_list').length, 1);
    check('batched symbols', calls[0].input.symbols, 'AAPL,MSFT,ZZZZ');
    check('server is Astral', calls[0].server, 'Astral');
    check('quote price', a.c, 101);
    check('quote previous close', a.pc, 100);
    check('quote has a session time', a.t > 0, true);
    check('second quote', m.c, 50);
    check('unknown symbol reads as missing', z.c, 0);
    const p = await client.profile('AAPL');
    check('profile name', p.name, 'Apple Inc.');
    check('market cap in millions', p.marketCapitalization, 2e6);
    const mx = await client.metrics('AAPL');
    check('52-week high', mx.metric['52WeekHigh'], 120);
    const c = await client.candles('AAPL', 'D', 1700000000, 1800000000);
    check('candles ok', c.s, 'ok');
    check('candle times in seconds', c.t[1], Date.parse('2026-11-05T05:00:00Z') / 1000);
    check('candle close', c.c[1], 2);
    check('daily request uses 1d', calls.find(x => x.tool === 'astral_price_get').input.tf, '1d');
    const news = await client.companyNews('AAPL');
    check('filing headline', news[0].headline, 'AAPL filed 8-K: Current Report');
    check('filing date stays on its day in New York', new Date(news[0].datetime * 1000).toISOString().slice(0, 10), '2026-09-03');
    const mn = await reject(client.marketNews());
    check('market news explains it is unavailable', mn && mn.kind, 'premium');
  }
  {
    const { client } = load(() => Promise.reject({ code: 'server_not_connected', message: 'no' }));
    const e = await reject(client.quote('AAPL'));
    check('missing connector reads as no key', e && e.kind, 'nokey');
  }
  {
    const { client } = load(() => Promise.reject({ code: 'server_unavailable', retryable: true }));
    const e = await reject(client.candles('AAPL', '5', 1, 2));
    check('unavailable server reads as network', e && e.kind, 'network');
  }
  {
    const { client } = load(null); // claude.use("mcp") resolves null outside claude.ai
    const e = await reject(client.candles('AAPL', 'D', 1, 2));
    check('no mcp capability reads as no key', e && e.kind, 'nokey');
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
