# Amberline Terminal

A professional-style market terminal that runs in your browser. It has a command line with autocomplete, four independent panels, live candlestick charts, function keys and a scrolling ticker tape. There's no build step, no dependencies and no API key.

![Amberline Terminal showing a price graph, world indices, top news and an equity monitor](docs/screenshot.png)

> **All data is simulated.** Every company, index name, price, yield and headline is fictional and generated in your browser. Amberline is an independent design study. It is not affiliated with, endorsed by or derived from the software of Bloomberg L.P. or any other market-data vendor.

## Try it

- **Live demo:** after you enable GitHub Pages (see [Deploy](#deploy)), the terminal is at `https://<your-username>.github.io/amberline-terminal/`
- **Locally:** download the repo and open `index.html` in any modern browser. To serve it instead:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## How to use it

Type a **ticker**, a **function**, or both, then press **Enter**. A ticker on its own opens its description. A function on its own reuses the ticker already in the panel. Add `P1` to `P4` to send the result to a specific panel.

| Command | What it shows |
| --- | --- |
| `NVTK GP` | Price graph: candles or line, volume, 20/50-day moving averages. Add `1D`, `1M`, `3M`, `6M` or `1Y`. |
| `PRSM DES` | Description: profile, key statistics, 52-week range, one-year sparkline, peers |
| `NVTK NEWS` | Headlines that mention one security |
| `TOP` | All headlines, newest first. Select one to read the story. |
| `WEI` | World equity indices by region |
| `MOST` | Most active, top gainers and top losers |
| `FXC` | Cross-rate matrix for eight currencies |
| `CMDTY` | Energy, metals and agriculture futures with their quote units |
| `CRV` | Government yield curve today, 1 month ago and 1 year ago |
| `MON` | Monitor of every equity, with bid/ask and an intraday sparkline |
| `HELP` | Every function, with examples and keyboard shortcuts |

### Keyboard

| Key | Action |
| --- | --- |
| `F1`–`F8` | Load HELP, TOP, WEI, MOST, FXC, CMDTY, CRV or MON into the active panel |
| `F9` | Move to the next panel |
| `F10` | Maximize or restore the active panel (or double-click a panel header) |
| `Alt`+`1`–`4` | Select a panel |
| `Tab` | Accept the highlighted autocomplete suggestion |
| `↑` / `↓` | Command history |
| `Esc` | Clear the command line |
| Any letter | Starts typing a command from anywhere on the page |

Your panel layout is saved in your browser, so it's still there when you come back.

## How it works

```
index.html          page shell: top bar, command line, panel grid, function keys, tape
src/data.js         simulated market: instruments, price history, live ticks, headlines
src/terminal.js     front end: command parser, autocomplete, panels, canvas charts
src/terminal.css    the look: dark trading-screen palette, IBM Plex type
docs/TEARDOWN.md    the design study behind the interface
```

**The market** (`src/data.js`). Each instrument gets a year of daily bars and a session of 5-minute bars from a seeded random walk. The seed is the instrument and today's date, so everyone sees the same history on a given day. Today's bars are a Brownian bridge from the open to a reference price. Once a second, every price moves by a shared regional factor plus its own noise, so stocks and their index tend to move together. A new 5-minute bar opens every 30 ticks, and new headlines appear at random, often about the day's biggest mover.

**The front end** (`src/terminal.js`). Each function (`GP`, `DES`, `WEI` and the rest) is a small module with a `mount` method that builds the panel and a `tick` method that updates only the cells that changed. Changed prices flash green or red. Charts are drawn on `<canvas>` with device-pixel-ratio scaling, a crosshair and an OHLC legend. Everything is plain JavaScript with no framework.

## Deploy

The repo includes a GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes the site to GitHub Pages on every push to `main`.

1. Push the repo to GitHub.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push again, or run the workflow from the **Actions** tab. The URL appears in the workflow summary.

Any static host works too (Netlify, Vercel, Cloudflare Pages, S3). Upload the folder as is.

## Ideas for contributions

- Real data behind a pluggable adapter, so the simulator becomes one source among several
- More functions: options chain, earnings calendar, economic calendar, portfolio
- Drawing tools and indicators (RSI, MACD, Bollinger bands) on the price graph
- Saved layouts and a light "paper" theme

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). IBM Plex is loaded from Google Fonts under the SIL Open Font License.
