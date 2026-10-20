import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNetwork, fieldReport, selectedWayIds } from './build-network.mjs';
import { findRoute } from './router.mjs';

const bytes = await readFile(new URL('../../dist/ski-data.json', import.meta.url));
const source = JSON.parse(bytes);
const original = buildNetwork(bytes);
const now = Date.parse('2026-10-20T12:00:00Z');
const stamp = '2026-10-20T11:59:00Z';
// Autorisations FICTIVES, uniquement en mémoire pour exercer les règles.
// Aucune preuve de validation terrain et aucune affirmation d'ouverture réelle.
function authorize(edge, directions = ['forward']) {
  edge.review = {
    validation: 'confirmed', authorization: 'allowed', directions,
    evidence: { reference: 'TEST ONLY — NOT FIELD VALIDATION', validatedBy: 'automated-test', validatedAt: stamp },
  };
}
const open = edge => ({ [edge.id]: { state: 'open', source: 'TEST ONLY — NOT LIVE STATUS', observedAt: stamp } });
function fixture(difficulty = 'novice', lift = false) {
  const way = structuredClone(source.ways.find(w => lift ? w.tags.aerialway : !w.tags.aerialway && w.tags['piste:difficulty'] === difficulty));
  const nodes = [0, 1].map(i => ({ id: `${way.id}:${i}`, sourceWayId: way.id, sourceNodeId: way.nodes[i], sourceIndex: i, coordinates: way.points[i] }));
  const edge = { id: `way/${way.id}/0`, from: nodes[0].id, to: nodes[1].id, kind: lift ? 'lift' : 'piste', sourceWayId: way.id, difficulty: lift ? null : difficulty };
  authorize(edge);
  return { schemaVersion: 1, ways: [way], nodes, edges: [edge] };
}
function route(n, overrides = {}) {
  const e = n.edges[0];
  return findRoute(n, { from: e.from, to: e.to, now, level: 'bleues', availability: open(e), ...overrides });
}

test('Extraction reproductible et rapport synchronisé ; aucune modification des coordonnées/tags/IDs', async () => {
  assert.deepEqual(original, JSON.parse(await readFile(new URL('network.json', import.meta.url))));
  assert.equal(fieldReport(original), await readFile(new URL('terrain-report.md', import.meta.url), 'utf8'));
  assert.equal(selectedWayIds.length, new Set(selectedWayIds).size);
  for (const w of original.ways) assert.deepEqual(w, source.ways.find(s => s.id === w.id));
  assert.equal(original.ways.length, 29);
  assert.equal(original.terminals.length, 58);
  assert.ok(original.terminals.every(t => t.confirmedRole === null));
});

test('Le véritable inventaire ne contient aucune autorisation ni ouverture', () => {
  assert.equal(original.opening.state, 'unknown');
  assert.ok(original.edges.every(e => e.review.authorization === 'unknown' && e.review.validation === 'to_verify' && !e.review.directions.length));
  assert.equal(route(original, { availability: {} }).status, 'refused');
});

for (const [difficulty, level, expected] of [
  ['novice', 'vertes', 'found'], ['easy', 'vertes', 'refused'], ['easy', 'bleues', 'found'],
  ['intermediate', 'bleues', 'refused'], ['intermediate', 'rouges', 'found'],
  ['advanced', 'rouges', 'refused'], ['advanced', 'noires', 'found'],
  ['expert', 'noires', 'found'], ['freeride', 'noires', 'refused'],
]) test(`Niveau : ${difficulty} pour ${level} → ${expected}`, () => {
  assert.equal(route(fixture(difficulty), { level }).status, expected);
});

test('Difficulté absente ou non reconnue refusée, même au niveau noir', () => {
  for (const difficulty of [undefined, 'unknown']) {
    const n = fixture(); n.edges[0].difficulty = difficulty; n.ways[0].tags['piste:difficulty'] = difficulty;
    assert.equal(route(n, { level: 'noires' }).status, 'refused');
  }
});

test('Sens unique et sens inverse explicitement validés', () => {
  const n = fixture(), e = n.edges[0];
  assert.equal(route(n).status, 'found');
  assert.equal(route(n, { from: e.to, to: e.from }).status, 'refused');
  authorize(e, ['reverse']);
  assert.equal(route(n).status, 'refused');
  assert.equal(route(n, { from: e.to, to: e.from }).status, 'found');
});

test('Sens absent ou invalide ne devient jamais bidirectionnel', () => {
  const n = fixture();
  for (const directions of [[], ['both'], undefined]) {
    n.edges[0].review.directions = directions;
    assert.equal(route(n).status, 'refused');
  }
});

test('Remontée : ouverture et autorisation requises, sens validé uniquement', () => {
  const n = fixture(null, true), e = n.edges[0];
  assert.equal(route(n, { level: 'vertes' }).status, 'found');
  assert.equal(route(n, { from: e.to, to: e.from }).status, 'refused');
  assert.equal(route(n, { availability: {} }).status, 'refused');
  e.review.authorization = 'forbidden';
  assert.equal(route(n).status, 'refused');
});

