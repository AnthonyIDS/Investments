# Investments

A static dashboard (GitHub Pages) for a 13-holding watchlist:

| Group | Holdings |
|---|---|
| Growth picks | ACHR, RGTI |
| Index ETFs | QQQ, VOO |
| Income fund | CHW |
| Energy, largest EBITDA | XOM, SHEL, CVX, TTE |
| Tech, largest EBITDA | NVDA, MSFT, AAPL, TSM |

The energy and tech names come from a screen of the largest trailing-twelve-month
EBITDA among US-listed shares, run 2026-10-16. Figures and sources are in
`data/watchlist.json` and on the page. That screen is a snapshot; it does not re-run itself.

## How prices update

`.github/workflows/update-prices.yml` runs `scripts/fetch_prices.py` every weekday
at 5:30 pm New York time (and on demand from the **Actions** tab). It pulls a year
of daily closes from Yahoo Finance, falling back to Stooq, and commits
`data/market.json`. No API key is needed.

## Changing the watchlist

Edit `data/watchlist.json`: add or remove entries in `symbols` (each needs a
`group` from `groups`), commit, then run the workflow once.

## One-time setup

1. **Settings → Pages:** Source "Deploy from a branch", branch `main`, folder `/ (root)`.
2. **Actions → Update prices → Run workflow** to load the first prices.

The site will be at https://anthonyids.github.io/Investments/

For information only, not investment advice.
