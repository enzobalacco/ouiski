import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGpsTracker, GPS_POLICY } from './gps-tracker.mjs';
import { distanceMetres, distanceToSegment } from './gps-geometry.mjs';
import { findRoute } from './router.mjs';

// TOUTES les observations et géométries SIM_* ci-dessous sont des simulations,
// sans correspondance revendiquée avec une piste ou une personne réelle.
const epoch = Date.parse('2026-10-20T12:00:00Z');
const a = [[44.570, 6.680], [44.572, 6.680]];
const b = [[44.570, 6.680150], [44.572, 6.680150]];
function network(definitions = [{ id: 'SIM_A', points: a }]) {
  const ways = definitions.map(({ id, points, lift }) => ({
    id, points: structuredClone(points), nodes: points.map((_, i) => `${id}-source-${i}`),
    tags: lift ? { aerialway: 'chair_lift', name: id } : { 'piste:type': 'downhill', 'piste:difficulty': 'easy', name: id },
  }));
  const nodes = ways.flatMap(w => w.points.map((coordinates, i) => ({
    id: `${w.id}:${i}`, sourceWayId: w.id, sourceIndex: i, sourceNodeId: w.nodes[i], coordinates,
  })));
  const edges = ways.flatMap(w => w.points.slice(1).map((_, i) => ({
    id: `way/${w.id}/${i}`, from: `${w.id}:${i}`, to: `${w.id}:${i+1}`, sourceWayId: w.id,
    kind: w.tags.aerialway ? 'lift' : 'piste', difficulty: w.tags['piste:difficulty'],
    review: { validation: 'to_verify', authorization: 'unknown', directions: [], evidence: null },
  })));
  return { schemaVersion: 1, id: 'SIMULATED-NETWORK-NOT-FIELD-DATA', ways, nodes, edges };
}
function harness(n = network()) {
  let now = epoch;
  const tracker = createGpsTracker(n, { clock: () => now });
  function sample(ms = 0, overrides = {}) {
    now = epoch + ms;
    return tracker.update({ latitude: 44.571, longitude: 6.680, accuracy: 2, timestamp: now, ...overrides });
  }
  return { tracker, sample, setTime: ms => { now = epoch + ms; } };
}
function confirm(h, overrides = {}) { h.sample(0, overrides); h.sample(1000, overrides); return h.sample(2000, overrides); }
function noRouting(r) {
  assert.equal(r.routingAllowed, false); assert.equal(r.routeOrigin, null); assert.equal(r.terrainValidated, false);
  if (r.state !== 'position_confirmed') assert.equal(r.match, null);
}

test('Projection sur le milieu du segment, même à plus de 100 m des points source', () => {
  const result = distanceToSegment([44.571, 6.680], ...a);
  assert.ok(result.distanceMetres < 0.001);
  assert.ok(distanceMetres([44.571, 6.680], a[0]) > 100);
  assert.ok(Math.abs(result.fraction - 0.5) < 0.000001);
});

test('Projection bornée : pas de prolongement du tracé au-delà des extrémités', () => {
  const result = distanceToSegment([44.573, 6.680], ...a);
  assert.equal(result.fraction, 1); assert.deepEqual(result.coordinates, a[1]);
  assert.ok(result.distanceMetres > 100);
});

test('Distance perpendiculaire calculée en mètres', () => {
  const result = distanceToSegment([44.571, 6.6801], ...a);
  assert.ok(result.distanceMetres > 7 && result.distanceMetres < 9);
  assert.ok(Math.abs(result.coordinates[1] - 6.680) < 1e-8);
});

test('Segment de longueur nulle : résultat fini, sans division par zéro', () => {
  const result = distanceToSegment(a[0], a[0], a[0]);
  assert.ok(result.distanceMetres < 1e-6); assert.equal(result.fraction, 0);
});

