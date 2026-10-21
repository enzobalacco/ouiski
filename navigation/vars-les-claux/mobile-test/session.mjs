/** Adaptateur de capteur : une seule position en RAM, sans stockage ni réseau. */
export function createGpsSession({ geo, tracker, onUpdate, setTimer = setInterval, clearTimer = clearInterval }) {
  let active = false, watch = null, timer = null, generation = 0, fix = null, error = null;
  function publish() {
    const result = tracker.status();
    if (result.state === 'gps_unavailable') fix = null;
    onUpdate({ active, result, fix: fix ? { ...fix } : null, error });
  }
  function stop(reason = null) {
    active = false; generation++;
    if (watch !== null) geo?.clearWatch(watch);
    if (timer !== null) clearTimer(timer);
    watch = timer = null; fix = null; error = reason; tracker.reset(); publish();
  }
  function start() {
    if (active) return;
    if (!geo?.watchPosition || !geo?.clearWatch) { stop('unsupported'); return; }
    tracker.reset(); fix = null; error = null; active = true;
    const current = ++generation;
    publish();
    try {
      const id = geo.watchPosition(position => {
        if (!active || current !== generation) return;
        const c = position?.coords;
        const observation = { latitude: c?.latitude, longitude: c?.longitude, accuracy: c?.accuracy, timestamp: position?.timestamp };
        const result = tracker.update(observation);
        fix = result.state === 'gps_unavailable' ? null : observation;
        error = null; publish();
      }, e => {
        if (!active || current !== generation) return;
        if (e?.code === 1) { stop('permission_denied'); return; }
        error = e?.code === 3 ? 'timeout' : 'sensor_unavailable';
        fix = null; tracker.unavailable(); publish();
      }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
      if (active && current === generation) {
        watch = id; timer = setTimer(publish, 500);
      } else geo.clearWatch(id);
    } catch { stop('sensor_unavailable'); }
  }
  return Object.freeze({ start, stop });
}
