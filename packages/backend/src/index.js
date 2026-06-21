'use strict';

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');

const UdpMulticastListener = require('./udpListener');
const TrackManager = require('./trackManager');
const STCAEngine = require('./stcaEngine');
const { decode, decodeBinary, resetPool, TRACK_BINARY_SIZE, clamp } = require('@asterix/native');

const PORT = process.env.PORT || 8090;
const WS_PORT = process.env.WS_PORT || 8091;
const BROADCAST_HZ = 20;
const BROADCAST_INTERVAL_MS = Math.floor(1000 / BROADCAST_HZ);
const STCA_HZ = 5;
const STCA_INTERVAL_MS = Math.floor(1000 / STCA_HZ);
const MEMORY_LOG_INTERVAL_MS = 30000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ port: WS_PORT });

const trackManager = new TrackManager();
const stcaEngine = new STCAEngine({
    horizSepM: 5 * 1852,
    vertSepFt: 1000,
    predictionHorizonS: 120,
    predictionStepS: 10
});

let lastStcaConflictKeys = new Set();
let stcaAlertCount = 0;

const decoderStats = { totalPackets: 0, totalTracks: 0, errors: 0 };

const radarConfigs = {
    '239.192.0.1': { radarLat: 39.86, radarLon: 116.47, sac: 111, sic: 1 },
    '239.192.0.2': { radarLat: 31.23, radarLon: 121.47, sac: 111, sic: 2 },
    '239.192.0.3': { radarLat: 23.13, radarLon: 113.26, sac: 111, sic: 3 }
};

const udpListener = new UdpMulticastListener({
    multicastGroups: [
        { address: '239.192.0.1', port: 8600, category: 48 },
        { address: '239.192.0.2', port: 8601, category: 62 },
        { address: '239.192.0.3', port: 8602, category: 48 }
    ]
}, (msg, source) => {
    try {
        const radarOpt = radarConfigs[source.address] || radarConfigs['239.192.0.1'];
        const tracks = decode(Buffer.from(msg), radarOpt);
        decoderStats.totalPackets++;
        decoderStats.totalTracks += tracks.length;

        if (tracks.length > 0) {
            trackManager.update(tracks, source);
        }
    } catch (err) {
        decoderStats.errors++;
    }
});

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);

    try {
        const snapshot = trackManager.getFullSnapshot();
        ws.send(JSON.stringify({
            type: 'snapshot',
            timestamp: Date.now(),
            count: snapshot.length,
            tracks: snapshot
        }));
    } catch (e) {}

    if (stcaEngine.conflictList.length > 0) {
        try {
            ws.send(JSON.stringify({
                type: 'stca',
                timestamp: Date.now(),
                conflicts: stcaEngine.conflictList
            }));
        } catch (e) {}
    }

    ws.on('close', () => {
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[WS] Client error:', err.message);
        clients.delete(ws);
    });
});

function broadcastMessage(msg) {
    let data;
    try {
        data = JSON.stringify(msg);
    } catch (e) {
        return;
    }
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(data);
            } catch (e) {}
        }
    }
}

let pendingUpdates = [];
trackManager.on('update', (tracks) => {
    for (let i = 0; i < tracks.length; i++) pendingUpdates.push(tracks[i]);
});

const snapshotTempMap = new Map();

setInterval(() => {
    if (pendingUpdates.length === 0 && snapshotTempMap.size === 0) return;

    const uniqueMap = snapshotTempMap;
    for (let i = 0; i < pendingUpdates.length; i++) {
        const t = pendingUpdates[i];
        if (!t || !t.key) continue;
        const hist = trackManager.getHistory(t.key);
        uniqueMap.set(t.key, {
            modeSAddress: t.modeSAddress,
            trackNumber: t.trackNumber,
            latitude: t.latitude,
            longitude: t.longitude,
            flightLevel: clamp(t.flightLevel || 0, -12, 700),
            groundSpeed: t.groundSpeed || 0,
            trackAngle: t.trackAngle || 0,
            timeOfDay: t.timeOfDay || 0,
            hasModeS: t.hasModeS,
            hasPosition: t.hasPosition,
            hasAltitude: t.hasAltitude,
            callsign: t.callsign || '',
            key: t.key,
            lastUpdate: t.lastUpdate,
            source: t.source || 0,
            trailLength: hist ? hist.length : 0,
            trail: hist || []
        });
    }
    pendingUpdates.length = 0;

    if (uniqueMap.size > 0) {
        const arr = [];
        for (const v of uniqueMap.values()) arr.push(v);
        broadcastMessage({
            type: 'update',
            timestamp: Date.now(),
            count: arr.length,
            tracks: arr
        });
        uniqueMap.clear();
    }
}, BROADCAST_INTERVAL_MS);

setInterval(() => {
    try {
        const conflicts = stcaEngine.run(trackManager.tracks);
        const newKeys = stcaEngine.getConflictKeys();

        if (conflicts.length > 0) {
            broadcastMessage({
                type: 'stca',
                timestamp: Date.now(),
                count: conflicts.length,
                conflicts: conflicts
            });

            for (const k of newKeys) {
                if (!lastStcaConflictKeys.has(k)) {
                    stcaAlertCount++;
                    const c = conflicts.find(c => c.key1 === k || c.key2 === k);
                    if (c) {
                        console.log(`[STCA] ⚠️  CONFLICT: ${c.callsign1 || c.key1} ↔ ${c.callsign2 || c.key2}  H=${c.horizSepNm}NM  V=${c.vertSepFt}ft  CPA=${c.timeToCPA}s`);
                    }
                }
            }
        } else if (lastStcaConflictKeys.size > 0) {
            broadcastMessage({
                type: 'stca',
                timestamp: Date.now(),
                count: 0,
                conflicts: []
            });
        }

        lastStcaConflictKeys = newKeys;
    } catch (err) {
        console.error('[STCA] Engine error:', err.message);
    }
}, STCA_INTERVAL_MS);

