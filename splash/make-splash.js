// Makes the launch pictures in this folder from the real launch screen (#launchScreen in index.html, its step line hidden), dark and light, one per
// iPhone screen size in sizes.json. Run it after changing the launch screen: node splash/make-splash.js (needs Playwright; PLAYWRIGHT=path/to/playwright
// if it is not installed here). New sizes go in sizes.json and in the apple-touch-startup-image links in index.html.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const SCOPE = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify ugc-image-upload";
const SIZES = require(ROOT + 'splash/sizes.json');
(async () => {
  const b = await chromium.launch();
  for (const [w, h, r] of SIZES) for (const scheme of ['dark', 'light']) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r, colorScheme: scheme });
    await p.route('https://api.spotify.com/**', () => {});   // never answers, so the launch screen stays
    await p.route(/^https?:\/\/(?!api\.spotify|app\.localhost)/, (x) => x.abort());
    await p.route('http://app.localhost/**', (x) => { const u = new URL(x.request().url()); x.fulfill({ path: ROOT + (u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1))) }); });
    await p.addInitScript((sc) => { Object.defineProperty(navigator, 'standalone', { get: () => true }); localStorage.setItem('connectedBefore', '1'); localStorage.setItem('backupMode', 'manual'); sessionStorage.setItem('token', JSON.stringify({ value: 't', expires: Date.now() + 3600000, scope: sc })); }, SCOPE);
    await p.goto('http://app.localhost/'); await p.waitForTimeout(600);
    await p.addStyleTag({ content: '#launchScreen .ls-foot { visibility: hidden; } #launchScreen { transition: none; }' });
    const on = await p.evaluate(() => document.documentElement.classList.contains('launching'));
    if (!on) { console.log('NOT LAUNCHING', w, h); continue; }
    await p.screenshot({ path: ROOT + `splash/launch-${w * r}x${h * r}-${scheme}.png` });
    await p.close();
  }
  await b.close();
})();
