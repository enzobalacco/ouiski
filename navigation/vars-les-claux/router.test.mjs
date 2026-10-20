import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNetwork, fieldReport, selectedWayIds } from './build-network.mjs';
import { findRoute } from './router.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { attestationPayload, networkFingerprint } from './attestations.mjs';

const bytes = await readFile(new URL('../../dist/ski-data.json', import.meta.url));
const source = JSON.parse(bytes);
const original = buildNetwork(bytes);
const now = Date.parse('2026-10-20T12:00:00Z');
const stamp = '2026-10-20T11:59:00Z';
const reviewKey = generateKeyPairSync('ed25519');
const openingKey = generateKeyPairSync('ed25519');
const trust = {
  reviewKeys: new Map([['test-review', reviewKey.publicKey]]),
  openingKeys: new Map([['test-opening', openingKey.publicKey]]),
};
function seal(n, availability) {
  const fingerprint = networkFingerprint(n);
  for (const e of n.edges) {
    for (const [kind, claims, keyId, key] of [
      ['review', e.review, 'test-review', reviewKey],
      ['opening', availability[e.id], 'test-opening', openingKey],
    ]) if (claims && typeof claims === 'object') {
      claims.signature = { keyId, value: sign(null, attestationPayload(kind, fingerprint, e.id, claims), key.privateKey).toString('base64') };
    }
  }
  return { trust };
}
// Cette aide signe seulement les jeux de test. Le moteur de production ne signe rien.
function routeWithTestTrust(n, options) {
  const { availability = {} } = options;
  return findRoute(n, { ...options, ...seal(n, availability) });
}
// Autorisations FICTIVES, uniquement en mémoire pour exercer les règles.
// Aucune preuve de validation terrain et aucune affirmation d'ouverture réelle.
function authorize(edge, directions = ['forward']) {
  edge.review = {
    validation: 'confirmed', authorization: 'allowed', directions,
    evidence: { reference: 'TEST ONLY — NOT FIELD VALIDATION', validatedBy: 'automated-test', validatedAt: stamp, validUntil: '2026-10-21T12:00:00Z' },
  };
}
const open = edge => ({ [edge.id]: { state: 'open', source: 'TEST ONLY — NOT LIVE STATUS', observedAt: stamp } });
function fixture(difficulty = 'novice', lift = false) {
  const way = structuredClone(source.ways.find(w => lift ? w.tags.aerialway && w.nodes.length === 2 : !w.tags.aerialway && w.tags['piste:difficulty'] === difficulty));
  const nodes = [0, 1].map(i => ({ id: `${way.id}:${i}`, sourceWayId: way.id, sourceNodeId: way.nodes[i], sourceIndex: i, coordinates: way.points[i] }));
  const edge = { id: `way/${way.id}/0`, from: nodes[0].id, to: nodes[1].id, kind: lift ? 'lift' : 'piste', sourceWayId: way.id, difficulty: lift ? null : difficulty };
  authorize(edge);
  return { schemaVersion: 1, ways: [way], nodes, edges: [edge] };
}
function route(n, overrides = {}) {
  const e = n.edges[0];
  return routeWithTestTrust(n, { from: e.from, to: e.to, now, level: 'bleues', availability: open(e), ...overrides });
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
  assert.equal(routeWithTestTrust(n, options).status, 'refused');
  const connection = n.edges.find(x => x.id === e.id); authorize(connection);
  assert.equal(routeWithTestTrust(n, options).status, 'found');
  assert.equal(routeWithTestTrust(n, { ...options, from: e.to, to: e.from }).status, 'refused');
  connection.review.authorization = 'forbidden';
  assert.equal(routeWithTestTrust(n, options).status, 'refused');
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
  assert.equal(routeWithTestTrust(n, { from: from.id, to: to.id, availability, now }).status, 'refused');
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
  const liftEdges = n.edges.filter(e => e.kind === 'lift' && e.sourceWayId === lift.sourceWayId);
  for (const e of liftEdges) { authorize(e); Object.assign(availability, open(e)); }
  const options = { from: piste.from, to: liftEdges.at(-1).to, availability, now };
  const found = routeWithTestTrust(n, options);
  assert.equal(found.status, 'found'); assert.equal(found.steps.length, liftEdges.length + 2);
  assert.ok(found.distanceMetres > 0);
  availability[lift.id].state = 'closed';
  assert.equal(routeWithTestTrust(n, options).status, 'refused');
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

test('SECURITE : un objet de validation rempli à la main ne doit pas autoriser un trajet', () => {
  const n = fixture(), e = n.edges[0];
  assert.equal(findRoute(n, { from: e.from, to: e.to, now, availability: open(e) }).status, 'refused');
});

test('SECURITE : on ne peut pas désactiver la péremption en augmentant maxAgeMs', () => {
  assert.throws(() => route(fixture(), { maxAgeMs: 365 * 24 * 3600_000 }), /fraîcheur/);
});

test('SECURITE : coordonnées invalides du tracé source, même hors des nœuds utilisés', () => {
  const n = fixture(); n.ways[0].points.at(-1)[0] = 91;
  assert.throws(() => route(n), /Tracé/);
});

test('SECURITE : une arête mal formée ne peut pas se cacher derrière une absence de validation', () => {
  const n = fixture(); n.edges[0].sourceWayId = 'absent'; n.edges[0].review = null;
  assert.throws(() => route(n), /Arête/);
});

test('SECURITE : dates ambiguës ou corrigées automatiquement ne sont pas des observations valides', () => {
  const n = fixture(), e = n.edges[0];
  assert.equal(route(n, { availability: { [e.id]: { state: 'open', source: 'test', observedAt: '2026-10-20 11:59:00' } } }).status, 'refused');
});

test('SECURITE : données réseau manquantes donnent une erreur contrôlée', () => {
  for (const n of [null, {}, { schemaVersion: 1 }, { schemaVersion: 1, ways: [null], nodes: [], edges: [] }]) {
    assert.throws(() => findRoute(n, { from: 'a', to: 'b', now }), /Réseau|Tracé/);
  }
});

function sealedFixture() {
  const n = fixture(), e = n.edges[0], availability = open(e);
  const options = { from: e.from, to: e.to, now, availability, ...seal(n, availability) };
  return { n, e, availability, options };
}

test('Signature valide : trajet possible sans mutation des entrées et clés éphémères seulement', () => {
  const { n, options } = sealedFixture();
  const before = JSON.stringify(n), openings = JSON.stringify(options.availability);
  const result = findRoute(n, options);
  assert.equal(result.status, 'found');
  assert.equal(JSON.stringify(n), before); assert.equal(JSON.stringify(options.availability), openings);
  result.coordinates[0][0] = 0;
  assert.equal(JSON.stringify(n), before);
});

test('Validation modifiée après signature : interdiction, directions et preuve liées cryptographiquement', () => {
  for (const tamper of [
    e => { e.review.directions = ['forward', 'reverse']; },
    e => { e.review.evidence.reference = 'faux-document'; },
    e => { e.review.evidence.validatedBy = 'autre-validateur'; },
    e => { e.review.evidence.validUntil = '2027-12-31T00:00:00Z'; },
  ]) {
    const { n, e, options } = sealedFixture(); tamper(e);
    assert.equal(findRoute(n, options).status, 'refused');
  }
});

test('Modifier la difficulté du tracé et de l’arête invalide les attestations', () => {
  const n = fixture('easy'), e = n.edges[0], availability = open(e);
  const options = { from: e.from, to: e.to, now, level: 'vertes', availability, ...seal(n, availability) };
  n.ways[0].tags['piste:difficulty'] = e.difficulty = 'novice';
  assert.equal(findRoute(n, options).status, 'refused');
});

test('Modifier ensemble coordonnées source et nœuds invalide les attestations', () => {
  const { n, options } = sealedFixture();
  n.ways[0].points[0] = [...n.ways[0].points[1]];
  n.nodes[0].coordinates = [...n.ways[0].points[0]];
  assert.equal(findRoute(n, options).status, 'refused');
});

test('Copier une signature vers une autre arête, version de réseau ou rôle échoue', () => {
  for (const tamper of [
    ({ n, e }) => { e.id += '-copie'; },
    ({ n }) => { n.id = 'autre-version'; },
    ({ e, availability }) => { e.review.signature = availability[e.id].signature; },
    ({ e, availability }) => { availability[e.id].signature = e.review.signature; },
  ]) {
    const f = sealedFixture(); tamper(f);
    assert.equal(findRoute(f.n, f.options).status, 'refused');
  }
});

test('Clé absente, non approuvée, privée ou de mauvais type : refus', () => {
  const { n, options } = sealedFixture();
  const other = generateKeyPairSync('ed25519');
  for (const key of [null, reviewKey.privateKey, other.publicKey, { type: 'public', asymmetricKeyType: 'ed25519' }]) {
    assert.equal(findRoute(n, { ...options, trust: { ...trust, reviewKeys: new Map([['test-review', key]]) } }).status, 'refused');
  }
  assert.equal(findRoute(n, { ...options, trust: {} }).status, 'refused');
  assert.equal(findRoute(n, { ...options, trust: { ...trust, openingKeys: new Map() } }).status, 'refused');
});

test('Signature absente, tronquée, corrompue ou clé inconnue : refus', () => {
  for (const signature of [null, {}, { keyId: 'test-review', value: '' },
    { keyId: 'test-review', value: Buffer.alloc(64).toString('base64') },
    { keyId: 'inconnue', value: Buffer.alloc(64).toString('base64') },
  ]) {
    const { n, e, options } = sealedFixture(); e.review.signature = signature;
    assert.equal(findRoute(n, options).status, 'refused');
  }
});

test('Ouverture non signée ou réécrite pour paraître récente : refus', () => {
  for (const tamper of [
    o => { delete o.signature; }, o => { o.observedAt = '2026-10-20T12:00:00Z'; },
    o => { o.source = 'faux-exploitant'; },
  ]) {
    const { n, e, availability, options } = sealedFixture(); tamper(availability[e.id]);
    assert.equal(findRoute(n, options).status, 'refused');
  }
});

test('Une fermeture signée ne peut pas être réécrite en ouverture', () => {
  const { n, e, availability, options } = sealedFixture();
  availability[e.id].state = 'closed'; seal(n, availability);
  availability[e.id].state = 'open';
  assert.equal(findRoute(n, options).status, 'refused');
});

test('Validation expirée, sans expiration ou avec calendrier invalide : refus même signée', () => {
  for (const change of [
    r => { r.evidence.validUntil = '2026-10-20T12:00:00Z'; },
    r => { delete r.evidence.validUntil; },
    r => { r.evidence.validatedAt = '2026-02-30T00:00:00Z'; },
    r => { r.evidence.validatedAt = '2026-10-20'; },
    r => { r.evidence.validatedAt = 1792497540000; },
    r => { r.evidence.validUntil = r.evidence.validatedAt; },
  ]) {
    const n = fixture(); change(n.edges[0].review);
    assert.equal(route(n).status, 'refused');
  }
});

test('Seuil de fraîcheur de 15 minutes : limite acceptée, milliseconde suivante refusée', () => {
  const n = fixture(), e = n.edges[0], availability = open(e);
  availability[e.id].observedAt = '2026-10-20T11:45:00.000Z';
  const options = { from: e.from, to: e.to, availability, now, ...seal(n, availability) };
  assert.equal(findRoute(n, options).status, 'found');
  assert.equal(findRoute(n, { ...options, now: now + 1 }).status, 'refused');
  assert.equal(findRoute(n, { ...options, maxAgeMs: 60_000 }).status, 'refused');
});

test('Une connexion vers une piste bleue ne contourne pas le niveau vert', () => {
  const n = structuredClone(original);
  const e = n.edges.find(e => e.id === 'junction/247064725/22935308:37/29121177:52');
  authorize(e, ['forward', 'reverse']); const availability = open(e);
  const options = { from: e.to, to: e.from, availability, now, ...seal(n, availability) };
  assert.equal(findRoute(n, { ...options, level: 'bleues' }).status, 'found');
  assert.equal(findRoute(n, { ...options, level: 'vertes' }).status, 'refused');
});

test('Embarquer ou débarquer au milieu d’une remontée est refusé', () => {
  const n = structuredClone(original), e = n.edges.find(e => e.kind === 'lift');
  authorize(e); const availability = open(e);
  assert.equal(routeWithTestTrust(n, { from: e.from, to: e.to, availability, now }).reason, 'intermediate_lift_endpoint');
  assert.equal(routeWithTestTrust(n, { from: e.to, to: e.from, availability, now }).reason, 'intermediate_lift_endpoint');
});

test('Réseaux mal formés : doublons, trous, points non finis et bornes invalides', () => {
  for (const tamper of [
    n => n.ways.push(structuredClone(n.ways[0])),
    n => n.nodes.push(structuredClone(n.nodes[0])),
    n => n.edges.push(structuredClone(n.edges[0])),
    n => { n.ways[0].points.pop(); },
    n => { delete n.ways[0].points[0][0]; },
    n => { n.ways[0].points[0][0] = NaN; },
    n => { n.ways[0].points[0][1] = Infinity; },
    n => { n.ways[0].points[0][1] = -181; },
    n => { n.nodes[0].sourceIndex = -1; },
    n => { n.nodes[0].id = 'identite-ambigue'; },
    n => { n.edges[0].kind = 'teleport'; },
    n => { n.edges[0].to = 'absent'; },
  ]) {
    const n = fixture(); tamper(n);
    assert.throws(() => findRoute(n, { from: n.nodes[0].id, to: n.nodes[1].id, now }), /Tracé|Nœud|Arête/);
  }
});

test('Une arête ne peut pas sauter un point source ni changer de type', () => {
  const n = fixture(); n.nodes[1].sourceIndex = 2;
  n.nodes[1].sourceNodeId = n.ways[0].nodes[2]; n.nodes[1].coordinates = n.ways[0].points[2];
  n.nodes[1].id = `${n.ways[0].id}:2`; n.edges[0].to = n.nodes[1].id;
  assert.throws(() => findRoute(n, { from: n.nodes[0].id, to: n.nodes[1].id, now }), /Arête/);
  const other = fixture(); other.edges[0].kind = 'lift';
  assert.throws(() => route(other), /Arête/);
});

test('Connexion avec identifiants distincts ou sur un même tracé : rejet structurel', () => {
  const n = fixture(), e = n.edges[0]; e.kind = 'connection';
  e.topology = 'shared_source_node'; e.sourceNodeId = n.nodes[0].sourceNodeId;
  assert.throws(() => route(n), /Arête/);
});

test('Sens bidirectionnel explicite seulement ; oneway=no ne suffit pas', () => {
  const n = fixture(), e = n.edges[0]; n.ways[0].tags.oneway = 'no';
  assert.equal(route(n, { from: e.to, to: e.from }).status, 'refused');
  authorize(e, ['forward', 'reverse']);
  assert.equal(route(n).status, 'found');
  assert.equal(route(n, { from: e.to, to: e.from }).status, 'found');
  e.review.directions = ['forward', 'forward'];
  assert.equal(route(n).status, 'refused');
});

test('Une fermeture et un passage inconnu bloquent un parcours malgré un autre segment ouvert', () => {
  const n = structuredClone(original), lift = n.ways.find(w => w.id === '48922502');
  const edges = n.edges.filter(e => e.sourceWayId === lift.id), availability = {};
  for (const e of edges) { authorize(e); Object.assign(availability, open(e)); }
  const options = { from: edges[0].from, to: edges.at(-1).to, availability, now };
  assert.equal(routeWithTestTrust(n, options).status, 'found');
  edges[2].review.authorization = 'unknown';
  assert.equal(routeWithTestTrust(n, options).status, 'refused');
});

test('Options manquantes, fraîcheur invalide et horloge hors plage : erreur contrôlée', () => {
  const n = fixture();
  for (const options of [null, [], { now: 1e30 }, { maxAgeMs: 0 }, { maxAgeMs: Infinity }, { availability: null }, { trust: null }]) {
    assert.throws(() => findRoute(n, options), /Options|Horloge|Disponibilités|Registre/);
  }
});

test('Une difficulté JSON non textuelle ou nommée comme un prototype reste inconnue', () => {
  for (const difficulty of [['easy'], [], null, {}, 'constructor', '__proto__']) {
    const n = fixture('easy'); n.ways[0].tags['piste:difficulty'] = n.edges[0].difficulty = difficulty;
    assert.equal(route(n).status, 'refused');
  }
});

test('Un tag aerialway mal formé ne transforme pas une piste en remontée', () => {
  for (const aerialway of [true, [], ['chair_lift'], {}, '', 'unknown']) {
    const n = fixture(); n.ways[0].tags.aerialway = aerialway; n.edges[0].kind = 'lift';
    assert.throws(() => route(n), /Tracé/);
  }
});

test('Métadonnées de validation héritées ou champs de disponibilité hérités ne sont pas fiables', () => {
  const n = fixture(), e = n.edges[0];
  e.review = Object.create(e.review);
  assert.equal(findRoute(n, { from: e.from, to: e.to, now, availability: open(e), trust }).status, 'refused');
  const f = sealedFixture();
  assert.throws(() => findRoute(f.n, { ...f.options, availability: Object.create(f.availability) }), /Disponibilités/);
});

test('Retirer une clé du registre révoque son usage lors du calcul suivant', () => {
  const { n, options } = sealedFixture();
  const reviewKeys = new Map(trust.reviewKeys);
  assert.equal(findRoute(n, { ...options, trust: { ...trust, reviewKeys } }).status, 'found');
  reviewKeys.delete('test-review');
  assert.equal(findRoute(n, { ...options, trust: { ...trust, reviewKeys } }).status, 'refused');
});

test('Signature valide et géométrie cohérente ne remplacent pas une difficulté compatible', () => {
  const n = fixture('advanced'), e = n.edges[0], availability = open(e);
  const options = { from: e.from, to: e.to, availability, now, ...seal(n, availability) };
  assert.equal(findRoute(n, { ...options, level: 'noires' }).status, 'found');
  assert.equal(findRoute(n, { ...options, level: 'bleues' }).status, 'refused');
});
