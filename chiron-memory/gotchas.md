# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Claude in Chrome cannot open file:// pages

What: the Claude in Chrome extension refuses `file://` URLs ("Can't interact with browser-internal or unparseable URLs"); verify the page over `python3 -m http.server` on 127.0.0.1 and check file:// loading separately with headless Chrome `--dump-dom` · Why: extension-side restriction, not a page bug · Where: index.html verification · Learned: resize_window also will not shrink below the Chrome minimum (~860px); test 375px by loading the page in a 375px-wide iframe instead
