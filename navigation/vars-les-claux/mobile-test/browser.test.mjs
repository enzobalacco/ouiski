import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createMobileTestServer } from './server.mjs';

async function run(viewport, action) {
  const server = createMobileTestServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.OUISKI_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.addInitScript(() => {
      // CAPTEUR ET HORLOGE SIMULÉS, aucune observation personnelle.
      let now = Date.now(), next = 0;
      const watchers = new Map(); Date.now = () => now;
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(ok, error) { const id = ++next; watchers.set(id, { ok, error }); return id; },
        clearWatch(id) { watchers.delete(id); },
      } });
      window.simulatedGps = {
        emit() { now += 1000; for (const w of watchers.values()) w.ok({ coords: { latitude: 44.571, longitude: 6.680, accuracy: 5 }, timestamp: now }); },
        deny() { for (const w of [...watchers.values()]) w.error({ code: 1 }); },
        expire() { now += 11_000; }, count() { return watchers.size; },
      };
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await action({ page, base, errors, requests });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(u => new URL(u).origin === base), 'Aucune requête extérieure');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`Navigateur ${viewport.width}px : démarrage explicite, carte, expiration et arrêt sans transmission`, async () => {
    await run(viewport, async ({ page, base, requests }) => {
      await page.goto(base); await page.locator('#start:enabled').waitFor();
      assert.equal(await page.evaluate(() => simulatedGps.count()), 0);
      assert.equal(await page.locator('#traces path').count(), 157);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const before = requests.length;
      await page.locator('#start').click();
      assert.equal(await page.evaluate(() => simulatedGps.count()), 1);
      await page.evaluate(() => { simulatedGps.emit(); simulatedGps.emit(); simulatedGps.emit(); });
      assert.notEqual(await page.locator('#coordinates').innerText(), '—');
      assert.equal(await page.locator('#dot').getAttribute('hidden'), null);
      await page.evaluate(() => simulatedGps.expire());
      await page.waitForFunction(() => document.getElementById('coordinates').textContent === '—');
      assert.equal(await page.locator('#state').innerText(), 'GPS indisponible');
      await page.evaluate(() => simulatedGps.emit());
      await page.locator('#stop').click();
      assert.equal(await page.evaluate(() => simulatedGps.count()), 0);
      assert.equal(await page.locator('#coordinates').innerText(), '—');
      assert.equal(requests.length, before, 'Aucune requête après activation GPS');
      await page.locator('#start').click();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await page.evaluate(() => simulatedGps.count()), 0);
      assert.equal(await page.locator('#coordinates').innerText(), '—');
    });
  });
  test(`Navigateur ${viewport.width}px : refus de permission explicite sans relance automatique`, async () => {
    await run(viewport, async ({ page, base }) => {
      await page.goto(base); await page.locator('#start:enabled').waitFor();
      await page.locator('#start').click(); await page.evaluate(() => simulatedGps.deny());
      assert.equal(await page.evaluate(() => simulatedGps.count()), 0);
      assert.match(await page.locator('#explanation').innerText(), /refusée/);
      assert.equal(await page.locator('#coordinates').innerText(), '—');
      assert.equal(await page.locator('#stop').isDisabled(), true);
    });
  });
}
test('Données inaccessibles : aucun capteur activé et démarrage bloqué', async () => {
  await run({ width: 390, height: 844 }, async ({ page, base }) => {
    await page.route('**/source.json', route => route.abort());
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById('loading').textContent.includes('Impossible'));
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.equal(await page.evaluate(() => simulatedGps.count()), 0);
  });
});
