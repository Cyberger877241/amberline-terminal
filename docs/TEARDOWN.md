# Design teardown: how a professional market terminal works

Amberline started as a question: what makes the big professional market terminals so fast to use, and can that be rebuilt in a browser with open tools?

## Method: clean-room, public sources only

This is a **user-experience teardown, not a software teardown.** No proprietary terminal software was installed, decompiled, disassembled, intercepted or scraped. Commercial terminals are licensed software, and their license terms generally forbid reverse engineering. The interaction patterns below are well known from public sources such as product marketing pages, published screenshots, trade-press articles and finance courses. All of Amberline's code and branding are original. Function mnemonics such as GP and DES follow conventions widely documented for professional terminals, including Bloomberg's, and are used descriptively. All market data is real and comes from Finnhub at runtime.

If you want to try binary or app analysis tools such as [REA](https://github.com/morluto/rea), use them on software you're authorized to inspect. Amberline's own source is a good target because it's MIT-licensed.

## Patterns we found and how Amberline implements them

| Pattern | Why it works | In Amberline |
| --- | --- | --- |
| **Command line first** | Experts type faster than they click. One input reaches every screen. | The `1>` command line is always visible. Typing a letter anywhere on the page sends it there. |
| **Security + function grammar** | Two short tokens, *what* and *which view*, combine into thousands of screens without menus. | `AAPL GP`, `MSFT DES`, `NVDA NEWS`. The parser accepts either order, and a bare function reuses the panel's ticker. |
| **Short mnemonics** | Two to five letter codes are fast to type and easy to say to a colleague. | `GP`, `DES`, `WEI`, `FXC`, `CRV`, `MOST` follow widely documented terminal conventions. Aliases such as `CHART`, `FX`, `YC` help newcomers. |
| **Autocomplete as a safety net** | Novices find codes by name, experts never see the list. | Suggestions match ticker prefixes, company names and function names. `Tab` accepts one. |
| **Multiple independent panels** | Traders watch several things at once and compare them. | Four panels, each with its own function, ticker and back history. `F9` cycles, `F10` maximizes. |
| **Dedicated function keys** | The most-used screens are one keystroke away. | `F1`–`F8` map to help, news, indices, movers, FX, commodities, curve and monitor. |
| **Dark screen, amber text** | High contrast for long sessions and a strong look on a trading floor. | A near-black ground, amber for identifiers, warm off-white for values. |
| **Color means direction, never decoration** | Green and red are read before numbers are. | Only price direction uses green and red. Ticks flash briefly in the direction of the move. |
| **Monospaced, tabular numbers** | Columns of prices line up, so changes are easy to scan. | IBM Plex Mono with `tabular-nums` throughout. Labels use IBM Plex Sans Condensed. |
| **Density over whitespace** | Professionals want the most information per screen. | 12px data rows, sticky table headers, no decorative cards. |
| **Persistent ticker tape** | Ambient awareness of the market without changing screens. | A scrolling tape along the bottom. Select any item to chart it. Hover pauses it. |
| **Units are part of the data** | A price is meaningless without its unit: barrels, troy ounces, cents per bushel. | Views that use ETFs say plainly when a price is an ETF rather than the market itself, and quote currencies are shown next to prices. |

## What we left out on purpose

- **Trademarks and branding.** Amberline has its own name and mark, and uses no vendor's logo or keyboard artwork.
- **Bundled or simulated market data.** The app never ships, stores or invents market data; the development-only mock server in `tools/` is the sole exception, and the app labels it as made-up data whenever it's in use. Real quotes and news come from Finnhub at runtime with each viewer's own key, so the repo itself contains no third-party data.
- **Messaging, trading and compliance features.** These are huge systems in their own right and aren't needed to show the interaction model.

## Where to take it next

- More data providers behind `src/market.js`, so a licensed feed can replace Finnhub
- User-defined monitors and saved workspaces
- Chart studies and drawing tools