setInterval(() => {
    const removed = trackManager.cleanup();
    if (removed > 0) {
        broadcastMessage({
            type: 'cleanup',
            timestamp: Date.now(),
            removedCount: removed
        });
    }
}, 5000);

setInterval(() => {
    try {
        resetPool();
    } catch (e) {}
    if (global.gc) {
        try { global.gc(); } catch (e) {}
    }
}, 15000);

setInterval(() => {
    try {
        const mem = process.memoryUsage();
        const poolStats = trackManager.getPoolStats ? trackManager.getPoolStats() : {};
        const stcaStats = stcaEngine.stats;
        console.log(`[MEM] RSS=${(mem.rss/1048576).toFixed(1)}MB  HeapUsed=${(mem.heapUsed/1048576).toFixed(1)}/${(mem.heapTotal/1048576).toFixed(1)}MB  Tracks=${trackManager.getTrackCount()}  STCA[${stcaStats.conflictsFound} conflicts, ${stcaStats.avgCycleMs.toFixed(1)}ms/cycle]  Pool=${JSON.stringify(poolStats)}`);
    } catch (e) {}
}, MEMORY_LOG_INTERVAL_MS);

app.get('/api/tracks', (req, res) => {
    res.json({
        timestamp: Date.now(),
        count: trackManager.getTrackCount(),
        tracks: trackManager.getFullSnapshot()
    });
});

app.get('/api/stats', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        timestamp: Date.now(),
        decoder: decoderStats,
        udp: udpListener.getStats(),
        tracks: {
            active: trackManager.getTrackCount()
        },
        websocket: {
            connectedClients: clients.size
        },
        memory: {
            rssMB: (mem.rss / 1048576).toFixed(1),
            heapUsedMB: (mem.heapUsed / 1048576).toFixed(1),
            heapTotalMB: (mem.heapTotal / 1048576).toFixed(1)
        },
        pools: trackManager.getPoolStats ? trackManager.getPoolStats() : {},
        trackBinarySize: TRACK_BINARY_SIZE,
        stca: {
            activeConflicts: stcaEngine.conflictList.length,
            totalAlerts: stcaAlertCount,
            ...stcaEngine.stats
        }
    });
});

app.get('/api/stca', (req, res) => {
    res.json({
        timestamp: Date.now(),
        count: stcaEngine.conflictList.length,
        conflicts: stcaEngine.conflictList,
        stats: stcaEngine.stats
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/asterix', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    try {
        const category = req.body ? req.body[0] : 0;
        const radarOpt = radarConfigs['239.192.0.1'];
        const tracks = decode(Buffer.from(req.body), radarOpt);
        decoderStats.totalPackets++;
        decoderStats.totalTracks += tracks.length;
        if (tracks.length > 0) {
            trackManager.update(tracks, { category });
        }
        res.json({ ok: true, tracks: tracks.length });
    } catch (err) {
        decoderStats.errors++;
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/asterix/binary', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    try {
        const radarOpt = radarConfigs['239.192.0.1'];
        const binResult = decodeBinary(Buffer.from(req.body), radarOpt);
        decoderStats.totalPackets++;
        res.set('Content-Type', 'application/octet-stream');
        res.send(Buffer.from(binResult));
    } catch (err) {
        decoderStats.errors++;
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/tracks/batch', express.json({ limit: '50mb' }), (req, res) => {
    try {
        const tracks = req.body.tracks || [];
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            t.hasPosition = !!t.latitude && !!t.longitude;
            t.hasModeS = !!t.modeSAddress;
            t.hasAltitude = !!t.flightLevel;
            if (t.flightLevel !== undefined) {
                t.flightLevel = clamp(Number(t.flightLevel) || 0, -12, 700);
            }
            if (!t.key) {
                t.key = t.modeSAddress ? 'S_' + t.modeSAddress.toString(16) : 'T_' + t.trackNumber;
            }
            t.lastUpdate = Date.now();
        }
        trackManager.update(tracks, { category: 255 });
        res.json({ ok: true, received: tracks.length, active: trackManager.getTrackCount() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/pool/reset', (req, res) => {
    try {
        resetPool();
        const before = trackManager.getPoolStats ? trackManager.getPoolStats() : {};
        res.json({ ok: true, before, after: trackManager.getPoolStats ? trackManager.getPoolStats() : before });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

async function start() {
    try {
        await udpListener.start();
    } catch (err) {
        console.warn('[UDP] Failed to bind multicast sockets:', err.message);
        console.warn('[UDP] Running in simulator-compatible mode only');
    }

    server.listen(PORT, () => {
        console.log(`[HTTP] REST API listening on http://localhost:${PORT}`);
    });

    console.log(`[WS] WebSocket server on ws://localhost:${WS_PORT} (${BROADCAST_HZ}Hz broadcast)`);
    console.log(`[STCA] Conflict engine @ ${STCA_HZ}Hz (5NM/1000ft sep, 120s prediction)`);
    console.log(`[SYSTEM] ATC Radar Gateway ready — max 1200 targets @ 20FPS + STCA`);
    try {
        const mem = process.memoryUsage();
        console.log(`[MEM] Initial: RSS=${(mem.rss/1048576).toFixed(1)}MB`);
    } catch (e) {}
}

start().catch(err => {
    console.error('[FATAL] Startup failed:', err);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n[SYSTEM] Shutting down...');
    udpListener.stop();
    wss.close();
    server.close();
    process.exit(0);
});
