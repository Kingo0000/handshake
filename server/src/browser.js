// The verifier's eyes: loads a delivered URL in headless Chromium and reports
// what a client would actually see, with a screenshot kept as evidence.
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1366, height: 820, deviceScaleFactor: 1 },
};

let browserPromise;
const browser = () => (browserPromise ??= launch());

// Serverless hosts have no installed browser, so Vercel uses a Chromium build made for Lambda-style functions.
async function launch() {
  if (!process.env.VERCEL) return chromium.launch();
  const { default: serverless } = await import('@sparticuz/chromium');
  return chromium.launch({ executablePath: await serverless.executablePath(), args: serverless.args, headless: true });
}

export function createInspector(evidenceDir) {
  return {
    async inspect(url, viewportName = 'desktop') {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new RangeError('Only http(s) URLs can be checked');
      const viewport = VIEWPORTS[viewportName] || VIEWPORTS.desktop;
      const context = await (await browser()).newContext({ viewport: { width: viewport.width, height: viewport.height }, ...viewport });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
      try {
        const started = performance.now();
        const response = await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
        const loadMs = Math.round(performance.now() - started);
        const facts = await page.evaluate((deviceWidth) => {
          const doc = document.documentElement;
          const imgs = [...document.images];
          return {
            title: document.title,
            pageWidth: doc.scrollWidth,
            // Mobile Chrome widens the layout viewport to fit oversized content, so compare with the device width.
            viewportWidth: deviceWidth,
            brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 5),
            links: [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.trim().slice(0, 40), href: a.getAttribute('href') })).slice(0, 25),
            forms: [...document.forms].map((f) => [...f.elements].map((e) => e.name || e.type).filter(Boolean)),
            text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000),
          };
        }, viewport.width);
        await mkdir(evidenceDir, { recursive: true });
        const file = `${randomUUID()}.png`;
        await page.screenshot({ path: join(evidenceDir, file), fullPage: false });
        return {
          url,
          viewport: viewportName,
          status: response?.status() ?? null,
          loadMs,
          horizontalOverflow: facts.pageWidth > facts.viewportWidth + 2,
          ...facts,
          consoleErrors: consoleErrors.slice(0, 5),
          screenshot: file,
        };
      } finally {
        await context.close();
      }
    },
  };
}
