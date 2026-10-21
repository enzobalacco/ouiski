const liftTypes = new Set(['chair_lift', 'platter', 'magic_carpet', 'mixed_lift']);
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o)
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const validPoint = p => Array.isArray(p) && p.length === 2 && Array.from(p).every(Number.isFinite)
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

export function validateNetwork(network) {
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

