import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../../dist/ski-data.json', import.meta.url);
// Inventaire candidat, pas un domaine officiel ni une liste de pistes ouvertes.
export const selectedWayIds = [
  '21103728', '21103735', '21482324', '22935308', '22935313',
  '29121177', '30099870', '30099882', '48922502', '48922503',
  '48922505', '1021425078', '1021425079', '1021425080', '1025189101',
  '1195999849', '1195999850', '1195999851', '1310868751', '1483951841',
  '1483951842', '1483951843', '1483951844', '1483951845', '1483951846',
  '1483951847', '1483951848', '1483951849', '1492819838',
];
const unreviewed = () => ({
  validation: 'to_verify', authorization: 'unknown', directions: [], evidence: null,
});

export function buildNetwork(bytes) {
  const source = JSON.parse(bytes);
  const byId = new Map(source.ways.map(w => [w.id, w]));
  const ways = selectedWayIds.map(id => {
    const way = byId.get(id);
    if (!way) throw new Error(`Tracé source absent : ${id}`);
    if (!way.tags.aerialway && !['novice', 'easy'].includes(way.tags['piste:difficulty'])) {
      throw new Error(`Difficulté hors inventaire : ${id}`);
    }
    if (way.nodes.length !== way.points.length || way.nodes.length < 2) {
      throw new Error(`Géométrie invalide : ${id}`);
    }
    return structuredClone(way);
  });
  const nodes = [], edges = [], occurrences = new Map();
  for (const way of ways) {
    for (let i = 0; i < way.nodes.length; i++) {
      const node = {
        id: `${way.id}:${i}`, sourceWayId: way.id, sourceNodeId: way.nodes[i],
        sourceIndex: i, coordinates: way.points[i],
      };
      if (!node.coordinates.every(Number.isFinite) || node.coordinates.length !== 2) {
        throw new Error(`Coordonnées invalides : ${node.id}`);
      }
      nodes.push(node);
      if (!occurrences.has(node.sourceNodeId)) occurrences.set(node.sourceNodeId, []);
      const shared = occurrences.get(node.sourceNodeId);
      if (shared.some(n => JSON.stringify(n.coordinates) !== JSON.stringify(node.coordinates))) {
        throw new Error(`Coordonnées contradictoires : ${node.sourceNodeId}`);
      }
      shared.push(node);
      if (i) edges.push({
        id: `way/${way.id}/${i - 1}`, from: `${way.id}:${i - 1}`, to: node.id,
        kind: way.tags.aerialway ? 'lift' : 'piste', sourceWayId: way.id,
        difficulty: way.tags.aerialway ? null : way.tags['piste:difficulty'],
        review: unreviewed(),
      });
    }
  }
  // Seuls les identifiants OSM identiques produisent des CANDIDATS de liaison.
  // Chaque occurrence reste distincte : aucune jonction implicite dans le moteur.
  for (const [sourceNodeId, shared] of occurrences) {
    for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
      const a = shared[i], b = shared[j];
      if (a.sourceWayId === b.sourceWayId) continue;
      edges.push({
        id: `junction/${sourceNodeId}/${a.id}/${b.id}`, from: a.id, to: b.id,
        kind: 'connection', sourceNodeId, topology: 'shared_source_node',
        review: unreviewed(),
      });
    }
  }
  const terminals = ways.flatMap(w => [0, w.nodes.length - 1].map(i => ({
    nodeId: `${w.id}:${i}`, sourceWayId: w.id, sourceNodeId: w.nodes[i],
    coordinates: w.points[i], sourceEndpoint: i === 0 ? 'first' : 'last',
    possibleRoles: w.tags.aerialway ? ['boarding', 'alighting'] : ['departure', 'arrival'],
    confirmedRole: null, validation: 'to_verify',
  })));
  return {
    schemaVersion: 1, id: 'vars-les-claux-beginners-candidate-v1',
    source: {
      path: 'dist/ski-data.json', sha256: createHash('sha256').update(bytes).digest('hex'),
      retrieved: source.retrieved, scope: source.scope,
    },
    selection: {
      status: 'candidate_inventory_not_official_boundary', wayIds: selectedWayIds,
      rationale: 'Front des Claux : Centre, Claux, Écrins, Zakopane et pistes/lifts associés au secteur. Tracés entiers conservés, extensions à vérifier ; ni proximité ni nom ne valent autorisation.',
    },
    ways, nodes, terminals, edges,
    opening: { state: 'unknown', explanation: 'Aucune information d’ouverture actuelle fournie.' },
  };
}

