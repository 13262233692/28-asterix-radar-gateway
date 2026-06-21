'use strict';

const EventEmitter = require('events');

class BroadcastObjectPool {
  constructor(initialSize = 2048) {
    this.pool = [];
    this._init(initialSize);
  }
  _init(n) {
    for (let i = 0; i < n; i++) this.pool.push(this._createFresh());
  }
  _createFresh() {
    return {
      modeSAddress: 0, latitude: 0, longitude: 0, flightLevel: 0,
      trackNumber: 0, timeOfDay: 0, groundSpeed: 0, trackAngle: 0,
      hasModeS: false, hasPosition: false, hasAltitude: false,
      callsign: '', key: null, lastUpdate: 0, source: 0,
      trailLength: 0, trail: null
    };
  }
  acquire() {
    if (this.pool.length > 0) {
      const o = this.pool.pop();
      o.modeSAddress = 0; o.latitude = 0; o.longitude = 0; o.flightLevel = 0;
      o.trackNumber = 0; o.timeOfDay = 0; o.groundSpeed = 0; o.trackAngle = 0;
      o.hasModeS = false; o.hasPosition = false; o.hasAltitude = false;
      o.callsign = ''; o.key = null; o.lastUpdate = 0; o.source = 0;
      o.trailLength = 0; o.trail = null;
      return o;
    }
    return this._createFresh();
  }
  release(obj) {
    if (!obj) return;
    if (this.pool.length < 8192) {
      obj.trail = null;
      this.pool.push(obj);
    }
  }
  releaseBatch(arr) {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) this.release(arr[i]);
  }
}

class TrailPointPool {
  constructor(initialSize = 16384) {
    this.pool = [];
    this._init(initialSize);
  }
  _init(n) {
    for (let i = 0; i < n; i++) this.pool.push({ lat: 0, lon: 0, t: 0, fl: 0 });
  }
  acquire() {
    if (this.pool.length > 0) {
      const o = this.pool.pop();
      o.lat = 0; o.lon = 0; o.t = 0; o.fl = 0;
      return o;
    }
    return { lat: 0, lon: 0, t: 0, fl: 0 };
  }
  release(obj) {
    if (!obj) return;
    if (this.pool.length < 65536) this.pool.push(obj);
  }
  releaseBatch(arr) {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) this.release(arr[i]);
  }
}

const gBroadcastPool = new BroadcastObjectPool(2048);
const gTrailPointPool = new TrailPointPool(16384);

class TrackManager extends EventEmitter {
  constructor() {
    super();
    this.tracks = new Map();
    this.history = new Map();
    this.maxHistoryPoints = 120;
    this.maxAgeMs = 60000;
    this.pendingCleanupTrails = [];
  }

  _getKey(track) {
    if (track.modeSAddress && track.hasModeS) {
      return 'S_' + track.modeSAddress.toString(16).padStart(6, '0');
    }
    if (track.trackNumber) {
      return 'T_' + track.trackNumber;
    }
    return null;
  }

  update(trackPoints, sourceInfo) {
    const now = Date.now();
    const updated = [];
    const srcCat = (sourceInfo && sourceInfo.category) ? sourceInfo.category : 0;

    for (let i = 0; i < trackPoints.length; i++) {
      const tp = trackPoints[i];
      const key = this._getKey(tp);
      if (!key) continue;

      let merged;
      const existing = this.tracks.get(key);
      if (existing) {
        merged = existing;
      } else {
        merged = gBroadcastPool.acquire();
        merged.key = key;
      }

      merged.lastUpdate = now;
      merged.source = srcCat || merged.source || 0;

      if (tp.hasPosition) {
        merged.latitude = tp.latitude;
        merged.longitude = tp.longitude;
        merged.hasPosition = true;

        let hist = this.history.get(key);
        if (!hist) { hist = []; this.history.set(key, hist); }
        const tp2 = gTrailPointPool.acquire();
        tp2.lat = tp.latitude;
        tp2.lon = tp.longitude;
        tp2.t = now;
        tp2.fl = tp.hasAltitude ? tp.flightLevel : (merged.flightLevel || 0);
        hist.push(tp2);
        if (hist.length > this.maxHistoryPoints) {
          const removed = hist.splice(0, hist.length - this.maxHistoryPoints);
          for (let j = 0; j < removed.length; j++) gTrailPointPool.release(removed[j]);
        }
        merged.trailLength = hist.length;
      }

      if (tp.hasAltitude) {
        merged.flightLevel = tp.flightLevel;
        merged.hasAltitude = true;
      }
      if (tp.hasModeS) merged.hasModeS = true, merged.modeSAddress = tp.modeSAddress;
      if (tp.trackNumber) merged.trackNumber = tp.trackNumber;
      if (tp.groundSpeed) merged.groundSpeed = tp.groundSpeed;
      if (tp.trackAngle) merged.trackAngle = tp.trackAngle;
      if (tp.callsign && tp.callsign.trim()) merged.callsign = tp.callsign.trim();
      if (tp.timeOfDay) merged.timeOfDay = tp.timeOfDay;

      this.tracks.set(key, merged);
      updated.push(merged);
    }

    if (updated.length > 0) {
      this.emit('update', updated);
    }

    return updated;
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, track] of this.tracks) {
      if (now - track.lastUpdate > this.maxAgeMs) {
        const hist = this.history.get(key);
        if (hist) {
          gTrailPointPool.releaseBatch(hist);
          this.history.delete(key);
        }
        this.tracks.delete(key);
        gBroadcastPool.release(track);
        removed++;
      }
    }
    return removed;
  }

  getAllTracks() {
    const result = [];
    for (const t of this.tracks.values()) {
      if (t.hasPosition) result.push(t);
    }
    return result;
  }

  getTrackCount() {
    return this.tracks.size;
  }

  getHistory(key) {
    return this.history.get(key) || [];
  }

  acquireBroadcastObj() {
    return gBroadcastPool.acquire();
  }

  releaseBroadcastBatch(arr) {
    gBroadcastPool.releaseBatch(arr);
  }

  getPoolStats() {
    return {
      broadcastPoolSize: gBroadcastPool.pool.length,
      trailPointPoolSize: gTrailPointPool.pool.length,
      tracked: this.tracks.size,
      historyEntries: this.history.size
    };
  }
}

TrackManager.gBroadcastPool = gBroadcastPool;
TrackManager.gTrailPointPool = gTrailPointPool;

module.exports = TrackManager;