test('Passage inconnu, à vérifier, interdit ou sans preuve refusé', () => {
  for (const changes of [
    { validation: 'to_verify' }, { validation: 'unknown' }, { validation: 'forbidden' },
    { authorization: 'unknown' }, { authorization: 'forbidden' }, { evidence: null },
    { evidence: { reference: '', validatedBy: 'test', validatedAt: stamp } },
    { evidence: { reference: 'test', validatedBy: '', validatedAt: stamp } },
    { evidence: { reference: 'test', validatedBy: 'test', validatedAt: '2027-01-01' } },
  ]) {
    const n = fixture(); Object.assign(n.edges[0].review, changes);
    assert.equal(route(n).status, 'refused');
  }
});

test('Ouverture absente, fermée, inconnue, périmée, future ou sans source refusée', () => {
  const n = fixture(), id = n.edges[0].id;
  for (const state of [null,
    { state: 'closed', observedAt: stamp, source: 'test' },
    { state: 'unknown', observedAt: stamp, source: 'test' },
    { state: 'open', observedAt: '2026-10-19T12:00:00Z', source: 'test' },
    { state: 'open', observedAt: '2026-10-21T12:00:00Z', source: 'test' },
    { state: 'open', observedAt: stamp, source: '' },
  ]) assert.equal(route(n, { availability: { [id]: state } }).status, 'refused');
});

test('Un nœud OSM commun ne fusionne pas les occurrences et ne permet aucun passage implicite', () => {
  const e = original.edges.find(e => e.kind === 'connection');
  const n = structuredClone(original);
  const options = { from: e.from, to: e.to, now, availability: open(e) };
  assert.notEqual(e.from, e.to);
  assert.equal(findRoute(n, options).status, 'refused');
  const connection = n.edges.find(x => x.id === e.id); authorize(connection);
  assert.equal(findRoute(n, options).status, 'found');
  assert.equal(findRoute(n, { ...options, from: e.to, to: e.from }).status, 'refused');
  connection.review.authorization = 'forbidden';
  assert.equal(findRoute(n, options).status, 'refused');
});

test('Aucune connexion de proximité : extrémités distinctes de deux tracés proches restent séparées', () => {
  const n = structuredClone(original);
  // Claux V1 : liaisons source et tapis partagent certains nœuds mais pas ceux-ci.
  const from = n.nodes.filter(n => n.sourceWayId === '1195999849').at(-1);
  const to = n.nodes.filter(n => n.sourceWayId === '1195999851').at(-1);
  assert.notEqual(from.sourceNodeId, to.sourceNodeId);
  assert.ok(Math.hypot((from.coordinates[0] - to.coordinates[0]) * 111320,
    (from.coordinates[1] - to.coordinates[1]) * 111320) < 30);
  const availability = {};
  // Autoriser tous les tronçons (TEST), mais aucune liaison entre tracés.
  for (const e of n.edges.filter(e => e.kind !== 'connection')) { authorize(e, ['forward', 'reverse']); Object.assign(availability, open(e)); }
  assert.equal(findRoute(n, { from: from.id, to: to.id, availability, now }).status, 'refused');
});

test('Parcours multi-arêtes et remontée ; interruption si un seul segment ferme', () => {
  const n = structuredClone(original);
  const junction = n.edges.find(e => e.kind === 'connection' && [e.from, e.to].some(id => id.startsWith('48922502:')) && [e.from, e.to].some(id => id.startsWith('30099882:')));
  assert.ok(junction);
  const lift = n.edges.find(e => e.kind === 'lift' && [junction.from, junction.to].includes(e.from));
  assert.ok(lift);
  const onLift = junction.from === lift.from ? junction.from : junction.to;
  const onPiste = junction.from === onLift ? junction.to : junction.from;
  const piste = n.edges.find(e => e.kind === 'piste' && e.to === onPiste);
  assert.ok(piste);
  authorize(piste); authorize(lift); authorize(junction, [junction.from === onPiste ? 'forward' : 'reverse']);
  const availability = { ...open(piste), ...open(lift), ...open(junction) };
  const options = { from: piste.from, to: lift.to, availability, now };
  const found = findRoute(n, options);
  assert.equal(found.status, 'found'); assert.equal(found.steps.length, 3);
  assert.ok(found.distanceMetres > 0);
  availability[lift.id].state = 'closed';
  assert.equal(findRoute(n, options).status, 'refused');
});

test('Entrées invalides et coordonnées altérées rejetées', () => {
  assert.throws(() => route(fixture(), { level: 'expert' }), /Niveau/);
  assert.throws(() => route(fixture(), { from: 'absent' }), /absent/);
  assert.throws(() => route(fixture(), { now: NaN }), /Horloge/);
  const n = fixture(); n.nodes[0].coordinates = n.nodes[1].coordinates;
  assert.throws(() => route(n), /Nœud/);
});

test('Même départ et arrivée ne donne pas un faux trajet validé de 0 m', () => {
  const n = fixture();
  assert.equal(route(n, { to: n.edges[0].from }).status, 'refused');
});
