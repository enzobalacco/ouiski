import { GPS_POLICY } from './gps-tracker.mjs';

/** Bilan agrégé volatile. Ne reçoit ni coordonnées, ni noms de pistes, ni appareil. */
export function createTrialRecorder({ clock = Date.now } = {}) {
  let previousActive, previousFresh, freshSince, freshUntil, startedAt, lastTimestamp, runHadFix;
  let stats;
  function reset() {
    previousActive = previousFresh = runHadFix = false;
    freshSince = freshUntil = startedAt = lastTimestamp = null;
    stats = { starts: 0, observations: 0, firstFixDelayMs: null, longestFreshMs: 0, interruptions: 0,
      received: false, sustained: false, cleared: false, restarted: false, hiddenStop: false,
      lossCauses: { expired: 0, sensorTimeout: 0, sensorUnavailable: 0, rejected: 0, unknown: 0 } };
    return snapshot();
  }
  function snapshot() { return structuredClone(stats); }
  function record({ active, hasFreshFix, fixTimestamp, error = null, reason = null }) {
    const now = clock();
    if (!Number.isFinite(now)) throw new Error('Horloge d’essai invalide');
    if (active && !previousActive) {
      stats.starts++; startedAt = now; lastTimestamp = null; runHadFix = false;
      freshSince = freshUntil = null;
    }
    const fresh = active === true && hasFreshFix === true && Number.isFinite(fixTimestamp)
      && fixTimestamp <= now && now - fixTimestamp <= GPS_POLICY.maxObservationAgeMs;
    // Une nouvelle mesure après un trou peut arriver avant le timer d'expiration.
    const missedGap = previousFresh && fresh && freshUntil !== null && now > freshUntil;
    if (previousFresh && active && (!fresh || missedGap)) {
      stats.interruptions++;
      const cause = missedGap || reason === 'signal_timeout' ? 'expired'
        : error === 'timeout' ? 'sensorTimeout'
        : error === 'sensor_unavailable' ? 'sensorUnavailable'
        : ['stale_observation', 'future_observation', 'non_increasing_timestamp', 'invalid_observation', 'clock_regression'].includes(reason) ? 'rejected' : 'unknown';
      stats.lossCauses[cause]++;
    }
    if (fresh) {
      stats.received = runHadFix = true;
      if (lastTimestamp === null || fixTimestamp > lastTimestamp) { stats.observations++; lastTimestamp = fixTimestamp; }
      if (stats.firstFixDelayMs === null) stats.firstFixDelayMs = Math.max(0, now - startedAt);
      if (freshSince === null || now > freshUntil) freshSince = now;
      freshUntil = fixTimestamp + GPS_POLICY.maxObservationAgeMs;
      stats.longestFreshMs = Math.max(stats.longestFreshMs, now - freshSince);
      stats.sustained = stats.longestFreshMs >= 30_000;
      if (stats.cleared && stats.starts >= 2) stats.restarted = true;
    } else {
      freshSince = freshUntil = null;
    }
    if (previousActive && !active && runHadFix) {
      if (error === null) stats.cleared = true;
      if (error === 'hidden') stats.hiddenStop = true;
    }
    previousActive = active === true; previousFresh = fresh;
    return snapshot();
  }
  function report() {
    const flag = b => b ? 'Observé' : 'Non encore observé';
    return ['OuiSki — bilan fonctionnel du banc GPS (v2)',
      `Réception d’une mesure : ${flag(stats.received)}`,
      `30 secondes de signal récent sans interruption : ${flag(stats.sustained)}`,
      `Arrêt explicite après réception, affichage effacé : ${flag(stats.cleared)}`,
      `Nouvelle mesure après redémarrage : ${flag(stats.restarted)}`,
      `Arrêt après masquage de la page : ${flag(stats.hiddenStop)}`,
      `Démarrages : ${stats.starts}`,
      `Observations distinctes reçues : ${stats.observations}`,
      `Délai de première mesure : ${stats.firstFixDelayMs === null ? 'non mesuré' : Math.round(stats.firstFixDelayMs/1000)+' s'}`,
      `Plus longue continuité observée : ${Math.floor(stats.longestFreshMs/1000)} s`,
      `Interruptions observées pendant le suivi : ${stats.interruptions}`,
      `Dont expiration sans mesure récente : ${stats.lossCauses.expired}`,
      `Dont délai dépassé signalé par le capteur : ${stats.lossCauses.sensorTimeout}`,
      `Dont capteur indisponible : ${stats.lossCauses.sensorUnavailable}`,
      `Dont observation rejetée : ${stats.lossCauses.rejected}`,
      `Dont cause non déterminée : ${stats.lossCauses.unknown}`,
      'Bilan logiciel uniquement. Aucun guidage ni validation terrain.',
      'Aucune coordonnée, identité, date exacte ou piste dans ce bilan.'].join('\n');
  }
  reset();
  return Object.freeze({ record, snapshot, report, reset });
}
