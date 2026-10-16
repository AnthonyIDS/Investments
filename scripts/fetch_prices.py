#!/usr/bin/env python3
"""Fetch one year of daily closes for every symbol in data/watchlist.json
and write data/market.json for the dashboard.

Runs in the GitHub Action. Standard library only.
Primary source: Yahoo Finance chart API. Fallback: Stooq daily CSV.
If a symbol fails on both, the previous day's data for it is kept.
"""
import csv
import io
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = ROOT / "data" / "watchlist.json"
OUT = ROOT / "data" / "market.json"
UA = "Mozilla/5.0 (compatible; investments-dashboard/1.0)"


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def from_yahoo(sym):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
           "?range=1y&interval=1d&includePrePost=false")
    data = json.loads(get(url))
    res = data["chart"]["result"][0]
    meta = res["meta"]
    stamps = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    hist = []
    for t, c in zip(stamps, closes):
        if c is None:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d")
        hist.append([d, round(float(c), 4)])
    if len(hist) < 2:
        raise ValueError("too little history")
    price = meta.get("regularMarketPrice") or hist[-1][1]
    # Previous close = the last completed session before the latest bar.
    prev = hist[-2][1]
    return {
        "price": round(float(price), 4),
        "prev_close": prev,
        "currency": meta.get("currency", "USD"),
        "market_time": datetime.fromtimestamp(
            meta.get("regularMarketTime", stamps[-1]), tz=timezone.utc
        ).isoformat(),
        "history": hist,
        "source": "Yahoo Finance",
    }


def from_stooq(sym):
    s = sym.lower().replace(".", "-") + ".us"
    text = get(f"https://stooq.com/q/d/l/?s={s}&i=d")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "Close" not in rows[0]:
        raise ValueError("no stooq data")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=372)).strftime("%Y-%m-%d")
    hist = [[r["Date"], round(float(r["Close"]), 4)] for r in rows
            if r.get("Date", "") >= cutoff and r.get("Close") not in (None, "", "N/D")]
    if len(hist) < 2:
        raise ValueError("too little history")
    return {
        "price": hist[-1][1],
        "prev_close": hist[-2][1],
        "currency": "USD",
        "market_time": hist[-1][0] + "T21:00:00+00:00",
        "history": hist,
        "source": "Stooq",
    }


def main():
    watch = json.loads(WATCHLIST.read_text())
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text()).get("symbols", {})
        except Exception:
            old = {}

    out, failed = {}, []
    for item in watch["symbols"]:
        sym = item["symbol"]
        got = None
        for fn in (from_yahoo, from_stooq):
            try:
                got = fn(sym)
                break
            except Exception as e:  # noqa: BLE001
                print(f"{sym}: {fn.__name__} failed: {e}", file=sys.stderr)
                time.sleep(1)
        if got:
            out[sym] = got
            print(f"{sym}: {got['price']} ({got['source']}, {len(got['history'])} days)")
        elif sym in old:
            out[sym] = {**old[sym], "stale": True}
            failed.append(sym)
        else:
            failed.append(sym)
        time.sleep(0.5)

    if not out:
        print("No data fetched for any symbol; leaving market.json unchanged.", file=sys.stderr)
        sys.exit(1)

    OUT.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "failed": failed,
        "symbols": out,
    }, separators=(",", ":")))
    print(f"Wrote {OUT} with {len(out)} symbols; failed: {failed or 'none'}")


if __name__ == "__main__":
    main()
