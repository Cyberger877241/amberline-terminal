/*
 * Amberline Terminal: Astral plugin.
 *
 * When the terminal is opened on claude.ai, it can read real market data
 * through the viewer's own Astral connector (the page's `mcp` capability),
 * so no Finnhub key is needed. This file answers the same calls as the
 * Finnhub client in finnhub.js, so market.js can use either one unchanged.
 * Outside claude.ai there is no connector, and `available()` is false.
 */
(function (root) {
  'use strict';

  const SERVER = 'Astral';
  const TOOLS = ['astral_research_full_quote_list', 'astral_price_get', 'astral_research_sec_filings', 'astral_symbol_resolve'];

  const available = () => !!(root.claude && typeof root.claude.use === 'function');

  function create(FinnhubError) {
    const mcpReady = root.claude.use('mcp').catch(() => null);
    const stamps = [];
    const rows = new Map(); // latest quote row per symbol, reused for profiles

    // Connector failures map onto the error kinds the terminal already explains.
    function fail(err) {
      const code = err && err.code;
      if (['needs_reauth', 'server_not_connected', 'selection_required', 'not_in_manifest', 'approval_required',
        'blocked_by_policy', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code)) {
        const msg = code === 'needs_reauth' ? 'Astral needs you to reconnect it in claude.ai Settings, Connectors.'
          : code === 'approval_required' || code === 'not_in_manifest' ? 'Allow Astral for this page to load real data.'
          : 'Connect Astral in claude.ai Settings, Connectors, or type KEY to add a Finnhub key.';
        return new FinnhubError('nokey', msg);
      }
      if (code === 'server_unavailable' || code === 'rate_limited') return new FinnhubError('network', 'Astral is briefly unavailable. Try again shortly.');
      return new FinnhubError('http', (err && err.message) || 'Astral returned an error.');
    }

    async function call(tool, input) {
      const mcp = await mcpReady;
      if (!mcp) throw new FinnhubError('nokey', "Astral isn't available here. Open the terminal on claude.ai with Astral connected, or type KEY to add a Finnhub key.");
      stamps.push(Date.now());
      try {
        const res = await mcp.callTool(SERVER, tool, input, { cache: { staleTime: 15000, gcTime: 300000 } });
        return res.payload;
      } catch (err) {
        throw fail(err);
      }
    }

    // Quotes for many symbols travel in one request: calls made within 40 ms are batched.
    let pending = new Map(), timer = null;
    function flushQuotes() {
      const batch = pending;
      pending = new Map();
      timer = null;
      call('astral_research_full_quote_list', { symbols: [...batch.keys()].join(','), delivery: 'inline' }).then(p => {
        (p && Array.isArray(p.rows) ? p.rows : []).forEach(r => { if (r && r.symbol) rows.set(String(r.symbol), r); });
        batch.forEach((waiters, sym) => {
          const r = rows.get(sym);
          const q = r && r.price > 0
            ? { c: +r.price, pc: +r.previousClose, o: +r.open, h: +r.dayHigh, l: +r.dayLow, d: +r.change, dp: +r.changesPercentage, t: lastSessionTime() }
            : { c: 0, t: 0 };
          waiters.forEach(w => w.resolve(q));
        });
      }, err => batch.forEach(waiters => waiters.forEach(w => w.reject(err))));
    }

    // Astral's quote has no timestamp; date it to the latest regular session so a
    // weekend or overnight quote doesn't open a new trading day.
    const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    function lastSessionTime() {
      let ms = Date.now();
      for (let k = 0; k < 7; k++) {
        const p = {};
        etFmt.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
        const mins = +p.hour * 60 + +p.minute;
        const weekday = p.weekday !== 'Sat' && p.weekday !== 'Sun';
        if (weekday && mins >= 570) return Math.floor((mins < 960 ? ms : ms - (mins - 960) * 60000) / 1000);
        ms -= (mins + 1) * 60000; // step back to the previous evening
      }
      return Math.floor(Date.now() / 1000);
    }

    const iso = sec => new Date(sec * 1000).toISOString();

    return {
      source: 'Astral',
      budget: () => ({ used: stamps.filter(t => Date.now() - t < 60000).length, perMinute: 50, queued: pending.size }),
      quote(symbol) {
        return new Promise((resolve, reject) => {
          if (!pending.has(symbol)) pending.set(symbol, []);
          pending.get(symbol).push({ resolve, reject });
          if (!timer) timer = setTimeout(flushQuotes, 40);
        });
      },
      profile(symbol) {
        const r = rows.get(symbol);
        return Promise.resolve(r ? {
          name: r.name, exchange: r.exchange,
          marketCapitalization: r.marketCap ? r.marketCap / 1e6 : undefined,
          shareOutstanding: r.sharesOutstanding ? r.sharesOutstanding / 1e6 : undefined
        } : {});
      },
      metrics(symbol) {
        const r = rows.get(symbol) || {};
        return Promise.resolve({ metric: { '52WeekHigh': r.yearHigh, '52WeekLow': r.yearLow, peTTM: r.pe, epsTTM: r.eps } });
      },
      peers: () => Promise.resolve([]),
      candles(symbol, resolution, from, to) {
        return call('astral_price_get', { symbol, tf: resolution === '5' ? '5m' : '1d', start: iso(from), end: iso(to), delivery: 'inline' }).then(p => {
          const bars = p && Array.isArray(p.bars) ? p.bars.filter(b => b && b.t) : [];
          if (!bars.length) return { s: 'no_data' };
          return {
            s: 'ok', t: bars.map(b => Math.floor(Date.parse(b.t) / 1000)),
            o: bars.map(b => +b.o), h: bars.map(b => +b.h), l: bars.map(b => +b.l), c: bars.map(b => +b.c), v: bars.map(b => +b.v || 0)
          };
        });
      },
      // Company news is the company's recent SEC filings, linked to sec.gov.
      companyNews(symbol) {
        return call('astral_research_sec_filings', { symbol, limit: 20, delivery: 'inline' }).then(p =>
          (p && Array.isArray(p.rows) ? p.rows : []).map(r => {
            const f = r.payload || {};
            const form = f.sec_form_type || f.secFormType || 'Filing';
            const type = f.document_type || f.documentType || 'SEC filing';
            const date = String(f.filing_date || f.filingDate || r.available_at);
            // A bare filing date means that day in New York, not midnight UTC (the evening before).
            const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T12:00:00Z') : Date.parse(date);
            return {
              id: r.document_id || r.observation_id, datetime: Math.floor(when / 1000),
              headline: `${symbol} filed ${form}: ${type}`, source: 'SEC EDGAR',
              summary: `${type} (${form}) filed ${String(date).slice(0, 10)}.`, url: f.source_url || f.sourceUrl, related: symbol
            };
          }));
      },
      marketNews: () => Promise.reject(new FinnhubError('premium', "Astral doesn't provide market headlines. Use NEWS with a ticker, for example AAPL NEWS, to see that company's SEC filings.")),
      search(q) {
        return call('astral_symbol_resolve', { query: q, limit: 8 }).then(p => ({
          result: (p && Array.isArray(p.matches) ? p.matches : [])
            .filter(m => m && m.supported && m.asset_type === 'equity')
            .map(m => ({ symbol: m.astral_symbol, description: m.name, type: m.type === 'ETF' ? 'ETP' : 'Common Stock' }))
        }));
      },
      marketStatus: () => Promise.reject(new FinnhubError('premium', 'Not provided by Astral.')),
      stream(onTrade, onState) { onState('off'); return { set() {}, close() {} }; }
    };
  }

  root.AstralPlugin = { available, create, SERVER, TOOLS };
})(window);
