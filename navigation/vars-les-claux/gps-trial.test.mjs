import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrialRecorder } from './gps-trial.mjs';
function setup() {
  let now = 0;
  const trial = createTrialRecorder({ clock: () => now });
  const event = (t, overrides = {}) => { now = t; return trial.record({ active: true, hasFreshFix: true, fixTimestamp: t, ...overrides }); };
  return { trial, event };
}
test('Essai : aucune validation automatique avant une observation', () => {
  const { trial } = setup();
  assert.equal(trial.snapshot().received, false); assert.equal(trial.snapshot().starts, 0);
  assert.match(trial.report(), /Non encore observé/);
});
test('Essai : trente secondes récentes, observations uniques et première mesure', () => {
  const { trial, event } = setup(); event(0, { hasFreshFix: false });
  for (let t = 1000; t <= 31_000; t += 5000) event(t);
  const s = trial.snapshot(); assert.equal(s.sustained, true); assert.equal(s.observations, 7);
  assert.equal(s.firstFixDelayMs, 1000); assert.equal(s.longestFreshMs, 30_000);
});
test('Essai : répéter une mesure ou reprendre après un trou ne crée pas trente secondes continues', () => {
  const { trial, event } = setup(); event(0);
  for (let t = 1000; t <= 9000; t += 1000) event(t, { fixTimestamp: 0 });
  assert.equal(trial.snapshot().observations, 1);
  event(40_000); assert.equal(trial.snapshot().sustained, false);
  event(50_001, { fixTimestamp: 40_000 }); assert.equal(trial.snapshot().interruptions, 1);
});
test('Essai : une interruption ne cumule pas les durées en une continuité fictive', () => {
  const { trial, event } = setup();
  for (let t = 0; t <= 20_000; t += 5000) event(t);
  event(21_000, { hasFreshFix: false });
  for (let t = 22_000; t <= 42_000; t += 5000) event(t);
  assert.equal(trial.snapshot().sustained, false); assert.equal(trial.snapshot().longestFreshMs, 20_000);
});
test('Essai : arrêt, redémarrage et masquage constatés sans garder les positions', () => {
  const { trial, event } = setup(); event(0); event(1000, { active: false, hasFreshFix: false });
  assert.equal(trial.snapshot().cleared, true);
  event(2000); assert.equal(trial.snapshot().restarted, true);
  event(3000, { active: false, hasFreshFix: false, error: 'hidden' }); assert.equal(trial.snapshot().hiddenStop, true);
  assert.equal(Object.keys(trial.snapshot()).some(k => /^(latitude|longitude|coordinates|timestamp)$/i.test(k)), false);
});
test('Essai : refus de permission ou remise à zéro ne compte pas comme arrêt testé', () => {
  const { trial, event } = setup(); event(0, { hasFreshFix: false });
  event(1000, { active: false, hasFreshFix: false, error: 'permission_denied' });
  assert.equal(trial.snapshot().cleared, false);
  event(2000); event(3000, { active: false, hasFreshFix: false, error: 'trial_reset' });
  assert.equal(trial.snapshot().cleared, false);
  trial.reset(); assert.equal(trial.snapshot().observations, 0); assert.equal(trial.snapshot().starts, 0);
});
test('Essai : copie agrégée sans localisation, identité, appareil ou date exacte', () => {
  const { trial, event } = setup(); event(0, { latitude: 44.571234, longitude: 6.681234, name: 'secret', device: 'secret-device' });
  const report = trial.report();
  for (const value of ['44.571234', '6.681234', 'secret', 'secret-device', '2026-']) assert.equal(report.includes(value), false);
  assert.match(report, /Aucun guidage ni validation terrain/);
  const s = trial.snapshot(); s.starts = 100; assert.equal(trial.snapshot().starts, 1);
});