test('Projection sphérique : passage de la ligne de changement de date', () => {
  const result = distanceToSegment([0, 180], [0, 179.9], [0, -179.9]);
  assert.ok(result.distanceMetres < 0.001); assert.ok(Math.abs(result.fraction - 0.5) < 1e-7);
});

test('Projection : coordonnées invalides et segment antipodal refusés', () => {
  for (const p of [[91, 6], [44, 181], [NaN, 6], [44, Infinity], [44], ['44', 6]]) {
    assert.throws(() => distanceToSegment(p, ...a), /Coordonnées/);
  }
  assert.throws(() => distanceToSegment([0, 0], [0, 0], [0, 180]), /antipodal/);
});

test('Sans observation : gps_unavailable', () => {
  const h = harness(); assert.equal(h.tracker.status().state, 'gps_unavailable'); noRouting(h.tracker.status());
});

test('Confirmation après trois observations uniques sur au moins deux secondes', () => {
  const h = harness();
  assert.equal(h.sample(0).state, 'ambiguous'); assert.equal(h.sample(1000).state, 'ambiguous');
  const r = h.sample(2000); assert.equal(r.state, 'position_confirmed');
  assert.equal(r.observationTimestamp, epoch + 2000); assert.equal(r.expiresAtTimestamp, epoch + 12_000);
  assert.equal(r.match.sourceWayId, 'SIM_A'); assert.equal(r.match.sourceEdgeId, 'way/SIM_A/0');
  noRouting(r);
});

test('Rafale d’observations : trois échantillons trop rapprochés ne confirment rien', () => {
  const h = harness(); h.sample(0); h.sample(10); assert.equal(h.sample(20).state, 'ambiguous');
  assert.equal(h.sample(1000).state, 'ambiguous'); assert.equal(h.sample(2000).state, 'position_confirmed');
});

test('Piste unique distante des sommets : correspondance à l’intérieur du tronçon', () => {
  const h = harness(); const r = confirm(h);
  assert.ok(r.match.distanceMetres < 0.001); assert.ok(r.match.fraction > 0.49 && r.match.fraction < 0.51);
});

test('Pistes parallèles : le disque d’incertitude touche les deux, donc ambiguous', () => {
  const h = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]));
  const r = confirm(h, { longitude: 6.680075, accuracy: 4 });
  assert.equal(r.state, 'ambiguous'); assert.equal(r.reason, 'multiple_plausible_traces');
  assert.equal(r.candidates.length, 2); noRouting(r);
});

test('Amélioration de la précision : même réseau parallèle, confirmation possible du tracé unique', () => {
  const h = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]));
  const r = confirm(h); assert.equal(r.state, 'position_confirmed'); assert.equal(r.match.sourceWayId, 'SIM_A');
});

test('Une ancienne confirmation n’est jamais conservée face à deux pistes plausibles', () => {
  const h = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]));
  confirm(h); const r = h.sample(3000, { longitude: 6.680075, accuracy: 4 });
  assert.equal(r.state, 'ambiguous'); noRouting(r);
});

test('Oscillations A/B : aucun changement de piste confirmé sans nouvelle série stable', () => {
  const h = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]));
  confirm(h);
  for (const [ms, longitude] of [[3000, 6.680150], [4000, 6.680], [5000, 6.680150], [6000, 6.680]]) {
    const r = h.sample(ms, { longitude }); assert.equal(r.state, 'ambiguous'); noRouting(r);
  }
  h.sample(7000, { longitude: 6.680150 }); h.sample(8000, { longitude: 6.680150 });
  const r = h.sample(9000, { longitude: 6.680150 });
  assert.equal(r.state, 'position_confirmed'); assert.equal(r.match.sourceWayId, 'SIM_B'); noRouting(r);
});

test('Mauvaise précision : low_accuracy, même exactement sur une piste', () => {
  const h = harness(); confirm(h); const r = h.sample(3000, { accuracy: 21 });
  assert.equal(r.state, 'low_accuracy'); noRouting(r);
  assert.equal(h.sample(4000).state, 'ambiguous');
});

