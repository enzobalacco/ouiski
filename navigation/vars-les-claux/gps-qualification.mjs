import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGpsTracker } from './gps-tracker.mjs';

/** Campagne déterministe : points source perturbés, jamais des mesures terrain. */
export function qualifyGps(network, source, withContext) {
  let now = Date.parse('2026-10-21T12:00:00Z');
  const tracker = createGpsTracker(network, { clock: () => now, contextWays: withContext ? source.ways : [] });
  const selected = new Set(network.ways.map(w => w.id));
  const totals = { scenarios: 0, correctConfirmations: 0, falseConfirmations: 0, ambiguous: 0,
    low_accuracy: 0, off_network: 0, gps_unavailable: 0, routingAuthorizations: 0 };
  const groups = { selected: { scenarios: 0, confirmed: 0, ambiguous: 0, low_accuracy: 0 },
    excluded: { scenarios: 0, confirmed: 0, ambiguous: 0, low_accuracy: 0 } };
  for (const w of source.ways) {
    const eligible = selected.has(w.id) && !w.tags.aerialway;
    if (selected.has(w.id) && !eligible) continue;
    const indices = eligible ? [...new Set([0, Math.floor(w.points.length/2), w.points.length-1])] : [Math.floor(w.points.length/2)];
    const accuracies = eligible ? [2, 5, 10, 25] : [2, 5];
    for (const index of indices) for (const accuracy of accuracies) {
      tracker.reset();
      let result;
      for (let i = 0; i < 3; i++) {
        now += 1000;
        const [lat, lon] = w.points[index];
        // Perturbation simulée au maximum accuracy/2, déterministe et annoncée.
        const offset = (i - 1) * accuracy/2;
        result = tracker.update({ latitude: lat + offset/111320, longitude: lon,
          accuracy, timestamp: now });
        if (result.routingAllowed) totals.routingAuthorizations++;
      }
      totals.scenarios++;
      const group = groups[eligible ? 'selected' : 'excluded']; group.scenarios++;
      if (result.state === 'position_confirmed') group.confirmed++;
      else if (Object.hasOwn(group, result.state)) group[result.state]++;
      if (result.state === 'position_confirmed') {
        if (eligible && result.match.sourceWayId === w.id) totals.correctConfirmations++;
        else totals.falseConfirmations++;
      } else totals[result.state]++;
    }
  }
  tracker.destroy();
  return { ...totals, groups };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await readFile(new URL('../../dist/ski-data.json', import.meta.url));
  const source = JSON.parse(bytes);
  const network = JSON.parse(await readFile(new URL('network.json', import.meta.url)));
  const baseline = qualifyGps(network, source, false);
  const guarded = qualifyGps(network, source, true);
  const rows = Object.keys(baseline).filter(k => k !== 'groups').map(k => `| ${k} | ${baseline[k]} | ${guarded[k]} |`).join('\n');
  const report = `# Qualification GPS simulée — Vars Les Claux\n\n` +
    `Source SHA-256 : \`${createHash('sha256').update(bytes).digest('hex')}\`.\n\n` +
    `Positions entièrement SIMULÉES à partir des géométries du fichier, avec perturbation déterministe. Aucune collecte GPS personnelle.\n\n` +
    `Trois observations sur deux secondes par scénario. Pistes candidates : première, médiane et dernière coordonnées, précisions 2/5/10/25 m. Autres tracés : coordonnée médiane, précisions 2/5 m. Les coordonnées sont seulement des références cartographiques, pas des vérités terrain.\n\n` +
    `| Résultat final du scénario | Réseau partiel seul | Avec contexte source complet |\n|---|---:|---:|\n${rows}\n\n` +
    `Avec contexte : ${guarded.groups.selected.scenarios} scénarios sur pistes candidates, dont ${guarded.groups.selected.confirmed} confirmations et ${guarded.groups.selected.ambiguous} ambiguïtés ; ${guarded.groups.selected.low_accuracy} signaux imprécis. Les ${guarded.groups.excluded.scenarios} scénarios sur tracés exclus ne doivent jamais être confirmés.\n\n` +
    `Une fausse confirmation désigne une piste différente du tracé ayant servi à simuler la position, ou une confirmation sur un tracé exclu du périmètre. Une ambiguïté est un refus prudent, pas une identification réussie. Les états sont comptés en fin de scénario ; cette campagne ne mesure pas le guidage ni les erreurs à chaque instant.\n\n` +
    `**Ces résultats ne constituent ni un taux de fiabilité terrain, ni une garantie à 95 %.** Le simulateur connaît les mêmes géométries que le moteur. Il ne reproduit pas les biais persistants, cartes erronées, neige ou relief. Il faut des essais indépendants sur téléphone, un inventaire validé et un flux d'ouverture fiable avant tout guidage.\n`;
  await writeFile(new URL('gps-qualification-report.md', import.meta.url), report);
  console.log(JSON.stringify({ baseline, guarded }, null, 2));
  if (guarded.falseConfirmations || guarded.routingAuthorizations) process.exitCode = 1;
}
