/** Adaptateur de capteur : une seule position en RAM, sans stockage ni réseau. */
export function createGpsSession({ geo, tracker, onUpdate, setTimer = setInterval, clearTimer = clearInterval }) {
  let active = false, watch = null, timer = null, generation = 0, fix = null, error = null;
  function cleanup() {
    let ok = true;
    const oldWatch = watch, oldTimer = timer; watch = timer = null;
    // Même si un adaptateur échoue, annuler les autres ressources et invalider les callbacks.
    try { if (oldWatch !== null) geo?.clearWatch(oldWatch); } catch { ok = false; }
    try { if (oldTimer !== null) clearTimer(oldTimer); } catch { ok = false; }
    return ok;
  }
  function failure(notify = true) {
    active = false; generation++; fix = null; error = 'internal_error'; cleanup();
    try { tracker.reset(); } catch { /* arrêt du capteur déjà effectué */ }
    if (notify) {
      try { onUpdate({ active: false, fix: null, error, result: { state: 'gps_unavailable', reason: 'internal_error', match: null, routingAllowed: false, routeOrigin: null, terrainValidated: false } }); }
      catch { /* ne pas laisser une erreur d'affichage maintenir le capteur actif */ }
    }
  }
  function publish() {
    let result;
    try { result = tracker.status(); } catch { failure(); return; }
    if (result.state === 'gps_unavailable') fix = null;
    try { onUpdate({ active, result, fix: fix ? { ...fix } : null, error }); }
    catch { failure(); }
  }
  function stop(reason = null) {
    active = false; generation++;
    const cleaned = cleanup(); fix = null; error = reason;
    if (!cleaned) { failure(); return; }
    try { tracker.reset(); } catch { failure(); return; }
    publish();
  }
  function start() {
    if (active) return;
    if (!geo?.watchPosition || !geo?.clearWatch) { stop('unsupported'); return; }
    try { tracker.reset(); } catch { failure(); return; }
    fix = null; error = null; active = true;
    const current = ++generation;
    publish();
    if (!active || current !== generation) return;
    try {
      const id = geo.watchPosition(position => {
        if (!active || current !== generation) return;
        const c = position?.coords;
        const observation = { latitude: c?.latitude, longitude: c?.longitude, accuracy: c?.accuracy, timestamp: position?.timestamp };
        let result;
        try { result = tracker.update(observation); } catch { failure(); return; }
        fix = result.state === 'gps_unavailable' ? null : observation;
        error = null; publish();
      }, e => {
        if (!active || current !== generation) return;
        if (e?.code === 1) { stop('permission_denied'); return; }
        error = e?.code === 3 ? 'timeout' : 'sensor_unavailable';
        fix = null;
        try { tracker.unavailable(); } catch { failure(); return; }
        publish();
      }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
      if (active && current === generation) {
        watch = id; timer = setTimer(publish, 500);
      } else geo.clearWatch(id);
    } catch { stop('sensor_unavailable'); }
  }
  return Object.freeze({ start, stop });
}
