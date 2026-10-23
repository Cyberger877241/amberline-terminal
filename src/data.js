/*
 * Amberline Terminal: simulated market data engine.
 *
 * Every security, price, yield and headline here is fictional. Prices come from
 * a seeded random walk generated in the browser; nothing is fetched from a
 * market-data vendor. Any resemblance to a listed security is coincidental.
 */
(function (root) {
  'use strict';

  const TICK_MS = 1000;          // one price update per second
  const TICKS_PER_BAR = 30;      // a 5-minute intraday bar closes every 30 updates
  const SESSION_OPEN = 9 * 60 + 30;
  const SESSION_CLOSE = 16 * 60;
  const START_BARS = 43;         // the demo opens at 13:00 ET with 43 bars printed
  const HISTORY_DAYS = 252;

  const now = new Date();
  const DAY = now.toISOString().slice(0, 10);

  // ---------- seeded randomness ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const live = mulberry32(hash('live:' + Date.now()));

  // ---------- the fictional universe ----------
  // sym, name, sector, price, annual vol, shares (bn), P/E, dividend %, beta, HQ, founded, employees, about
  const EQUITIES = [
    ['NVTK', 'Novatek Systems', 'Semiconductors', 412.30, 0.42, 2.45, 38.4, 0.2, 1.45, 'San Jose, CA', 1994, 31200, 'Designs accelerator chips and interconnect for data-center AI training and inference.'],
    ['QSRV', 'Quasar Cloud Services', 'Software', 238.75, 0.33, 1.12, 44.1, 0, 1.18, 'Seattle, WA', 2008, 18400, 'Sells usage-based cloud databases and observability tooling to enterprise developers.'],
    ['HLXB', 'Helix Biologics', 'Biotechnology', 88.15, 0.55, 0.41, null, 0, 1.32, 'Cambridge, MA', 2011, 2900, 'Clinical-stage developer of antibody therapies for autoimmune disease, with two Phase III readouts due next year.'],
    ['CDRW', 'Cedarwood Financial', 'Banks', 61.22, 0.24, 3.10, 11.2, 3.4, 1.05, 'Charlotte, NC', 1871, 64000, 'Regional bank holding company with commercial lending, wealth management and card businesses across 14 states.'],
    ['KSTL', 'Keystone Steelworks', 'Materials', 33.48, 0.31, 0.88, 8.9, 2.1, 1.22, 'Pittsburgh, PA', 1902, 11800, 'Operates electric-arc furnace mills producing rebar, beams and flat-rolled steel.'],
    ['BRMR', 'Bramble Retail', 'Consumer Retail', 127.90, 0.27, 0.65, 22.7, 1.3, 0.95, 'Columbus, OH', 1956, 142000, 'Runs 1,900 home-goods and grocery stores plus a same-day delivery marketplace.'],
    ['VTRA', 'Vantra Energy', 'Oil & Gas', 74.60, 0.30, 1.95, 9.8, 4.2, 0.88, 'Houston, TX', 1978, 9600, 'Explores for and produces oil and natural gas in West Texas and offshore.'],
    ['SOLW', 'Solwind Renewables', 'Renewable Power', 22.85, 0.48, 1.40, 31.5, 1.8, 1.10, 'Denver, CO', 2009, 4100, 'Develops and operates utility-scale solar and onshore wind farms under long-term power contracts.'],
    ['ARDN', 'Arden Motors', 'Automobiles', 46.12, 0.38, 1.25, 7.4, 2.6, 1.35, 'Detroit, MI', 1921, 96000, 'Builds pickup trucks, SUVs and a growing line of battery-electric delivery vans.'],
    ['PXLM', 'Pixelmint Games', 'Interactive Media', 59.40, 0.45, 0.52, 27.9, 0, 1.25, 'Los Angeles, CA', 2004, 7300, 'Publishes live-service console and mobile games with in-game marketplaces.'],
    ['MRDN', 'Meridian Pharma', 'Pharmaceuticals', 142.05, 0.22, 2.30, 16.3, 2.9, 0.62, 'Princeton, NJ', 1932, 58000, 'Markets cardiology and oncology drugs worldwide and has a late-stage obesity pipeline.'],
    ['TLHW', 'Tallhaven REIT', 'Real Estate', 38.77, 0.20, 0.71, 19.4, 5.6, 0.80, 'Chicago, IL', 1997, 1100, 'Owns logistics warehouses and cold-storage facilities near major ports.'],
    ['FRSG', 'Frostgate Foods', 'Consumer Staples', 52.34, 0.16, 0.94, 18.0, 3.1, 0.48, 'Minneapolis, MN', 1888, 38000, 'Makes frozen meals, cereals and snack brands sold through grocery and club stores.'],
    ['SKYH', 'Skyhook Airlines', 'Airlines', 18.62, 0.44, 0.62, 6.1, 0, 1.55, 'Dallas, TX', 1984, 41000, 'Low-cost carrier flying 420 routes across North and Central America.'],
    ['OCNL', 'Ocelan Telecom', 'Telecommunications', 29.10, 0.19, 4.20, 10.6, 6.3, 0.55, 'Atlanta, GA', 1983, 77000, 'Provides wireless, fiber broadband and enterprise network services.'],
    ['GRNT', 'Granite Insurance Group', 'Insurance', 96.48, 0.21, 0.58, 12.8, 2.2, 0.74, 'Hartford, CT', 1849, 26000, 'Writes property, casualty and specialty commercial insurance.'],
    ['AXMR', 'Axiomar Defense', 'Aerospace & Defense', 205.60, 0.23, 0.27, 20.5, 1.7, 0.69, 'Arlington, VA', 1958, 52000, 'Supplies radar, missile-defense and satellite systems to government customers.'],
    ['CLRW', 'Clearwater Utilities', 'Utilities', 71.30, 0.14, 0.49, 17.2, 3.8, 0.41, 'Phoenix, AZ', 1912, 6200, 'Regulated electric and water utility serving 2.3 million customers in the Southwest.'],
    ['NBLA', 'Nebula Robotics', 'Industrial Machinery', 113.85, 0.50, 0.33, 52.6, 0, 1.62, 'Pittsburgh, PA', 2015, 3800, 'Builds autonomous mobile robots and vision software for warehouses and factories.'],
    ['PRSM', 'Prism Payments', 'Fintech', 167.20, 0.36, 0.79, 29.3, 0.4, 1.28, 'New York, NY', 2010, 12500, 'Processes card and real-time payments for online merchants in 40 countries.']
  ];

  // sym, name, region, level, annual vol
  const INDICES = [
    ['AMX500', 'US Large Cap 500', 'Americas', 5612.40, 0.15],
    ['ATC100', 'US Tech 100', 'Americas', 19840.20, 0.20],
    ['AIN30', 'US Industrial 30', 'Americas', 41250.80, 0.13],
    ['CANCMP', 'Canada Composite', 'Americas', 23410.50, 0.12],
    ['BRZ100', 'Brazil Broad 100', 'Americas', 128400.00, 0.20],
    ['MEX35', 'Mexico Prime 35', 'Americas', 52310.00, 0.16],
    ['UK100', 'UK 100', 'EMEA', 8241.60, 0.12],
    ['EZ50', 'Eurozone 50', 'EMEA', 4921.30, 0.15],
    ['DE40', 'Germany 40', 'EMEA', 19302.70, 0.15],
    ['FR40', 'France 40', 'EMEA', 7418.90, 0.15],
    ['CH20', 'Swiss 20', 'EMEA', 12010.40, 0.11],
    ['ZA40', 'South Africa Top 40', 'EMEA', 76200.00, 0.17],
    ['JP225', 'Japan 225', 'Asia-Pacific', 38904.00, 0.19],
    ['HK50', 'Hong Kong 50', 'Asia-Pacific', 20150.30, 0.24],
    ['CN300', 'China A-Share 300', 'Asia-Pacific', 3881.20, 0.20],
    ['AU200', 'Australia 200', 'Asia-Pacific', 8150.10, 0.12],
    ['IN50', 'India 50', 'Asia-Pacific', 24310.60, 0.14],
    ['KR200', 'Korea 200', 'Asia-Pacific', 2652.40, 0.18]
  ];

  // sym, name, group, price, annual vol, quote unit, decimals
  const COMMODITIES = [
    ['CL1', 'WTI Crude Oil', 'Energy', 78.40, 0.32, 'USD/bbl', 2],
    ['CO1', 'Brent Crude Oil', 'Energy', 82.10, 0.30, 'USD/bbl', 2],
    ['NG1', 'Natural Gas', 'Energy', 2.842, 0.55, 'USD/MMBtu', 3],
    ['HO1', 'Heating Oil', 'Energy', 2.512, 0.30, 'USD/gal', 3],
    ['GC1', 'Gold', 'Metals', 2381.50, 0.15, 'USD/troy oz', 1],
    ['SI1', 'Silver', 'Metals', 28.410, 0.27, 'USD/troy oz', 3],
    ['HG1', 'Copper', 'Metals', 4.4520, 0.22, 'USD/lb', 4],
    ['PL1', 'Platinum', 'Metals', 982.40, 0.25, 'USD/troy oz', 1],
    ['C1', 'Corn', 'Agriculture', 432.25, 0.22, 'USc/bu', 2],
    ['W1', 'Wheat', 'Agriculture', 568.50, 0.28, 'USc/bu', 2],
    ['S1', 'Soybeans', 'Agriculture', 1172.75, 0.18, 'USc/bu', 2],
    ['KC1', 'Coffee', 'Agriculture', 224.60, 0.35, 'USc/lb', 2]
  ];

  // sym, name, rate, annual vol, decimals
  const FX = [
    ['EURUSD', 'Euro / US Dollar', 1.0872, 0.07, 4],
    ['USDJPY', 'US Dollar / Japanese Yen', 151.24, 0.09, 2],
    ['GBPUSD', 'British Pound / US Dollar', 1.2815, 0.08, 4],
    ['USDCHF', 'US Dollar / Swiss Franc', 0.8841, 0.07, 4],
    ['USDCAD', 'US Dollar / Canadian Dollar', 1.3712, 0.06, 4],
    ['AUDUSD', 'Australian Dollar / US Dollar', 0.6583, 0.10, 4],
    ['USDCNY', 'US Dollar / Chinese Yuan', 7.1236, 0.03, 4]
  ];

  // tenor, months, yield %
  const CURVE = [
    ['1M', 1, 5.31], ['3M', 3, 5.27], ['6M', 6, 5.12], ['1Y', 12, 4.86], ['2Y', 24, 4.52],
    ['3Y', 36, 4.33], ['5Y', 60, 4.18], ['7Y', 84, 4.20], ['10Y', 120, 4.24], ['20Y', 240, 4.51], ['30Y', 360, 4.41]
  ];

  // ---------- history ----------
  function businessDays(n) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = [d.getTime()];
    while (out.length < n) {
      d.setDate(d.getDate() - 1);
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) out.unshift(d.getTime());
    }
    return out;
  }
  const DAYS = businessDays(HISTORY_DAYS);

  function history(i) {
    const r = mulberry32(hash(i.sym + ':' + DAY));
    const sig = i.vol / Math.sqrt(252);
    const prevClose = i.price / Math.exp(gauss(r) * sig * 0.9);

    // Walk backwards from yesterday's close so the series ends exactly there.
    const daily = [];
    let c = prevClose;
    for (let k = DAYS.length - 2; k >= 0; k--) {
      const o = c / Math.exp(gauss(r) * sig + 0.0003);
      const ext = Math.abs(gauss(r)) * sig * 0.5;
      daily.unshift({
        t: DAYS[k], o, c,
        h: Math.max(o, c) * (1 + ext * r()),
        l: Math.min(o, c) * (1 - ext * r()),
        v: i.adv ? i.adv * (0.55 + r() * 0.9) : 0
      });
      c = o * Math.exp(gauss(r) * sig * 0.2); // overnight gap into the prior close
    }

    // Today: a Brownian bridge of 5-minute bars from the open to the reference price.
    const open = prevClose * Math.exp(gauss(r) * sig * 0.15);
    const lo = Math.log(open), lt = Math.log(i.price);
    const w = [0];
    for (let k = 1; k <= START_BARS; k++) w.push(w[k - 1] + gauss(r));
    const px = w.map((wk, k) => Math.exp(lo + (lt - lo) * k / START_BARS + i.barSig * 1.4 * (wk - w[START_BARS] * k / START_BARS)));
    const intra = [];
    for (let k = 0; k < START_BARS; k++) {
      const o = px[k], cl = px[k + 1], ext = Math.abs(gauss(r)) * i.barSig * 0.4;
      const shape = 1.7 - Math.sin(Math.PI * k / 78); // volume is heavier at the open and close
      intra.push({
        t: SESSION_OPEN + 5 * k, o, c: cl,
        h: Math.max(o, cl) * (1 + ext), l: Math.min(o, cl) * (1 - ext),
        v: i.adv ? i.adv / 78 * shape * (0.6 + r() * 0.8) : 0
      });
    }
    daily.push({
      t: DAYS[DAYS.length - 1], o: open, c: i.price,
      h: Math.max(...intra.map(b => b.h)), l: Math.min(...intra.map(b => b.l)),
      v: intra.reduce((s, b) => s + b.v, 0)
    });

    i.daily = daily;
    i.intra = intra;
    i.prevClose = prevClose;
    i.open = open;
    i.last = i.price;
  }

  const inst = {};
  const order = { equity: [], index: [], cmdty: [], fx: [] };

  function add(base) {
    const i = Object.assign({ dec: 2, unit: '', beta: 1, adv: 0, dir: '' }, base);
    i.barSig = i.vol / Math.sqrt(252 * 78);
    i.tickSig = i.barSig / Math.sqrt(TICKS_PER_BAR) * 2.2;
    history(i);
    inst[i.sym] = i;
    order[i.type].push(i.sym);
  }

  EQUITIES.forEach(([sym, name, sector, price, vol, sharesBn, pe, div, beta, hq, founded, employees, about]) => {
    const r = mulberry32(hash(sym + ':adv'));
    add({
      sym, name, type: 'equity', group: sector, sector, price, vol, sharesBn, pe, div, beta, hq, founded, employees, about,
      factor: 'Americas', unit: 'USD', adv: sharesBn * 1e9 * (0.004 + r() * 0.008)
    });
  });
  INDICES.forEach(([sym, name, region, price, vol]) => add({ sym, name, type: 'index', group: region, price, vol, factor: region, unit: 'Index points' }));
  COMMODITIES.forEach(([sym, name, group, price, vol, unit, dec]) => add({ sym, name, type: 'cmdty', group, price, vol, unit, dec, factor: group }));
  FX.forEach(([sym, name, price, vol, dec]) => add({ sym, name, type: 'fx', group: 'Currencies', price, vol, dec, factor: 'FX', unit: sym.slice(3) + ' per ' + sym.slice(0, 3) }));

  // ---------- currency matrix ----------
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY'];
  function perUSD(prev) {
    const v = s => (prev ? inst[s].prevClose : inst[s].last);
    return {
      USD: 1, EUR: 1 / v('EURUSD'), GBP: 1 / v('GBPUSD'), JPY: v('USDJPY'),
      CHF: v('USDCHF'), CAD: v('USDCAD'), AUD: 1 / v('AUDUSD'), CNY: v('USDCNY')
    };
  }

  // ---------- yield curve ----------
  const cr = mulberry32(hash('curve:' + DAY));
  const curve = CURVE.map(([tenor, months, y]) => {
    const shape = Math.log(1 + months) / Math.log(361);
    return {
      tenor, months, y, open: y,
      m1: y + 0.07 + (cr() - 0.5) * 0.08,
      y1: y + 0.45 - shape * 0.75 + (cr() - 0.5) * 0.1
    };
  });

  // ---------- headlines ----------
  const GOOD = ['stronger-than-expected quarterly orders', 'a new multi-year supply agreement', 'regulatory approval in Europe',
    'record quarterly deliveries', 'a $2 billion buyback authorization', 'an upgrade to Buy at Harbor Street Research'];
  const BAD = ['a cut to full-year guidance', 'the surprise departure of its finance chief', 'a downgrade to Hold at Harbor Street Research',
    'a product recall covering two model years', 'weaker margins in its largest segment', 'a delayed product launch'];
  const SEGMENTS = ['services', 'software', 'logistics', 'consumer', 'international'];
  const story = { id: 0 };

  function companyStory(r, t, i, move) {
    const up = move != null ? move >= 0 : r() < 0.55;
    const kind = r();
    const pctv = Math.abs(move != null ? move : (0.6 + r() * 4.5) * (up ? 1 : -1)).toFixed(1);
    let head, src;
    if (kind < 0.45) {
      head = `${i.name} ${up ? 'rises' : 'falls'} ${pctv}% after ${pick(r, up ? GOOD : BAD)}`; src = 'AMW';
    } else if (kind < 0.65) {
      head = `${i.sym}: Harbor Street Research ${up ? 'raises' : 'cuts'} price target to $${Math.round(i.last * (up ? 1.18 : 0.86))}`; src = 'RSH';
    } else if (kind < 0.85) {
      const rev = (i.adv / 1e6 * (2 + r() * 3)).toFixed(1);
      head = `${i.name} ${up ? 'raises' : 'trims'} full-year revenue outlook to $${rev}B`; src = 'PR';
    } else {
      const other = inst[pick(r, order.equity.filter(s => s !== i.sym))];
      head = `${i.name} in talks to buy ${other.name}'s ${pick(r, SEGMENTS)} unit, people familiar say`;
      return mk(t, 'MKD', head, [i.sym, other.sym], i);
    }
    return mk(t, src, head, [i.sym], i);
  }

  function macroStory(r, t) {
    const up = r() < 0.5;
    const y10 = curve.find(c => c.tenor === '10Y').y.toFixed(2);
    const heads = [
      [`Central Reserve Board holds policy rate at 5.25%; two members dissent`, ['AMX500']],
      [`Government 10-year yield ${up ? 'rises' : 'falls'} to ${y10}% after a ${up ? 'soft' : 'strong'} auction`, ['AMX500']],
      [`Crude ${up ? 'gains' : 'slips'} as weekly inventories ${up ? 'fall' : 'build'} more than forecast`, ['CL1', 'CO1']],
      [`Gold holds near $${Math.round(inst.GC1.last)} an ounce as the dollar ${up ? 'eases' : 'firms'}`, ['GC1']],
      [`Factory orders survey ${up ? 'beats' : 'misses'} estimates for a third straight month`, ['AIN30']],
      [`Container shipping rates fall 8% week over week as port congestion eases`, ['TLHW']],
      [`Yen ${up ? 'strengthens' : 'weakens'} past ${Math.round(inst.USDJPY.last)} per dollar in late trading`, ['USDJPY']],
      [`Chipmakers lead tech index ${up ? 'higher' : 'lower'} on data-center spending outlook`, ['ATC100', 'NVTK']]
    ];
    const [head, syms] = pick(r, heads);
    return mk(t, pick(r, ['AMW', 'ECO']), head, syms, null);
  }

  function mk(t, src, head, syms, i) {
    const body = [];
    if (i) {
      body.push(`${i.name} (${i.sym}) last traded at ${i.last.toFixed(i.dec)}, ${((i.last / i.prevClose - 1) * 100).toFixed(2)}% on the session. ` +
        `The company works in ${i.sector.toLowerCase()} and is based in ${i.hq}.`);
      body.push(`Volume was running at about ${Math.round(70 + (story.id * 37) % 90)}% of the 30-day average by midafternoon, ` +
        `and two of the five largest holders added to their positions last quarter, according to filings.`);
    } else {
      body.push(`The move came during ${t < SESSION_CLOSE ? 'regular trading' : 'after-hours trading'} and was felt across ${syms.map(s => inst[s].name).join(' and ')}.`);
      body.push(`Strategists said positioning was light going into the release, which amplified the reaction.`);
    }
    body.push('This story was written by the Amberline simulator. It does not describe real events, companies or people.');
    return { id: ++story.id, t, src, head, body, syms, hot: false, born: 0 };
  }

  const news = [];
  (function seedNews() {
    const r = mulberry32(hash('news:' + DAY));
    const end = SESSION_OPEN + 5 * (START_BARS - 1);
    for (let k = 0; k < 26; k++) {
      const t = SESSION_OPEN - 150 + Math.floor(r() * (end - SESSION_OPEN + 150));
      news.push(r() < 0.7 ? companyStory(r, t, inst[pick(r, order.equity)]) : macroStory(r, t));
    }
    news.sort((a, b) => b.t - a.t);
    news.slice(0, 3).forEach(n => { n.hot = true; });
  })();

  // ---------- live loop ----------
  let tickCount = 0, tickInBar = 0, barStart = SESSION_OPEN + 5 * (START_BARS - 1);
  const listeners = [];
  const factors = {};
  const simNow = () => barStart + tickInBar * 5 / TICKS_PER_BAR;

  function step() {
    tickCount++;
    ['Americas', 'EMEA', 'Asia-Pacific', 'Energy', 'Metals', 'Agriculture', 'FX'].forEach(k => { factors[k] = gauss(live); });
    for (const sym in inst) {
      const i = inst[sym];
      const idio = i.type === 'index' ? 0.35 : 0.8;
      const ret = (i.beta * 0.6 * (factors[i.factor] || 0) + idio * gauss(live)) * i.tickSig;
      const prev = i.last;
      i.last = prev * Math.exp(ret);
      i.dir = i.last > prev ? 'up' : i.last < prev ? 'dn' : '';
      const bar = i.intra[i.intra.length - 1], day = i.daily[i.daily.length - 1];
      bar.c = day.c = i.last;
      bar.h = Math.max(bar.h, i.last); bar.l = Math.min(bar.l, i.last);
      day.h = Math.max(day.h, i.last); day.l = Math.min(day.l, i.last);
      if (i.adv) {
        const v = i.adv / 78 / TICKS_PER_BAR * (0.4 + live() * 1.4);
        bar.v += v; day.v += v;
      }
    }
    const common = gauss(live) * 0.0035;
    curve.forEach(c => { c.y += common + gauss(live) * 0.0015; });

    if (++tickInBar >= TICKS_PER_BAR) {
      tickInBar = 0;
      barStart += 5;
      for (const sym in inst) {
        const i = inst[sym];
        i.intra.push({ t: barStart, o: i.last, h: i.last, l: i.last, c: i.last, v: 0 });
        if (i.intra.length > 96) i.intra.shift();
      }
    }

    if (live() < 1 / 30) {
      const movers = order.equity.map(s => inst[s]).sort((a, b) => Math.abs(b.last / b.prevClose - 1) - Math.abs(a.last / a.prevClose - 1));
      const i = live() < 0.5 ? movers[0] : inst[pick(live, order.equity)];
      const n = live() < 0.75 ? companyStory(live, simNow(), i, (i.last / i.prevClose - 1) * 100) : macroStory(live, simNow());
      n.hot = true;
      n.born = tickCount;
      news.unshift(n);
      if (news.length > 120) news.pop();
    }

    listeners.forEach(fn => fn());
  }

  let timer = null;
  root.AmberlineData = {
    DAY, inst, order, curve, news, currencies, perUSD,
    SESSION_CLOSE,
    simNow,
    ticks: () => tickCount,
    onTick(fn) { listeners.push(fn); },
    start() { if (!timer) timer = setInterval(step, TICK_MS); }
  };
})(window);