test('Précision à la limite : aucune confirmation si le tracé reste trop distant', () => {
  const h = harness(); const r = confirm(h, { longitude: 6.6802, accuracy: 20 });
  assert.equal(r.state, 'ambiguous'); assert.equal(r.reason, 'trace_too_distant'); noRouting(r);
});

test('Hors réseau : aucune projection forcée vers la piste la plus proche', () => {
  const h = harness(); const r = confirm(h, { longitude: 6.690 });
  assert.equal(r.state, 'off_network'); assert.ok(r.nearestDistanceMetres > 500); noRouting(r);
});

test('Observations anciennes refusées sans réutiliser une confirmation', () => {
  const h = harness(); confirm(h);
  const r = h.sample(20_000, { timestamp: epoch + 2000 });
  assert.equal(r.state, 'gps_unavailable'); assert.equal(r.reason, 'stale_observation'); noRouting(r);
});

test('Interruption : status expire sans nouvelle observation et exige une nouvelle acquisition', () => {
  const h = harness(); confirm(h); h.setTime(12_001);
  assert.equal(h.tracker.status().state, 'gps_unavailable');
  assert.equal(h.sample(13_000).state, 'ambiguous');
  h.sample(14_000); assert.equal(h.sample(15_000).state, 'position_confirmed');
});

test('Intervalle excessif entre observations : réacquisition même sans appel intermédiaire à status', () => {
  const h = harness(); confirm(h); assert.equal(h.sample(13_000).state, 'ambiguous');
});

test('Limite d’ancienneté : exactement 10 secondes puis expiration', () => {
  const h = harness(); confirm(h); h.setTime(12_000);
  assert.equal(h.tracker.status().state, 'position_confirmed');
  h.setTime(12_001); assert.equal(h.tracker.status().state, 'gps_unavailable');
});

test('Horodatages dupliqués, réordonnés ou futurs : aucune confirmation', () => {
  const h = harness(); confirm(h);
  for (const [ms, timestamp, reason] of [[3000, epoch+2000, 'non_increasing_timestamp'], [4000, epoch+1000, 'non_increasing_timestamp'], [5000, epoch+6000, 'future_observation']]) {
    const r = h.sample(ms, { timestamp }); assert.equal(r.state, 'gps_unavailable'); assert.equal(r.reason, reason); noRouting(r);
  }
  assert.equal(h.sample(6000).state, 'ambiguous');
});

test('Observations invalides : absence, valeurs non finies, mauvais types et bornes', () => {
  for (const change of [{ latitude: 91 }, { longitude: -181 }, { accuracy: 0 }, { accuracy: -1 },
    { accuracy: Infinity }, { latitude: NaN }, { longitude: '6.68' }, { timestamp: '2026-10-20' }, { timestamp: 1e30 }]) {
    const h = harness(); confirm(h); const r = h.sample(3000, change);
    assert.equal(r.state, 'gps_unavailable'); noRouting(r);
  }
  for (const observation of [null, undefined, {}, [], 'gps']) assert.equal(harness().tracker.update(observation).state, 'gps_unavailable');
});

test('Saut de position physiquement invraisemblable : signal dégradé et aucune ancienne confirmation', () => {
  const h = harness(); confirm(h);
  const r = h.sample(3000, { latitude: 44.580 });
  assert.equal(r.state, 'low_accuracy'); assert.equal(r.reason, 'implausible_motion'); noRouting(r);
});

test('Petites fluctuations GPS sur le même tracé : confirmation conservée', () => {
  const h = harness(); confirm(h);
  for (const [ms, longitude] of [[3000, 6.680005], [4000, 6.679995], [5000, 6.680003]]) {
    assert.equal(h.sample(ms, { longitude }).state, 'position_confirmed');
  }
});

