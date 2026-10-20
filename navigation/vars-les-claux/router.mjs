const ranks = { novice: 0, easy: 1, intermediate: 2, advanced: 3, expert: 3 };
const levels = { vertes: 0, bleues: 1, rouges: 2, noires: 3 };
const nonempty = s => typeof s === 'string' && s.trim().length > 0;

function confirmed(review) {
  return review?.validation === 'confirmed' && review.authorization === 'allowed'
    && nonempty(review.evidence?.reference) && nonempty(review.evidence?.validatedBy)
    && Number.isFinite(Date.parse(review.evidence?.validatedAt));
}

/** Pas de recherche par proximité, de projection GPS ni de fusion de nœuds OSM. */
export function findRoute(network, {
  from, to, level = 'bleues', availability = {}, now = Date.now(), maxAgeMs = 15 * 60_000,
}) {
  if (!Object.hasOwn(levels, level)) throw new Error('Niveau invalide');
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('Horloge ou fraîcheur invalide');
  if (network.schemaVersion !== 1) throw new Error('Version de réseau invalide');
  const nodes = new Map(), ways = new Map(network.ways.map(w => [w.id, w]));
  if (ways.size !== network.ways.length) throw new Error('Identifiants de tracé dupliqués');
  for (const n of network.nodes) {
    const way = ways.get(n.sourceWayId);
    if (!nonempty(n.id) || nodes.has(n.id) || !way || !Number.isInteger(n.sourceIndex)
      || n.sourceIndex < 0 || way.nodes[n.sourceIndex] !== n.sourceNodeId
      || !Array.isArray(n.coordinates) || n.coordinates.length !== 2 || !n.coordinates.every(Number.isFinite)
      || Math.abs(n.coordinates[0]) > 90 || Math.abs(n.coordinates[1]) > 180
      || JSON.stringify(n.coordinates) !== JSON.stringify(way.points[n.sourceIndex])) {
      throw new Error('Nœud de réseau invalide');
    }
    nodes.set(n.id, n);
  }
  if (!nodes.has(from) || !nodes.has(to)) throw new Error('Départ ou arrivée absent du réseau');
  // Un point seul ne constitue pas un itinéraire validé.
  if (from === to) return { status: 'refused', reason: 'identical_endpoints' };
  const graph = new Map(), seen = new Set();
  for (const e of network.edges) {
    if (!nonempty(e.id) || seen.has(e.id) || !nodes.has(e.from) || !nodes.has(e.to)
      || !['piste', 'lift', 'connection'].includes(e.kind)) throw new Error('Arête de réseau invalide');
    seen.add(e.id);
    if (!confirmed(e.review)) continue;
    if (Date.parse(e.review.evidence.validatedAt) > now) continue;
    if (!Array.isArray(e.review.directions) || !e.review.directions.length
      || e.review.directions.some(d => !['forward', 'reverse'].includes(d))) continue;
    const opening = Object.hasOwn(availability, e.id) ? availability[e.id] : null;
    const timestamp = Date.parse(opening?.observedAt);
    if (opening?.state !== 'open' || !nonempty(opening.source) || !Number.isFinite(timestamp)
      || timestamp > now || now - timestamp > maxAgeMs) continue;
    if (e.kind === 'piste' && (!Object.hasOwn(ranks, e.difficulty) || ranks[e.difficulty] > levels[level])) continue;
    // Une connexion doit rester attachée au même nœud cartographique explicite.
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (e.kind === 'connection' && (a.sourceNodeId !== b.sourceNodeId
      || e.sourceNodeId !== a.sourceNodeId || JSON.stringify(a.coordinates) !== JSON.stringify(b.coordinates))) {
      throw new Error('Connexion sans nœud source commun');
    }
    if (e.kind !== 'connection') {
      const way = ways.get(e.sourceWayId);
      if (!way || a.sourceWayId !== e.sourceWayId || b.sourceWayId !== e.sourceWayId
        || b.sourceIndex !== a.sourceIndex + 1
        || e.kind !== (way.tags.aerialway ? 'lift' : 'piste')
        || (e.kind === 'piste' && e.difficulty !== way.tags['piste:difficulty'])) {
        throw new Error('Arête hors du tracé source');
      }
    }
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
    coordinates: [nodes.get(from).coordinates, ...steps.map(s => nodes.get(s.to).coordinates)],
    availabilityCheckedAt: new Date(now).toISOString(),
    warning: 'Résultat technique sur validations fournies ; ne garantit pas la sécurité terrain. Aucun temps de parcours estimé.',
  };
}

function distance(a, b) {
  const rad = Math.PI / 180, dlat = (b[0] - a[0]) * rad, dlon = (b[1] - a[1]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