export function fieldReport(n) {
  const lines = [
    '# Inventaire terrain — Vars Les Claux', '',
    'Document généré depuis les données originales. Aucun élément ci-dessous n’est validé pour le guidage ou déclaré ouvert.', '',
    `Source : \`${n.source.path}\`, relevé ${n.source.retrieved}, SHA-256 \`${n.source.sha256}\`.`, '',
    '## Pistes et remontées candidates', '',
    'Les identifiants de nœuds et les coordonnées [latitude, longitude] sont copiés sans modification. Premier/dernier signifie ordre du fichier, jamais bas/haut. Les longues pistes et remontées débordent du front : périmètre à confirmer.', '',
    '| ID OSM | Nom | Type | Premier nœud et coordonnées | Dernier nœud et coordonnées |',
    '|---|---|---|---|---|',
  ];
  for (const w of n.ways) lines.push(`| ${w.id} | ${w.tags.name || 'Sans nom'} | ${w.tags.aerialway || ({novice:'verte',easy:'bleue'}[w.tags['piste:difficulty']])} | ${w.nodes[0]} : ${JSON.stringify(w.points[0])} | ${w.nodes.at(-1)} : ${JSON.stringify(w.points.at(-1))} |`);
  lines.push('', 'Pour CHAQUE tracé : vérifier identité, difficulté, limites du secteur, sens autorisé, début/fin utilisables, accès et ouverture. Pour CHAQUE remontée : confirmer embarquement/débarquement, accès intermédiaires interdits, sens, restrictions débutants et horaires. Les tags OSM et horaires historiques sont conservés mais ne constituent pas une validation.', '',
    '## Connexions cartographiques à vérifier', '',
    'Un nœud OSM commun confirme uniquement une identité cartographique. Chaque paire ci-dessous reste non autorisée. Confirmer passage physique, sens, accès, éventuel croisement sans passage et restrictions ; consigner le refus si interdit.', '',
    '| ID connexion | Nœud OSM | Occurrences reliées candidates | État |', '|---|---|---|---|');
  for (const e of n.edges.filter(e => e.kind === 'connection')) lines.push(`| ${e.id} | ${e.sourceNodeId} | ${e.from} ↔ ${e.to} | À vérifier, autorisation inconnue |`);
  lines.push('', '## Bilan', '',
    `- ${n.ways.filter(w=>!w.tags.aerialway).length} tronçons verts/bleus, ${n.ways.filter(w=>w.tags.aerialway).length} remontées, ${n.terminals.length} extrémités candidates.`,
    `- ${n.edges.filter(e=>e.kind==='connection').length} paires de connexion cartographique ; 0 connexion autorisée ou validée terrain.`,
    '- Aucun point officiel de rassemblement/front de neige identifié comme tel dans la source.',
    '- Les rôles départ/arrivée et embarquement/débarquement restent indéterminés, même avec un tag oneway.',
    '- Aucune interdiction terrain confirmée dans cette source. Inconnu ne signifie pas autorisé.',
    '- Toute liaison absente, entre nœuds distincts ou fondée sur la seule proximité est non routable. Ne pas inventer de géométrie pour combler un manque.',
    '- Après validation : preuve, validateur, date, sens, autorisation et information d’ouverture fraîche sont nécessaires. Ne pas modifier ce rapport pour simuler une validation.', '');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const network = buildNetwork(await readFile(sourceUrl));
  await writeFile(new URL('network.json', import.meta.url), JSON.stringify(network, null, 2) + '\n');
  await writeFile(new URL('terrain-report.md', import.meta.url), fieldReport(network));
  console.log(`${network.ways.length} tracés candidats ; ${network.edges.length} arêtes non autorisées.`);
}
