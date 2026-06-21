'use strict';

const EventEmitter = require('events');

class TrackManager extends EventEmitter {
    constructor() {
        super();
        this.tracks = new Map();
        this.history = new Map();
        this.maxHistoryPoints = 120;
        this.maxAgeMs = 60000;
    }

    _getKey(track) {
        if (track.modeSAddress && track.hasModeS) {
            return `S_${track.modeSAddress.toString(16).padStart(6, '0')}`;
        }
        if (track.trackNumber) {
            return `T_${track.trackNumber}`;
        }
        return null;
    }

    update(trackPoints, sourceInfo) {
        const now = Date.now();
        const updated = [];

        for (const tp of trackPoints) {
            const key = this._getKey(tp);
            if (!key) continue;

            const existing = this.tracks.get(key);
            const merged = existing ? this._merge(existing, tp) : { ...tp, key };

            merged.lastUpdate = now;
            merged.source = sourceInfo.category || merged.source || 0;

            if (tp.hasPosition) {
                merged.latitude = tp.latitude;
                merged.longitude = tp.longitude;
                merged.hasPosition = true;

                let hist = this.history.get(key);
                if (!hist) { hist = []; this.history.set(key, hist); }
                hist.push({
                    lat: tp.latitude,
                    lon: tp.longitude,
                    t: now,
                    fl: tp.hasAltitude ? tp.flightLevel : (merged.flightLevel || 0)
                });
                if (hist.length > this.maxHistoryPoints) {
                    hist.splice(0, hist.length - this.maxHistoryPoints);
                }
                merged.trailLength = hist.length;
            }

            if (tp.hasAltitude) {
                merged.flightLevel = tp.flightLevel;
                merged.hasAltitude = true;
            }
            if (tp.hasModeS) merged.hasModeS = true;
            if (tp.groundSpeed) merged.groundSpeed = tp.groundSpeed;
            if (tp.trackAngle) merged.trackAngle = tp.trackAngle;
            if (tp.callsign && tp.callsign.trim()) merged.callsign = tp.callsign.trim();

            this.tracks.set(key, merged);
            updated.push(merged);
        }

        if (updated.length > 0) {
            this.emit('update', updated);
        }

        return updated;
    }

    _merge(existing, incoming) {
        const merged = { ...existing };
        if (incoming.hasPosition) merged.latitude = incoming.latitude, merged.longitude = incoming.longitude, merged.hasPosition = true;
        if (incoming.hasAltitude) merged.flightLevel = incoming.flightLevel, merged.hasAltitude = true;
        if (incoming.hasModeS) merged.modeSAddress = incoming.modeSAddress, merged.hasModeS = true;
        if (incoming.trackNumber) merged.trackNumber = incoming.trackNumber;
        if (incoming.groundSpeed) merged.groundSpeed = incoming.groundSpeed;
        if (incoming.trackAngle) merged.trackAngle = incoming.trackAngle;
        if (incoming.callsign && incoming.callsign.trim()) merged.callsign = incoming.callsign.trim();
        if (incoming.timeOfDay) merged.timeOfDay = incoming.timeOfDay;
        return merged;
    }

    cleanup() {
        const now = Date.now();
        let removed = 0;
        for (const [key, track] of this.tracks) {
            if (now - track.lastUpdate > this.maxAgeMs) {
                this.tracks.delete(key);
                this.history.delete(key);
                removed++;
            }
        }
        return removed;
    }

    getAllTracks() {
        return Array.from(this.tracks.values()).filter(t => t.hasPosition);
    }

    getTrackCount() {
        return this.tracks.size;
    }

    getHistory(key) {
        return this.history.get(key) || [];
    }

    getFullSnapshot() {
        const tracks = this.getAllTracks();
        const withHistory = tracks.map(t => ({
            ...t,
            trail: this.history.get(t.key) || []
        }));
        return withHistory;
    }
}

module.exports = TrackManager;