test('Remontée seule ou superposée : aucune piste confirmée par simple position 2D', () => {
  const liftOnly = harness(network([{ id: 'SIM_LIFT', points: a, lift: true }]));
  assert.equal(confirm(liftOnly).reason, 'lift_position_unresolved');
  const overlap = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_LIFT', points: a, lift: true }]));
  const r = confirm(overlap); assert.equal(r.state, 'ambiguous'); noRouting(r);
});

test('Croisement de pistes : pas de décision arbitraire au carrefour', () => {
  const h = harness(network([{ id: 'SIM_A', points: a }, { id: 'SIM_CROSS', points: [[44.571, 6.679], [44.571, 6.681]] }]));
  assert.equal(confirm(h).state, 'ambiguous');
});

test('Même nom mais deux tracés distincts : aucune fusion des candidats', () => {
  const n = network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]);
  for (const w of n.ways) w.tags.name = 'SIMULATION même nom';
  const r = confirm(harness(n), { longitude: 6.680075, accuracy: 4 });
  assert.equal(r.state, 'ambiguous'); assert.equal(r.candidates.length, 2);
});

test('Points consécutifs du même tracé : pas de fausse ambiguïté à un sommet', () => {
  const h = harness(network([{ id: 'SIM_A', points: [a[0], [44.571, 6.680], a[1]] }]));
  assert.equal(confirm(h).state, 'position_confirmed');
});

test('Un même tracé se croise : sections non contiguës ambiguës', () => {
  const points = [[44.570, 6.679], [44.572, 6.681], [44.572, 6.679], [44.570, 6.681]];
  const h = harness(network([{ id: 'SIM_LOOP', points }]));
  const r = confirm(h); assert.equal(r.state, 'ambiguous'); assert.equal(r.reason, 'same_trace_multiple_sections');
});

test('Trou dans les arêtes source : pas de correspondance créée entre deux tronçons séparés', () => {
  const n = network([{ id: 'SIM_A', points: [[44.570, 6.680], [44.5702, 6.680], [44.5718, 6.680], [44.572, 6.680]] }]);
  n.edges.splice(1, 1);
  assert.equal(confirm(harness(n)).state, 'off_network');
});

test('Estimation confirmée ne crée aucune connexion ni autorisation et ne permet aucun routage', () => {
  const n = network([{ id: 'SIM_A', points: a }, { id: 'SIM_B', points: b }]);
  const before = JSON.stringify(n); const r = confirm(harness(n)); noRouting(r);
  assert.equal(JSON.stringify(n), before);
  assert.equal(findRoute(n, { from: 'SIM_A:0', to: 'SIM_B:1', now: epoch }).status, 'refused');
});

test('Le réseau réel est réutilisé intact et reste sans autorisations', async () => {
  const n = JSON.parse(await readFile(new URL('network.json', import.meta.url)));
  const before = JSON.stringify(n); const h = harness(n);
  const r = h.sample(0); assert.ok(['ambiguous', 'off_network'].includes(r.state)); noRouting(r);
  assert.equal(JSON.stringify(n), before);
  assert.ok(n.edges.every(e => e.review.authorization === 'unknown'));
});

test('Modification des entrées ou d’un résultat ne modifie pas l’état interne', () => {
  const n = network(), h = harness(n); n.ways[0].points[0][1] = 7;
  const r = confirm(h); assert.equal(r.state, 'position_confirmed');
  r.match.sourceWayId = 'FAUX'; r.match.projectedCoordinates[0] = 0; r.candidates.length = 0;
  const next = h.tracker.status(); assert.equal(next.match.sourceWayId, 'SIM_A'); assert.notEqual(next.match.projectedCoordinates[0], 0);
});

