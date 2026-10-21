import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMobileTestServer } from './mobile-test/server.mjs';
test('Serveur privé : ressources autorisées, protections et refus de collecte/traversée', async () => {
  const server = createMobileTestServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/', '/network.json', '/source.json', '/modules/gps-tracker.mjs', '/modules/network-validation.mjs']) {
      const r = await fetch(base+path); assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.ok(r.headers.get('content-security-policy').includes("default-src 'none'"));
    }
    for (const path of ['/../../README.md', '/.git/config', '/modules/attestations.mjs', '/unknown']) assert.equal((await fetch(base+path)).status, 404);
    assert.equal((await fetch(base+'/?latitude=44')).status, 400);
    assert.equal((await fetch(base+'/', { method: 'POST', body: 'position' })).status, 405);
    const status = await new Promise((resolve, reject) => {
      const req = http.get(base+'/', { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
    });
    assert.equal(status, 403);
  } finally { await new Promise(r => server.close(r)); }
});
