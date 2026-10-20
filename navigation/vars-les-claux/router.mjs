import { authentic, isoTime, networkFingerprint } from './attestations.mjs';

const ranks = { novice: 0, easy: 1, intermediate: 2, advanced: 3, expert: 3 };
const levels = { vertes: 0, bleues: 1, rouges: 2, noires: 3 };
const liftTypes = new Set(['chair_lift', 'platter', 'magic_carpet', 'mixed_lift']);
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o)
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
export const MAX_OPENING_AGE_MS = 15 * 60_000;
const validPoint = p => Array.isArray(p) && p.length === 2 && Array.from(p).every(Number.isFinite)
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

function validateNetwork(network) {
  if (!record(network) || network.schemaVersion !== 1
    || !['ways', 'nodes', 'edges'].every(k => Array.isArray(network[k]))) throw new Error('Réseau invalide');
  const ways = new Map(), sourcePoints = new Map(), nodes = new Map(), seen = new Set();
  for (const w of network.ways) {
    if (!record(w) || !nonempty(w.id) || ways.has(w.id) || !record(w.tags)
      || !Array.isArray(w.nodes) || !Array.isArray(w.points) || w.nodes.length < 2
      || w.nodes.length !== w.points.length) throw new Error('Tracé source invalide');
    if (Object.hasOwn(w.tags, 'aerialway') && !liftTypes.has(w.tags.aerialway)) throw new Error('Tracé : type de remontée non pris en charge');
    for (let i = 0; i < w.nodes.length; i++) {
      if (!nonempty(w.nodes[i]) || !validPoint(w.points[i])) throw new Error('Tracé source invalide');
      const old = sourcePoints.get(w.nodes[i]);
      if (old && (old[0] !== w.points[i][0] || old[1] !== w.points[i][1])) throw new Error('Tracé : nœud OSM contradictoire');
      sourcePoints.set(w.nodes[i], w.points[i]);
    }
    ways.set(w.id, w);
  }
  for (const n of network.nodes) {
    const w = ways.get(n?.sourceWayId);
    if (!record(n) || !w || nodes.has(n.id) || !Number.isInteger(n.sourceIndex) || n.sourceIndex < 0
      || n.id !== `${w.id}:${n.sourceIndex}` || !nonempty(n.sourceNodeId)
      || w.nodes[n.sourceIndex] !== n.sourceNodeId || !validPoint(n.coordinates)
      || n.coordinates[0] !== w.points[n.sourceIndex]?.[0] || n.coordinates[1] !== w.points[n.sourceIndex]?.[1]) {
      throw new Error('Nœud de réseau invalide');
    }
    nodes.set(n.id, n);
  }
  for (const e of network.edges) {
    if (!record(e) || !nonempty(e.id) || seen.has(e.id) || !nodes.has(e.from) || !nodes.has(e.to)
      || e.from === e.to || !['piste', 'lift', 'connection'].includes(e.kind)) throw new Error('Arête de réseau invalide');
    seen.add(e.id);
    const a = nodes.get(e.from), b = nodes.get(e.to), w = ways.get(e.sourceWayId);
    if (e.kind === 'connection') {
      if (a.sourceWayId === b.sourceWayId || a.sourceNodeId !== b.sourceNodeId
        || e.sourceNodeId !== a.sourceNodeId || e.topology !== 'shared_source_node'
        || a.coordinates[0] !== b.coordinates[0] || a.coordinates[1] !== b.coordinates[1]) {
        throw new Error('Arête : connexion sans nœud source commun');
      }
    } else if (!w || a.sourceWayId !== w.id || b.sourceWayId !== w.id || b.sourceIndex !== a.sourceIndex + 1
      || e.kind !== (w.tags.aerialway ? 'lift' : 'piste')
      || (e.kind === 'piste' && (w.tags['piste:type'] !== 'downhill' || e.difficulty !== w.tags['piste:difficulty']))) {
      throw new Error('Arête hors du tracé source');
    }
  }
  return { nodes, ways };
}

