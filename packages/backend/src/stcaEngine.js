'use strict';

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const EARTH_R = 6371000.0;
const NM_TO_M = 1852.0;
const FT_PER_FL = 100.0;

const HORIZ_SEP_M = 5 * NM_TO_M;
const VERT_SEP_FT = 1000;
const PREDICTION_HORIZON_S = 120;
const PREDICTION_STEP_S = 10;
const ALT_BAND_FT = VERT_SEP_FT * 2;

class ConflictPairPool {
  constructor(size = 512) {
    this.pool = [];
    for (let i = 0; i < size; i++) {
      this.pool.push({
        key1: null, key2: null,
        lat1: 0, lon1: 0, fl1: 0,
        lat2: 0, lon2: 0, fl2: 0,
        horizSepM: 0, vertSepFt: 0,
        timeToCPA: 0, severity: 0,
        callsign1: '', callsign2: ''
      });
    }
  }
  acquire() {
    if (this.pool.length > 0) return this.pool.pop();
    return {
      key1: null, key2: null,
      lat1: 0, lon1: 0, fl1: 0,
      lat2: 0, lon2: 0, fl2: 0,
      horizSepM: 0, vertSepFt: 0,
      timeToCPA: 0, severity: 0,
      callsign1: '', callsign2: ''
    };
  }
  release(obj) {
    if (!obj) return;
    if (this.pool.length < 2048) {
      obj.key1 = null; obj.key2 = null;
      this.pool.push(obj);
    }
  }
  releaseBatch(arr) {
    for (let i = 0; i < arr.length; i++) this.release(arr[i]);
  }
}

class SpatialHashGrid {
  constructor(cellSizeM) {
    this.cellSize = cellSizeM;
    this.cells = new Map();
  }

  _key(cx, cy, cz) {
    return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
  }

  _toCell(lat, lon, fl) {
    const x = lon * Math.cos(lat * DEG2RAD) * 111320;
    const y = lat * 110540;
    const z = fl * FT_PER_FL;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / (ALT_BAND_FT));
    return { cx, cy, cz };
  }

  clear() {
    for (const [, arr] of this.cells) arr.length = 0;
    this.cells.clear();
  }

  insert(track) {
    const c = this._toCell(track.latitude, track.longitude, track.flightLevel || 0);
    const k = this._key(c.cx, c.cy, c.cz);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(track);
  }

  getNeighborPairs() {
    const pairs = [];
    const visited = new Set();
    for (const [k, bucket] of this.cells) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          pairs.push([bucket[i], bucket[j]]);
        }
      }
      for (const [k2, bucket2] of this.cells) {
        if (k2 <= k) continue;
        const pairKey = k < k2 ? k * 1000003 + k2 : k2 * 1000003 + k;
        if (visited.has(pairKey)) continue;
        visited.add(pairKey);
        for (let i = 0; i < bucket.length; i++) {
          for (let j = 0; j < bucket2.length; j++) {
            pairs.push([bucket[i], bucket2[j]]);
          }
        }
      }
    }
    return pairs;
  }
}

function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectPosition(lat, lon, hdgDeg, distM) {
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;
  const brng = hdgDeg * DEG2RAD;
  const d = distM / EARTH_R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
                          Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
                                  Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * RAD2DEG, lon: lon2 * RAD2DEG };
}

class STCAEngine {
  constructor(options = {}) {
    this.horizSepM = options.horizSepM || HORIZ_SEP_M;
    this.vertSepFt = options.vertSepFt || VERT_SEP_FT;
    this.predictionHorizonS = options.predictionHorizonS || PREDICTION_HORIZON_S;
    this.predictionStepS = options.predictionStepS || PREDICTION_STEP_S;
    this.grid = new SpatialHashGrid(this.horizSepM);
    this.pairPool = new ConflictPairPool(512);
    this.activeConflicts = new Map();
    this.conflictList = [];
    this.stats = {
      cycles: 0, pairsChecked: 0, conflictsFound: 0,
      avgCycleMs: 0, lastCycleMs: 0
    };
    this._cycleTimes = [];
  }

  _extrapolate(track, dtSec) {
    const gsMs = (track.groundSpeed || 0) * NM_TO_M / 3600;
    const hdg = track.trackAngle || 0;
    const distM = gsMs * dtSec;
    const pos = projectPosition(track.latitude, track.longitude, hdg, distM);
    const fl = (track.flightLevel || 0);
    return {
      lat: pos.lat,
      lon: pos.lon,
      fl: fl
    };
  }

