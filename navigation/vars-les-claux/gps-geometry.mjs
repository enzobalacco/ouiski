const R = 6371000;
const rad = Math.PI / 180;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = v => Math.hypot(...v);
const angle = (a, b) => Math.atan2(norm(cross(a, b)), Math.max(-1, Math.min(1, dot(a, b))));
const unit = p => [Math.cos(p[0]*rad)*Math.cos(p[1]*rad), Math.cos(p[0]*rad)*Math.sin(p[1]*rad), Math.sin(p[0]*rad)];

function check(p) {
  if (!Array.isArray(p) || p.length !== 2 || !Array.from(p).every(Number.isFinite)
    || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) throw new Error('Coordonnées GPS invalides');
}

export function distanceMetres(a, b) {
  check(a); check(b);
  return R * angle(unit(a), unit(b));
}

/** Projection sur l'arc géodésique court, borné par les deux points source.
 * Le point calculé n'est ni une observation GPS ni un nouveau nœud du réseau.
 */
export function distanceToSegment(point, start, end) {
  check(point); check(start); check(end);
  const p = unit(point), a = unit(start), b = unit(end), length = angle(a, b);
  if (Math.PI - length < 1e-9) throw new Error('Segment antipodal indéterminé');
  const da = angle(p, a), db = angle(p, b);
  const endpoint = da <= db
    ? { distanceMetres: R*da, fraction: 0, coordinates: [...start] }
    : { distanceMetres: R*db, fraction: 1, coordinates: [...end] };
  if (length < 1e-12) return endpoint;
  const normal = cross(a, b), size = norm(normal), n = normal.map(v => v/size);
  const projection = p.map((v, i) => v - dot(p, n)*n[i]), projectedSize = norm(projection);
  if (projectedSize < 1e-12) return endpoint;
  const q = projection.map(v => v/projectedSize);
  const along = angle(a, q);
  if (along + angle(q, b) > length + 1e-10) return endpoint;
  const distance = R * angle(p, q);
  if (distance >= endpoint.distanceMetres) return endpoint;
  return {
    distanceMetres: distance, fraction: Math.max(0, Math.min(1, along/length)),
    coordinates: [Math.atan2(q[2], Math.hypot(q[0], q[1]))/rad, Math.atan2(q[1], q[0])/rad],
  };
}
