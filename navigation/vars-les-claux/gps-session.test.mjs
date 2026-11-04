import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpsSession } from './mobile-test/session.mjs';
function setup({ syncError = false, unsupported = false } = {}) {
  let success, error, tick, reset = 0, unavailable = 0;
  let state = { state: 'gps_unavailable', match: null };
  const cleared = [], timerCleared = [], updates = [];
  const geo = unsupported ? null : {
    watchPosition(ok, fail, options) { success = ok; error = fail; assert.equal(options.maximumAge, 0); if (syncError) fail({ code: 1 }); return 42; },
    clearWatch(id) { cleared.push(id); },
  };
  const tracker = {
    status: () => state,
    update(o) { state = { state: Number.isFinite(o.latitude) ? 'ambiguous' : 'gps_unavailable', match: null }; return state; },
    reset() { reset++; state = { state: 'gps_unavailable', match: null }; },
    unavailable() { unavailable++; state = { state: 'gps_unavailable', match: null }; },
  };
  const session = createGpsSession({ geo, tracker, onUpdate: s => updates.push(s),
    setTimer(fn) { tick = fn; return 7; }, clearTimer(id) { timerCleared.push(id); } });
  const fix = () => success({ coords: { latitude: 44.571, longitude: 6.68, accuracy: 5 }, timestamp: 123 });
  return { session, geo, tracker, cleared, timerCleared, updates, fix, fail: e => error(e), tick: () => tick(),
    expire: () => { state = { state: 'gps_unavailable', match: null }; }, counts: () => ({ reset, unavailable }) };
}
test('Session : aucune acquisition avant clic et un seul capteur lors de démarrages répétés', () => {
  const h = setup(); assert.equal(h.updates.length, 0); h.session.start(); h.session.start();
  h.fix(); assert.equal(h.updates.at(-1).active, true); h.session.stop(); assert.deepEqual(h.cleared, [42]);
});

test('Erreur du moteur dans un callback : arrêt, effacement et callbacks suivants ignorés', () => {
  const h = setup(); h.session.start(); h.fix();
  h.tracker.update = () => { throw new Error('erreur simulée'); };
  assert.doesNotThrow(() => h.fix());
  assert.deepEqual(h.cleared, [42]); assert.deepEqual(h.timerCleared, [7]);
  assert.equal(h.updates.at(-1).error, 'internal_error'); assert.equal(h.updates.at(-1).fix, null);
  const count = h.updates.length; h.fix(); assert.equal(h.updates.length, count);
});
test('Erreur du statut ou de la réinitialisation : aucun démarrage du capteur laissé actif', () => {
  const h = setup(); h.session.start();
  h.tracker.status = () => { throw new Error('horloge simulée'); };
  assert.doesNotThrow(() => h.tick());
  assert.equal(h.updates.at(-1).active, false); assert.deepEqual(h.cleared, [42]);
  const other = setup(); other.tracker.reset = () => { throw new Error('reset simulé'); };
  assert.doesNotThrow(() => other.session.start()); assert.equal(other.updates.at(-1).error, 'internal_error');
});
test('Erreur de nettoyage : le timer est quand même annulé et un échec interne est signalé', () => {
  const h = setup(); h.session.start(); h.fix();
  h.geo.clearWatch = () => { throw new Error('adaptateur défaillant'); };
  assert.doesNotThrow(() => h.session.stop());
  assert.deepEqual(h.timerCleared, [7]); assert.equal(h.updates.at(-1).error, 'internal_error');
  assert.equal(h.updates.at(-1).fix, null);
});
test('Erreur dans l’affichage : aucun suivi ne reste actif en silence', () => {
  let started = 0;
  const session = createGpsSession({ geo: { watchPosition: () => ++started, clearWatch() {} },
    tracker: { reset() {}, status: () => ({ state: 'gps_unavailable' }) }, onUpdate() { throw new Error('affichage indisponible'); } });
  assert.doesNotThrow(() => session.start()); assert.equal(started, 0);
});
test('Arrêt : effacement, timer et capteur annulés ; callback tardif ignoré', () => {
  const h = setup(); h.session.start(); h.fix(); assert.ok(h.updates.at(-1).fix);
  h.session.stop(); assert.equal(h.updates.at(-1).fix, null); assert.deepEqual(h.timerCleared, [7]);
  const count = h.updates.length; h.fix(); assert.equal(h.updates.length, count);
});
test('Refus de permission asynchrone et synchrone ne laisse aucun capteur actif', () => {
  const h = setup(); h.session.start(); h.fail({ code: 1 });
  assert.equal(h.updates.at(-1).active, false); assert.equal(h.updates.at(-1).error, 'permission_denied');
  const sync = setup({ syncError: true }); sync.session.start(); assert.deepEqual(sync.cleared, [42]);
});
test('Interruption de signal et délai : position retirée mais réacquisition possible', () => {
  const h = setup(); h.session.start(); h.fix(); h.fail({ code: 3 });
  assert.equal(h.updates.at(-1).fix, null); assert.equal(h.updates.at(-1).active, true);
  h.fix(); assert.ok(h.updates.at(-1).fix); assert.equal(h.updates.at(-1).error, null);
});
test('Timer retire le point dès que le tracker le considère périmé', () => {
  const h = setup(); h.session.start(); h.fix(); h.expire(); h.tick(); assert.equal(h.updates.at(-1).fix, null);
});
test('Navigateur sans géolocalisation : état explicite, aucune exception', () => {
  const h = setup({ unsupported: true }); h.session.start(); assert.equal(h.updates.at(-1).error, 'unsupported');
});
