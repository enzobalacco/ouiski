import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGpsTracker } from './gps-tracker.mjs';
const n = JSON.parse(await readFile(new URL('network.json', import.meta.url)));
const source = JSON.parse(await readFile(new URL('../../dist/ski-data.json', import.meta.url)));
const epoch = Date.parse('2026-10-21T12:00:00Z');

test('Les pistes exclues ne peuvent jamais devenir une correspondance confirmée', () => {
  const excluded = source.ways.filter(w => !n.ways.some(selected => selected.id === w.id));
  let now = epoch;
  const tracker = createGpsTracker(n, { contextWays: source.ways, clock: () => now });
  for (const w of excluded) {
    tracker.reset();
    const point = w.points[Math.floor(w.points.length / 2)];
    let result;
    for (let i = 0; i < 3; i++) {
      now += 1000;
      result = tracker.update({ latitude: point[0], longitude: point[1], accuracy: 2, timestamp: now });
    }
    assert.notEqual(result.state, 'position_confirmed', `Tracé exclu ${w.id}`);
    assert.equal(result.routingAllowed, false);
  }
});

test('Contexte et réseau restent intacts après traitement de positions simulées', () => {
  const before = JSON.stringify({ n, source });
  let now = epoch;
  const tracker = createGpsTracker(n, { contextWays: source.ways, clock: () => now });
  const p = n.ways[0].points[0];
  tracker.update({ latitude: p[0], longitude: p[1], accuracy: 2, timestamp: now });
  tracker.destroy();
  assert.equal(JSON.stringify({ n, source }), before);
});

test('Contexte incohérent ou dupliqué refusé', () => {
  assert.throws(() => createGpsTracker(n, { contextWays: null }), /Contexte/);
  assert.throws(() => createGpsTracker(n, { contextWays: [source.ways[0], source.ways[0]] }), /contexte/);
  const bad = structuredClone(n.ways[0]); bad.points[0][0] += 0.001;
  assert.throws(() => createGpsTracker(n, { contextWays: [bad] }), /contradictoire/);
});

test('Sans contexte, le mode partiel reste explicitement limité et non routable', () => {
  const tracker = createGpsTracker(n, { clock: () => epoch });
  const r = tracker.status();
  assert.equal(r.routingAllowed, false); assert.equal(r.routeOrigin, null);
});

test('Une piste exclue superposée fictive invalide une confirmation auparavant unique', () => {
  // Cas de régression SIMULÉ, pas une affirmation qu'une piste rouge existe ici.
  const w = structuredClone(n.ways.find(w => !w.tags.aerialway));
  const small = structuredClone(n);
  small.ways = [w]; small.nodes = small.nodes.filter(p => p.sourceWayId === w.id && p.sourceIndex < 2);
  small.edges = small.edges.filter(e => e.sourceWayId === w.id && e.from === `${w.id}:0` && e.to === `${w.id}:1`);
  const guard = structuredClone(w); guard.id = 'SIM_EXCLUDED_TRACE_NOT_REAL';
  guard.tags.name = 'SIMULATION de piste voisine'; guard.tags['piste:difficulty'] = 'intermediate';
  const p = w.points[0];
  function acquire(contextWays) {
    let now = epoch;
    const t = createGpsTracker(small, { contextWays, clock: () => now });
    let r;
    for (let i = 0; i < 3; i++) { now += 1000; r = t.update({ latitude: p[0], longitude: p[1], accuracy: 2, timestamp: now }); }
    return r;
  }
  assert.equal(acquire([]).state, 'position_confirmed');
  const guarded = acquire([guard]); assert.equal(guarded.state, 'ambiguous');
  assert.equal(guarded.routingAllowed, false);
});