  _checkPair(t1, t2) {
    let minSep = Infinity;
    let minTime = 0;
    let bestP1 = null, bestP2 = null;

    for (let t = 0; t <= this.predictionHorizonS; t += this.predictionStepS) {
      const p1 = t === 0 ? { lat: t1.latitude, lon: t1.longitude, fl: t1.flightLevel || 0 }
                          : this._extrapolate(t1, t);
      const p2 = t === 0 ? { lat: t2.latitude, lon: t2.longitude, fl: t2.flightLevel || 0 }
                          : this._extrapolate(t2, t);

      const hDist = haversineM(p1.lat, p1.lon, p2.lat, p2.lon);
      const vDist = Math.abs((p1.fl - p2.fl) * FT_PER_FL);

      const hRatio = hDist / this.horizSepM;
      const vRatio = vDist / this.vertSepFt;
      const combined = Math.max(hRatio, vRatio);

      if (combined < minSep) {
        minSep = combined;
        minTime = t;
        bestP1 = p1;
        bestP2 = p2;
      }
    }

    if (minSep < 1.0) {
      const hDistFinal = haversineM(bestP1.lat, bestP1.lon, bestP2.lat, bestP2.lon);
      const vDistFinal = Math.abs((bestP1.fl - bestP2.fl) * FT_PER_FL);
      const severity = 1.0 - minSep;
      return {
        conflict: true,
        hDist: hDistFinal,
        vDist: vDistFinal,
        timeToCPA: minTime,
        severity,
        p1: bestP1,
        p2: bestP2
      };
    }
    return { conflict: false };
  }

  run(tracksMap) {
    const t0 = Date.now();
    const oldConflicts = this.activeConflicts;
    const newConflicts = new Map();

    const pairKey = (k1, k2) => k1 < k2 ? k1 + '||' + k2 : k2 + '||' + k1;

    this.grid.clear();

    const trackArr = [];
    for (const [, t] of tracksMap) {
      if (!t.hasPosition || !t.hasAltitude) continue;
      if (!t.groundSpeed || t.groundSpeed < 10) continue;
      this.grid.insert(t);
      trackArr.push(t);
    }

    let pairsChecked = 0;
    let conflictsFound = 0;

    const seenPairs = new Set();

    for (let i = 0; i < trackArr.length; i++) {
      const t1 = trackArr[i];
      const fl1 = t1.flightLevel || 0;

      for (let j = i + 1; j < trackArr.length; j++) {
        const t2 = trackArr[j];
        const fl2 = t2.flightLevel || 0;

        if (Math.abs(fl1 - fl2) * FT_PER_FL > this.vertSepFt * 3) continue;

        const hDist = haversineM(t1.latitude, t1.longitude, t2.latitude, t2.longitude);
        if (hDist > this.horizSepM * 4) continue;

        const pk = pairKey(t1.key, t2.key);
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);

        pairsChecked++;

        const result = this._checkPair(t1, t2);
        if (result.conflict) {
          conflictsFound++;
          const cp = this.pairPool.acquire();
          cp.key1 = t1.key;
          cp.key2 = t2.key;
          cp.lat1 = t1.latitude; cp.lon1 = t1.longitude; cp.fl1 = t1.flightLevel || 0;
          cp.lat2 = t2.latitude; cp.lon2 = t2.longitude; cp.fl2 = t2.flightLevel || 0;
          cp.horizSepM = result.hDist;
          cp.vertSepFt = result.vDist;
          cp.timeToCPA = result.timeToCPA;
          cp.severity = result.severity;
          cp.callsign1 = t1.callsign || '';
          cp.callsign2 = t2.callsign || '';

          newConflicts.set(pk, cp);
        }
      }
    }

    for (const [pk, old] of oldConflicts) {
      if (!newConflicts.has(pk)) {
        this.pairPool.release(old);
      }
    }

    this.activeConflicts = newConflicts;

    this.conflictList = [];
    for (const [, cp] of newConflicts) {
      this.conflictList.push({
        key1: cp.key1, key2: cp.key2,
        lat1: cp.lat1, lon1: cp.lon1, fl1: cp.fl1,
        lat2: cp.lat2, lon2: cp.lon2, fl2: cp.fl2,
        horizSepNm: (cp.horizSepM / NM_TO_M).toFixed(1),
        vertSepFt: Math.round(cp.vertSepFt),
        timeToCPA: cp.timeToCPA,
        severity: cp.severity,
        callsign1: cp.callsign1,
        callsign2: cp.callsign2
      });
    }

    const elapsed = Date.now() - t0;
    this._cycleTimes.push(elapsed);
    if (this._cycleTimes.length > 60) this._cycleTimes.shift();

    this.stats.cycles++;
    this.stats.pairsChecked = pairsChecked;
    this.stats.conflictsFound = conflictsFound;
    this.stats.lastCycleMs = elapsed;
    this.stats.avgCycleMs = this._cycleTimes.reduce((a, b) => a + b, 0) / this._cycleTimes.length;

    return this.conflictList;
  }

  getConflictKeys() {
    const keys = new Set();
    for (const [, cp] of this.activeConflicts) {
      keys.add(cp.key1);
      keys.add(cp.key2);
    }
    return keys;
  }

  reset() {
    for (const [, cp] of this.activeConflicts) {
      this.pairPool.release(cp);
    }
    this.activeConflicts.clear();
    this.conflictList.length = 0;
    this.grid.clear();
    this.stats = { cycles: 0, pairsChecked: 0, conflictsFound: 0, avgCycleMs: 0, lastCycleMs: 0 };
  }
}

module.exports = STCAEngine;