/** Pas de recherche par proximité, de projection GPS ni de fusion de nœuds OSM. */
export function findRoute(network, options = {}) {
  if (!record(options)) throw new Error('Options de routage invalides');
  const { from, to, level = 'bleues', availability = {}, now = Date.now(),
    maxAgeMs = MAX_OPENING_AGE_MS, trust = {} } = options;
  if (typeof level !== 'string' || !Object.hasOwn(levels, level)) throw new Error('Niveau invalide');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())
    || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > MAX_OPENING_AGE_MS) throw new Error('Horloge ou fraîcheur invalide');
  if (!record(availability)) throw new Error('Disponibilités invalides');
  if (!record(trust)) throw new Error('Registre de confiance invalide');
  const { nodes, ways } = validateNetwork(network);
  if (!nodes.has(from) || !nodes.has(to)) throw new Error('Départ ou arrivée absent du réseau');
  // Un point seul ne constitue pas un itinéraire validé.
  if (from === to) return { status: 'refused', reason: 'identical_endpoints' };
  const fingerprint = networkFingerprint(network), graph = new Map();
  const compatible = n => {
    const w = ways.get(n.sourceWayId), difficulty = w.tags['piste:difficulty'];
    return !!w.tags.aerialway || (typeof difficulty === 'string' && Object.hasOwn(ranks, difficulty) && ranks[difficulty] <= levels[level]);
  };
  const liftTerminal = n => {
    const w = ways.get(n.sourceWayId);
    return !w.tags.aerialway || n.sourceIndex === 0 || n.sourceIndex === w.nodes.length - 1;
  };
  if (!liftTerminal(nodes.get(from)) || !liftTerminal(nodes.get(to))) {
    return { status: 'refused', reason: 'intermediate_lift_endpoint' };
  }
  for (const e of network.edges) {
    const r = e.review;
    if (!record(r) || r.validation !== 'confirmed' || r.authorization !== 'allowed'
      || !record(r.evidence) || !nonempty(r.evidence.reference) || !nonempty(r.evidence.validatedBy)) continue;
    const validated = isoTime(r.evidence.validatedAt), expires = isoTime(r.evidence.validUntil);
    if (!Number.isFinite(validated) || !Number.isFinite(expires) || validated > now
      || expires <= now || expires <= validated) continue;
    if (!Array.isArray(r.directions) || !r.directions.length || new Set(r.directions).size !== r.directions.length
      || Array.from(r.directions).some(d => !['forward', 'reverse'].includes(d))) continue;
    if (!authentic('review', fingerprint, e.id, r, trust.reviewKeys)) continue;
    const opening = Object.hasOwn(availability, e.id) ? availability[e.id] : null;
    const timestamp = isoTime(opening?.observedAt);
    if (!record(opening) || opening.state !== 'open' || !nonempty(opening.source) || !Number.isFinite(timestamp)
      || timestamp > now || now - timestamp > maxAgeMs) continue;
    if (!authentic('opening', fingerprint, e.id, opening, trust.openingKeys)) continue;
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!compatible(a) || !compatible(b)) continue;
    if (e.kind === 'connection' && (!liftTerminal(a) || !liftTerminal(b))) continue;
    const cost = distance(a.coordinates, b.coordinates);
    for (const direction of e.review.directions) {
      const start = direction === 'forward' ? e.from : e.to;
      const end = direction === 'forward' ? e.to : e.from;
      if (!graph.has(start)) graph.set(start, []);
      graph.get(start).push({ to: end, edgeId: e.id, distance: cost });
    }
  }
  const distances = new Map([[from, 0]]), previous = new Map(), pending = new Set([from]);
  while (pending.size) {
    const current = [...pending].reduce((a, b) => distances.get(a) <= distances.get(b) ? a : b);
    pending.delete(current);
    if (current === to) break;
    for (const edge of graph.get(current) || []) {
      const next = distances.get(current) + edge.distance;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next); previous.set(edge.to, { from: current, ...edge }); pending.add(edge.to);
      }
    }
  }
  if (!distances.has(to)) return { status: 'refused', reason: 'no_validated_open_route' };
  const steps = []; let current = to;
  while (current !== from) { const step = previous.get(current); steps.unshift(step); current = step.from; }
  return {
    status: 'found', distanceMetres: distances.get(to), steps,
    coordinates: [nodes.get(from).coordinates, ...steps.map(s => nodes.get(s.to).coordinates)].map(p => [...p]),
    availabilityCheckedAt: new Date(now).toISOString(),
    warning: 'Résultat technique sur validations fournies ; ne garantit pas la sécurité terrain. Aucun temps de parcours estimé.',
  };
}

function distance(a, b) {
  const rad = Math.PI / 180, dlat = (b[0] - a[0]) * rad, dlon = (b[1] - a[1]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
