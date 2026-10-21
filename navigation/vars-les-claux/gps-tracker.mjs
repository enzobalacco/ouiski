import { validateNetwork } from './router.mjs';
import { distanceMetres, distanceToSegment } from './gps-geometry.mjs';

// Seuils de prototype, conservateurs mais PAS validés en montagne.
export const GPS_POLICY = Object.freeze({
  maxAccuracyMetres: 20,
  mapToleranceMetres: 3,
  maxConfirmedDistanceMetres: 10,
  maxObservationAgeMs: 10_000,
  confirmations: 3,
  minConfirmationSpanMs: 2_000,
  minEvidenceIntervalMs: 500,
  maxPlausibleSpeedMetresPerSecond: 35,
});
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o)
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const validTime = t => Number.isFinite(t) && Number.isFinite(new Date(t).getTime());
const note = 'Estimation géométrique uniquement : aucune validation terrain, ouverture ou autorisation de passage déduite.';

/** État volatile minimal. Aucun capteur, requête réseau, journal ou stockage persistant.
 * L'appelant transmet explicitement les observations. Aucun appel à findRoute.
 */
export function createGpsTracker(network, { clock = Date.now, contextWays = [] } = {}) {
  if (typeof clock !== 'function') throw new Error('Horloge GPS invalide');
  const snapshot = structuredClone(network);
  const { nodes, ways } = validateNetwork(snapshot);
  const segments = snapshot.edges.filter(e => e.kind !== 'connection').map(e => ({
    id: e.id, sourceWayId: e.sourceWayId, kind: e.kind, sourceIndex: nodes.get(e.from).sourceIndex,
    start: nodes.get(e.from).coordinates, end: nodes.get(e.to).coordinates,
    name: ways.get(e.sourceWayId).tags.name || null, inNetwork: true,
  }));
  if (!segments.length) throw new Error('Réseau GPS sans tronçon');
  // Les tracés voisins servent seulement à lever un doute, jamais au routage.
  if (!Array.isArray(contextWays)) throw new Error('Contexte cartographique invalide');
  const context = structuredClone(contextWays), seenContext = new Set();
  for (const w of context) {
    if (!plain(w) || typeof w.id !== 'string' || !w.id || seenContext.has(w.id)
      || !plain(w.tags) || !Array.isArray(w.nodes) || !Array.isArray(w.points)
      || w.points.length < 2 || w.nodes.length !== w.points.length) throw new Error('Tracé de contexte invalide');
    seenContext.add(w.id);
    for (const p of w.points) distanceMetres(p, p);
    const selected = ways.get(w.id);
    if (selected) {
      if (JSON.stringify(selected.nodes) !== JSON.stringify(w.nodes)
        || JSON.stringify(selected.points) !== JSON.stringify(w.points)) throw new Error('Contexte contradictoire avec le réseau');
      continue;
    }
    if (w.tags['piste:type'] !== 'downhill' && !w.tags.aerialway) continue;
    for (let i = 0; i < w.points.length - 1; i++) segments.push({
      id: `context/${w.id}/${i}`, sourceWayId: w.id, sourceIndex: i,
      kind: w.tags.aerialway ? 'lift' : 'piste', start: w.points[i], end: w.points[i+1],
      name: w.tags.name || null, inNetwork: false,
    });
  }
  // Vérifier une fois les géométries dégénérées/antipodales, sans combler les trous.
  for (const s of segments) distanceToSegment(s.start, s.start, s.end);
  let watermark = null, lastFix = null, pending = null, confirmed = null;
  let lastClock = null, destroyed = false;
  let result = base('gps_unavailable', 'no_observation');

  function base(state, reason, extras = {}) {
    return { state, reason, match: null, candidates: [], routingAllowed: false,
      routeOrigin: null, terrainValidated: false, note, ...extras };
  }
  function clear(state, reason, extras) {
    lastFix = null; pending = null; confirmed = null;
    result = base(state, reason, extras);
    return structuredClone(result);
  }
  function time() {
    const now = clock();
    if (!validTime(now)) { clear('gps_unavailable', 'invalid_clock'); throw new Error('Horloge GPS invalide'); }
    if (lastClock !== null && now < lastClock) {
      clear('gps_unavailable', 'clock_regression');
      return null;
    }
    lastClock = now;
    return now;
  }
  function status() {
    if (destroyed) return base('gps_unavailable', 'destroyed');
    const now = time();
    if (now === null) return structuredClone(result);
    if (watermark !== null && now - watermark > GPS_POLICY.maxObservationAgeMs) {
      return clear('gps_unavailable', 'signal_timeout');
    }
    return structuredClone(result);
  }
  function update(observation) {
    if (destroyed) return base('gps_unavailable', 'destroyed');
    const now = time();
    if (now === null) return structuredClone(result);
    if (!plain(observation)) return clear('gps_unavailable', 'missing_or_invalid_observation');
    const { latitude, longitude, accuracy, timestamp } = observation;
    if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90
      || Math.abs(longitude) > 180 || accuracy <= 0 || !validTime(timestamp)) {
      return clear('gps_unavailable', 'invalid_observation');
    }
    if (timestamp > now) return clear('gps_unavailable', 'future_observation');
    if (now - timestamp > GPS_POLICY.maxObservationAgeMs) return clear('gps_unavailable', 'stale_observation');
    if (watermark !== null && timestamp <= watermark) return clear('gps_unavailable', 'non_increasing_timestamp');
    const gap = watermark !== null && timestamp - watermark > GPS_POLICY.maxObservationAgeMs;
    if (gap) { pending = null; confirmed = null; lastFix = null; }
    watermark = timestamp;
    if (accuracy > GPS_POLICY.maxAccuracyMetres) return clear('low_accuracy', 'horizontal_accuracy_insufficient');
    const point = [latitude, longitude];
    if (lastFix) {
      const dt = (timestamp - lastFix.timestamp)/1000;
      const minimumTravel = Math.max(0, distanceMetres(point, lastFix.point) - accuracy - lastFix.accuracy);
      if (minimumTravel/dt > GPS_POLICY.maxPlausibleSpeedMetresPerSecond) {
        return clear('low_accuracy', 'implausible_motion');
      }
    }
    lastFix = { point, accuracy, timestamp };
    const radius = accuracy + GPS_POLICY.mapToleranceMetres;
    const byWay = new Map(), plausibleSections = new Map();
    for (const s of segments) {
      const projection = distanceToSegment(point, s.start, s.end);
      const candidate = { ...s, ...projection };
      const old = byWay.get(s.sourceWayId);
      if (!old || candidate.distanceMetres < old.distanceMetres) byWay.set(s.sourceWayId, candidate);
      if (candidate.distanceMetres <= radius) {
        if (!plausibleSections.has(s.sourceWayId)) plausibleSections.set(s.sourceWayId, []);
        plausibleSections.get(s.sourceWayId).push(s.sourceIndex);
      }
    }
    const nearest = [...byWay.values()].sort((a, b) => a.distanceMetres - b.distanceMetres || a.sourceWayId.localeCompare(b.sourceWayId));
    const plausible = nearest.filter(c => c.distanceMetres <= radius);
    // Les candidats incertains n'exposent aucun point de départ pour le routeur.
    const candidates = plausible.map(c => ({ sourceWayId: c.sourceWayId, kind: c.kind, distanceMetres: c.distanceMetres, inNetwork: c.inNetwork }));
    if (!plausible.length) {
      pending = null; confirmed = null;
      result = base('off_network', 'no_trace_within_uncertainty', { nearestDistanceMetres: nearest[0]?.distanceMetres ?? null });
      return structuredClone(result);
    }
    const best = plausible[0];
    const sections = plausibleSections.get(best.sourceWayId).sort((a, b) => a-b);
    const multipleSections = sections.some((index, i) => i > 0 && index > sections[i-1] + 1);
    if (plausible.length > 1 || !best.inNetwork || multipleSections || best.kind !== 'piste' || best.distanceMetres > GPS_POLICY.maxConfirmedDistanceMetres) {
      pending = null; confirmed = null;
      result = base('ambiguous', plausible.length > 1 ? 'multiple_plausible_traces' : !best.inNetwork ? 'outside_selected_network' : multipleSections ? 'same_trace_multiple_sections' : best.kind !== 'piste' ? 'lift_position_unresolved' : 'trace_too_distant', { candidates });
      return structuredClone(result);
    }
    if (confirmed !== best.sourceWayId) {
      confirmed = null;
      if (!pending || pending.id !== best.sourceWayId || timestamp - pending.start > GPS_POLICY.maxObservationAgeMs) {
        pending = { id: best.sourceWayId, count: 1, start: timestamp, last: timestamp };
      }
      else if (timestamp - pending.last >= GPS_POLICY.minEvidenceIntervalMs) { pending.count++; pending.last = timestamp; }
      if (pending.count >= GPS_POLICY.confirmations && timestamp - pending.start >= GPS_POLICY.minConfirmationSpanMs) confirmed = best.sourceWayId;
    }
    if (!confirmed) {
      result = base('ambiguous', 'awaiting_consistent_observations', { candidates });
    } else {
      result = base('position_confirmed', 'consistent_unique_geometric_match', {
        observationTimestamp: timestamp, expiresAtTimestamp: timestamp + GPS_POLICY.maxObservationAgeMs,
        match: { sourceWayId: best.sourceWayId, sourceEdgeId: best.id, name: best.name,
          distanceMetres: best.distanceMetres, fraction: best.fraction, projectedCoordinates: best.coordinates },
        candidates,
      });
    }
    return structuredClone(result);
  }
  function reset() {
    watermark = null; lastClock = null;
    return clear('gps_unavailable', destroyed ? 'destroyed' : 'reset');
  }
  function unavailable() { return clear('gps_unavailable', destroyed ? 'destroyed' : 'sensor_unavailable'); }
  function destroy() { destroyed = true; return reset(); }
  return Object.freeze({ update, status, unavailable, reset, destroy });
}
