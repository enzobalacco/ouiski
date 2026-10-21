import { createGpsTracker } from '/modules/gps-tracker.mjs';
import { createGpsSession } from '/session.mjs';
const el = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let session = null, radius = 700;
const titles = { position_confirmed: 'Piste estimée — à vérifier', ambiguous: 'Position ambiguë', low_accuracy: 'Signal GPS insuffisant', off_network: 'Hors du réseau candidat', gps_unavailable: 'GPS indisponible' };
const descriptions = {
  consistent_unique_geometric_match: 'Plusieurs mesures concordent. Cela ne valide pas un trajet ni l’ouverture de la piste.',
  multiple_plausible_traces: 'Plusieurs pistes ou remontées sont proches : aucune piste n’est choisie.',
  awaiting_consistent_observations: 'Attente de plusieurs mesures récentes et cohérentes.',
  outside_selected_network: 'Ce tracé ne fait pas partie du réseau débutant testé.',
  signal_timeout: 'Le signal est trop ancien. L’ancienne position a été effacée.',
  horizontal_accuracy_insufficient: 'La précision annoncée ne permet pas d’identifier une piste.',
  implausible_motion: 'Le déplacement apparent est incohérent. Attente de nouvelles mesures.',
};
const errors = { permission_denied: 'Localisation refusée. Vous pouvez la modifier dans les réglages du navigateur.', unsupported: 'Ce navigateur ne fournit pas de géolocalisation.', timeout: 'Le GPS ne répond pas. Attendez dehors avec une vue dégagée.', sensor_unavailable: 'La localisation est indisponible.', hidden: 'Suivi arrêté car la page a été masquée.', insecure: 'Le GPS nécessite HTTPS ou une ouverture locale sur cet appareil.' };
function view() { el('map').setAttribute('viewBox', `${-radius} ${-radius*0.72} ${radius*2} ${radius*1.44}`); }
el('zoom-in').onclick = () => { radius = Math.max(150, radius/1.5); view(); };
el('zoom-out').onclick = () => { radius = Math.min(6000, radius*1.5); view(); };
el('center').onclick = () => { radius = 700; view(); };

try {
  // Ces deux requêtes statiques précèdent le capteur. Jamais de coordonnées en URL.
  const responses = await Promise.all([fetch('/network.json', { cache: 'no-store' }), fetch('/source.json', { cache: 'no-store' })]);
  if (responses.some(r => !r.ok)) throw new Error('Données indisponibles');
  const [network, source] = await Promise.all(responses.map(r => r.json()));
  const tracker = createGpsTracker(network, { contextWays: source.ways });
  const anchor = network.ways.find(w => w.id === '1021425079').points[0];
  const project = p => [(p[1]-anchor[1])*111320*Math.cos(anchor[0]*Math.PI/180), -(p[0]-anchor[0])*111320];
  const selected = new Set(network.ways.map(w => w.id));
  for (const w of source.ways) {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', w.points.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' '));
    path.setAttribute('class', w.tags.aerialway ? 'lift' : selected.has(w.id) ? w.tags['piste:difficulty'] === 'novice' ? 'green' : 'blue' : 'context');
    const title = document.createElementNS(svgNS, 'title'); title.textContent = `${w.tags.name || 'Tronçon sans nom'} — ouverture inconnue`;
    path.append(title); el('traces').append(path);
  }
  session = createGpsSession({ geo: navigator.geolocation, tracker, onUpdate: ({ active, result, fix, error }) => {
    el('start').disabled = active; el('stop').disabled = !active;
    el('state').textContent = active ? titles[result.state] : 'GPS arrêté';
    el('explanation').textContent = errors[error] || (active ? descriptions[result.reason] || 'La piste reste incertaine. Aucun guidage n’est proposé.' : 'Cliquez sur Démarrer pour demander la localisation.');
    el('accuracy').textContent = fix ? `± ${Math.round(fix.accuracy)} m (estimation)` : '—';
    el('coordinates').textContent = fix ? `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}` : '—';
    el('track').textContent = result.match ? result.match.name || `Tronçon ${result.match.sourceWayId}` : 'Non déterminée';
    el('dot').toggleAttribute('hidden', !fix); el('uncertainty').toggleAttribute('hidden', !fix);
    if (fix) {
      const [x, y] = project([fix.latitude, fix.longitude]);
      el('dot').setAttribute('cx', x); el('dot').setAttribute('cy', y);
      el('uncertainty').setAttribute('cx', x); el('uncertainty').setAttribute('cy', y);
      el('uncertainty').setAttribute('r', fix.accuracy);
    }
  } });
  el('start').onclick = () => {
    if (!window.isSecureContext) { session.stop('insecure'); return; }
    session.start();
  };
  el('stop').onclick = () => session.stop();
  document.addEventListener('visibilitychange', () => { if (document.hidden) session.stop('hidden'); });
  window.addEventListener('pagehide', () => session.stop('hidden'));
  el('loading').textContent = 'Carte prête. Aucun suivi actif.';
  el('start').disabled = false; view();
} catch {
  el('loading').textContent = 'Impossible de préparer la carte. Aucun suivi GPS démarré.';
  el('start').disabled = true;
}
