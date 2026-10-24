"""A stand-in for the Finnhub REST API, for developing Amberline without a real key.

Every value it returns is made up. Run it, then open the terminal with the dev
override (only honored when the page is served from localhost):

    python tools/mock_finnhub.py            # free plan: candles return 403
    python tools/mock_finnhub.py --candles  # paid plan: candles included
    http://localhost:8000/?api=http://localhost:8766/api/v1&ws=off

Save any key in the KEY panel. The key "bad" is rejected with a 401.
"""
import argparse
import hashlib
import json
import math
import random
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CANDLES = False


def rng_for(*parts):
    seed = int(hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()[:12], 16)
    return random.Random(seed)


def base_price(sym):
    return round(20 + rng_for(sym, "base").random() * 480, 2)


def quote(sym):
    if sym.startswith("ZZZ"):
        return {"c": 0, "d": None, "dp": None, "h": 0, "l": 0, "o": 0, "pc": 0, "t": 0}
    r = rng_for(sym, int(time.time() // 20))
    pc = base_price(sym)
    c = round(pc * (1 + r.gauss(0, 0.012)), 2)
    o = round(pc * (1 + r.gauss(0, 0.004)), 2)
    return {"c": c, "d": round(c - pc, 2), "dp": round((c / pc - 1) * 100, 4), "h": round(max(c, o) * 1.006, 2),
            "l": round(min(c, o) * 0.994, 2), "o": o, "pc": pc, "t": int(time.time())}


def candles(sym, res, frm, to):
    step = 300 if res == "5" else 86400
    t = frm - frm % step
    r = rng_for(sym, res)
    p = base_price(sym) * 0.8
    out = {"o": [], "h": [], "l": [], "c": [], "v": [], "t": [], "s": "ok"}
    while t <= to:
        o = p
        p = p * math.exp(r.gauss(0.0002, 0.015 if step == 86400 else 0.002))
        out["o"].append(round(o, 2)); out["c"].append(round(p, 2))
        out["h"].append(round(max(o, p) * 1.004, 2)); out["l"].append(round(min(o, p) * 0.996, 2))
        out["v"].append(int(r.uniform(2e5, 4e6))); out["t"].append(t)
        t += step
    return out


def news(sym):
    now = int(time.time())
    who = sym or "the market"
    return [{"category": "company" if sym else "general", "datetime": now - k * 1700, "headline": f"Mock headline {k + 1} about {who}",
             "id": abs(hash((sym, k))) % 10**8, "image": "", "related": sym or "SPY", "source": "Mock Wire",
             "summary": "Placeholder summary from the local mock server. Not real news.", "url": "https://example.com/mock-story"}
            for k in range(12)]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if q.get("token") == "bad":
            return self._send(401, {"error": "Invalid API key."})
        sym = q.get("symbol", "").upper()
        path = u.path.replace("/api/v1", "", 1)
        if path == "/quote":
            return self._send(200, quote(sym))
        if path == "/stock/profile2":
            return self._send(200, {"name": f"{sym} Mock Corp", "exchange": "MOCK EXCHANGE", "country": "US", "ipo": "2001-01-01",
                                    "finnhubIndustry": "Mock Industry", "marketCapitalization": 123456.7, "shareOutstanding": 987.6,
                                    "weburl": "https://example.com/", "ticker": sym})
        if path == "/stock/metric":
            return self._send(200, {"metric": {"52WeekHigh": base_price(sym) * 1.3, "52WeekLow": base_price(sym) * 0.7, "beta": 1.1,
                                               "peTTM": 24.5, "epsTTM": 6.2, "currentDividendYieldTTM": 1.1, "10DayAverageTradingVolume": 12.3},
                                    "metricType": "all", "symbol": sym})
        if path == "/stock/peers":
            return self._send(200, [sym, "MSFT", "GOOGL", "META"])
        if path == "/stock/candle":
            if not CANDLES:
                return self._send(403, {"error": "You don't have access to this resource."})
            return self._send(200, candles(sym, q.get("resolution", "D"), int(q.get("from", 0)), int(q.get("to", 0))))
        if path == "/company-news":
            return self._send(200, news(sym))
        if path == "/news":
            return self._send(200, news(None))
        if path == "/search":
            s = q.get("q", "").upper()
            return self._send(200, {"count": 2, "result": [{"description": f"{s} MOCK INC", "displaySymbol": s, "symbol": s, "type": "Common Stock"},
                                                           {"description": f"{s} MOCK ETF", "displaySymbol": s + "X", "symbol": s + "X", "type": "ETP"}]})
        if path == "/stock/market-holiday":
            return self._send(200, {"exchange": "US", "timezone": "America/New_York", "data": [
                {"eventName": "Christmas", "atDate": "2026-12-25", "tradingHour": ""},
                {"eventName": "Thanksgiving Day", "atDate": "2026-11-27", "tradingHour": "09:30-13:00"},
                {"eventName": "Thanksgiving Day", "atDate": "2026-11-26", "tradingHour": ""}]})
        if path == "/stock/market-status":
            return self._send(200, {"exchange": "US", "holiday": None, "isOpen": True, "session": "regular", "t": int(time.time()), "timezone": "America/New_York"})
        return self._send(404, {"error": "Unknown endpoint"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--candles", action="store_true", help="act like a paid plan that includes historical candles")
    args = ap.parse_args()
    CANDLES = args.candles
    print(f"Mock Finnhub on http://localhost:{args.port}/api/v1 (candles {'on' if CANDLES else 'off'})")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