test('Reset, indisponibilité explicite et destruction effacent la confirmation', () => {
  const h = harness(); confirm(h); assert.equal(h.tracker.unavailable().state, 'gps_unavailable');
  assert.equal(h.sample(3000).state, 'ambiguous'); h.tracker.reset();
  assert.equal(h.tracker.status().reason, 'reset');
  h.tracker.destroy(); assert.equal(h.sample(4000).reason, 'destroyed');
  assert.equal(h.tracker.status().reason, 'destroyed'); assert.equal(h.tracker.unavailable().reason, 'destroyed');
});

test('Recul ou invalidité de l’horloge invalide la décision au lieu de réutiliser un résultat ancien', () => {
  const h = harness(); confirm(h); h.setTime(1000);
  assert.equal(h.tracker.status().reason, 'clock_regression');
  h.setTime(3000); assert.equal(h.tracker.status().state, 'gps_unavailable');
  h.setTime(NaN); assert.throws(() => h.tracker.status(), /Horloge/);
  h.setTime(4000); assert.equal(h.tracker.status().state, 'gps_unavailable');
});

test('Configuration et géométries réseau invalides refusées dès la construction', () => {
  assert.throws(() => createGpsTracker(network(), { clock: 1 }), /Horloge/);
  assert.throws(() => createGpsTracker({ schemaVersion: 1, ways: [], nodes: [], edges: [] }), /sans tronçon/);
  const n = network(); n.nodes[0].coordinates = [91, 6];
  assert.throws(() => createGpsTracker(n), /Nœud/);
  assert.equal(Object.isFrozen(GPS_POLICY), true);
});

test('Position future ou très imprécise ne peut pas empoisonner les observations suivantes', () => {
  const h = harness();
  assert.equal(h.sample(0, { timestamp: epoch + 100_000 }).state, 'gps_unavailable');
  assert.equal(h.sample(1000).state, 'ambiguous');
  assert.equal(h.sample(2000, { accuracy: 1000 }).state, 'low_accuracy');
  h.sample(3000); h.sample(4000); assert.equal(h.sample(5000).state, 'position_confirmed');
});

test('Polls répétés et observation répétée ne comptent pas comme preuves supplémentaires', () => {
  const h = harness(); h.sample(0);
  h.setTime(2000);
  for (let i = 0; i < 10; i++) assert.equal(h.tracker.status().state, 'ambiguous');
  assert.equal(h.sample(2000, { timestamp: epoch }).state, 'gps_unavailable');
  h.sample(3000); h.sample(4000); assert.equal(h.sample(5000).state, 'position_confirmed');
});

test('Une sortie du réseau annule la confirmation ; retour avec nouvelle série complète', () => {
  const h = harness(); confirm(h);
  // Éloignement progressif compatible avec la vitesse maximale du prototype.
  assert.equal(h.sample(3000, { longitude: 6.6804 }).state, 'off_network');
  assert.equal(h.sample(4000).state, 'ambiguous'); h.sample(5000);
  assert.equal(h.sample(6000).state, 'position_confirmed');
});

test('Projection sur un arc oblique et près des pôles : résultats finis et bornés', () => {
  for (const [p, start, end] of [
    [[44.571, 6.681], [44.570, 6.680], [44.572, 6.682]],
    [[89.9995, 0], [89.999, -10], [89.999, 10]],
  ]) {
    const r = distanceToSegment(p, start, end);
    assert.ok(Number.isFinite(r.distanceMetres)); assert.ok(r.fraction >= 0 && r.fraction <= 1);
    assert.ok(r.coordinates.every(Number.isFinite));
    assert.ok(r.distanceMetres <= Math.min(distanceMetres(p, start), distanceMetres(p, end)) + 1e-6);
  }
});

test('La première preuve de confirmation ne peut pas être ancienne de plus de dix secondes', () => {
  const h = harness(); h.sample(0); h.sample(10_000);
  assert.equal(h.sample(20_000).state, 'ambiguous');
  h.sample(21_000); assert.equal(h.sample(22_000).state, 'position_confirmed');
});
