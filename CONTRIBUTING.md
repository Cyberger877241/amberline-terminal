# Contributing

Thanks for helping. Amberline is plain HTML, CSS and JavaScript, so you don't need a toolchain.

## Run it

```bash
python -m http.server 8000
```

Open <http://localhost:8000> and edit files in `src/`. Reload the page to see changes.

## Add a function

1. In `src/terminal.js`, add an entry to the `FN` object:

   ```js
   FN.ABC = {
     name: 'My Function',       // shown in panel titles and HELP
     sec: 'none',               // 'req' if it needs a ticker
     example: 'ABC',            // shown in HELP
     help: 'One sentence on what it shows.',
     mount(p, s) {              // p.body is the panel; s is its saved state
       p.body.innerHTML = '...';
       return { tick() { /* runs once a second */ }, destroy() { /* clean up */ } };
     }
   };
   ```

2. It shows up in autocomplete and in `HELP` automatically.

## Guidelines

- Keep data fictional. Don't add real company names, tickers or live prices to the simulator.
- Don't use other vendors' logos, product names or screen designs.
- Update only the cells that changed in `tick()`, not the whole panel.
- Check the page at phone width (about 375px). The page itself must never scroll sideways.
- Keep it dependency-free unless a library does substantial work.
