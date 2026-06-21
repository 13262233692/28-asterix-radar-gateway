'use strict';

const STCAEngine = require('../packages/backend/src/stcaEngine');

const NM_TO_M = 1852.0;
const FT_PER_FL = 100.0;

function makeTrack(key, lat, lon, fl, gs, hdg, cs) {
  return {
    key,
    latitude: lat,
    longitude: lon,
    flightLevel: fl,
    groundSpeed: gs,
    trackAngle: hdg,
    callsign: cs || key,
    hasPosition: true,
    hasAltitude: true,
    hasModeS: true,
    modeSAddress: 0x100000,
    trackNumber: 1
  };
}

function testHeadOnConflict() {
  console.log('\n=== TEST 1: Head-On Conflict (2 aircraft approaching) ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  const tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.40, 350, 480, 90, 'CCA123'));
  tracks.set('A2', makeTrack('A2', 39.86, 116.54, 350, 480, 270, 'CES456'));

  const conflicts = engine.run(tracks);
  const pass = conflicts.length > 0;
  if (pass) {
    const c = conflicts[0];
    console.log(`  Found: ${c.callsign1} ↔ ${c.callsign2}  H=${c.horizSepNm}NM  V=${c.vertSepFt}ft  CPA=${c.timeToCPA}s  Severity=${c.severity.toFixed(2)}`);
  } else {
    console.log('  ❌ No conflict detected — expected head-on pair');
  }
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  engine.reset();
  return pass;
}

function testSameTrackNoConflict() {
  console.log('\n=== TEST 2: Same Track (trailing, safe separation) ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  const tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.40, 350, 480, 90, 'CCA123'));
  tracks.set('A2', makeTrack('A2', 39.86, 116.20, 350, 480, 90, 'CES456'));

  const conflicts = engine.run(tracks);
  const pass = conflicts.length === 0;
  console.log(`  Conflicts found: ${conflicts.length}  ${pass ? '✅ PASS (no false alarm)' : '❌ FAIL (false alarm)'}`);
  engine.reset();
  return pass;
}

function testVerticalSeparation() {
  console.log('\n=== TEST 3: Vertical Separation (same position, 2000ft apart) ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  const tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.47, 350, 480, 90, 'CCA123'));
  tracks.set('A2', makeTrack('A2', 39.86, 116.47, 370, 480, 270, 'CES456'));

  const conflicts = engine.run(tracks);
  const pass = conflicts.length === 0;
  console.log(`  Conflicts found: ${conflicts.length}  ${pass ? '✅ PASS (vertically separated)' : '❌ FAIL'}`);
  engine.reset();
  return pass;
}

function testCrossingConflict() {
  console.log('\n=== TEST 4: Crossing Conflict (perpendicular courses, same FL) ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  const tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.44, 310, 420, 90, 'CSN789'));
  tracks.set('A2', makeTrack('A2', 39.88, 116.47, 310, 420, 180, 'CHH321'));

  const conflicts = engine.run(tracks);
  const pass = conflicts.length > 0;
  if (pass) {
    const c = conflicts[0];
    console.log(`  Found: ${c.callsign1} ↔ ${c.callsign2}  H=${c.horizSepNm}NM  V=${c.vertSepFt}ft  CPA=${c.timeToCPA}s`);
  }
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  engine.reset();
  return pass;
}

function testConflictResolution() {
  console.log('\n=== TEST 5: Conflict Appears Then Resolves ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  let tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.44, 350, 480, 90, 'CCA123'));
  tracks.set('A2', makeTrack('A2', 39.86, 116.50, 350, 480, 270, 'CES456'));
  let conflicts = engine.run(tracks);
  const hadConflict = conflicts.length > 0;
  console.log(`  Cycle 1: conflicts=${conflicts.length} ${hadConflict ? '✅' : '❌'}`);

  tracks = new Map();
  tracks.set('A1', makeTrack('A1', 39.86, 116.44, 350, 480, 90, 'CCA123'));
  tracks.set('A2', makeTrack('A2', 39.86, 116.50, 250, 480, 270, 'CES456'));
  conflicts = engine.run(tracks);
  const resolved = conflicts.length === 0;
  console.log(`  Cycle 2 (A2→FL250): conflicts=${conflicts.length} ${resolved ? '✅' : '❌'}`);

  const pass = hadConflict && resolved;
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  engine.reset();
  return pass;
}

function testPerformance1200() {
  console.log('\n=== TEST 6: STCA Performance (1200 targets) ===');
  const engine = new STCAEngine({ horizSepM: 5 * NM_TO_M, vertSepFt: 1000, predictionHorizonS: 120, predictionStepS: 10 });

  const tracks = new Map();
  for (let i = 0; i < 1200; i++) {
    const lat = 39.86 + (Math.random() - 0.5) * 4;
    const lon = 116.47 + (Math.random() - 0.5) * 6;
    const fl = 100 + Math.floor(Math.random() * 300);
    const hdg = Math.random() * 360;
    const gs = 250 + Math.random() * 300;
    tracks.set('T' + i, makeTrack('T' + i, lat, lon, fl, gs, hdg));
  }

  const t0 = Date.now();
  engine.run(tracks);
  const elapsed = Date.now() - t0;

  const pass = elapsed < 200;
  console.log(`  1200 targets: ${elapsed}ms/cycle  ${pass ? '✅ PASS (<200ms)' : '⚠️ SLOW (>200ms)'}`);
  console.log(`  Pairs checked: ${engine.stats.pairsChecked}  Conflicts: ${engine.stats.conflictsFound}`);
  engine.reset();
  return pass;
}

function main() {
  console.log('==================================================================');
  console.log('  STCA ENGINE — REGRESSION TEST SUITE');
  console.log('  Separation: 5NM horizontal / 1000ft vertical / 120s prediction');
  console.log('==================================================================');

  const r1 = testHeadOnConflict();
  const r2 = testSameTrackNoConflict();
  const r3 = testVerticalSeparation();
  const r4 = testCrossingConflict();
  const r5 = testConflictResolution();
  const r6 = testPerformance1200();

  console.log('\n==================================================================');
  console.log(`  [${r1 ? '✅' : '❌'}] T1 Head-on conflict detection`);
  console.log(`  [${r2 ? '✅' : '❌'}] T2 Same-track no false alarm`);
  console.log(`  [${r3 ? '✅' : '❌'}] T3 Vertical separation safe`);
  console.log(`  [${r4 ? '✅' : '❌'}] T4 Crossing conflict detection`);
  console.log(`  [${r5 ? '✅' : '❌'}] T5 Conflict appears then resolves`);
  console.log(`  [${r6 ? '✅' : '⚠️ '}] T6 1200-target performance`);
  console.log('------------------------------------------------------------------');
  const allCore = r1 && r2 && r3 && r4 && r5;
  console.log(`  Core STCA logic: ${allCore ? '✅ ALL PASS' : '❌ SOME FAILED'}`);
  console.log('==================================================================');

  process.exit(allCore ? 0 : 1);
}

main();
