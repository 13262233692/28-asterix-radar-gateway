'use strict';

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');

const UdpMulticastListener = require('./udpListener');
const TrackManager = require('./trackManager');
const { decode } = require('@asterix/native');

const PORT = process.env.PORT || 8090;
const WS_PORT = process.env.WS_PORT || 8091;
const BROADCAST_HZ = 20;
const BROADCAST_INTERVAL_MS = Math.floor(1000 / BROADCAST_HZ);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ port: WS_PORT });

const trackManager = new TrackManager();

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

    ws.send(JSON.stringify({
        type: 'snapshot',
        timestamp: Date.now(),
        tracks: trackManager.getFullSnapshot()
    }));

    ws.on('close', () => {
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[WS] Client error:', err.message);
        clients.delete(ws);
    });
});

function broadcastMessage(msg) {
    const data = JSON.stringify(msg);
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
    for (const t of tracks) pendingUpdates.push(t);
});

setInterval(() => {
    if (pendingUpdates.length === 0) return;

    const uniqueMap = new Map();
    for (const t of pendingUpdates) {
        const withTrail = {
            ...t,
            trail: trackManager.getHistory(t.key)
        };
        uniqueMap.set(t.key, withTrail);
    }

    broadcastMessage({
        type: 'update',
        timestamp: Date.now(),
        tracks: Array.from(uniqueMap.values())
    });

    pendingUpdates = [];
}, BROADCAST_INTERVAL_MS);

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

app.get('/api/tracks', (req, res) => {
    res.json({
        timestamp: Date.now(),
        count: trackManager.getTrackCount(),
        tracks: trackManager.getFullSnapshot()
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        timestamp: Date.now(),
        decoder: decoderStats,
        udp: udpListener.getStats(),
        tracks: {
            active: trackManager.getTrackCount()
        },
        websocket: {
            connectedClients: clients.size
        }
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

app.post('/api/tracks/batch', express.json(), (req, res) => {
    try {
        const tracks = req.body.tracks || [];
        for (const t of tracks) {
            t.hasPosition = !!t.latitude && !!t.longitude;
            t.hasModeS = !!t.modeSAddress;
            t.hasAltitude = !!t.flightLevel;
            if (!t.key) {
                t.key = t.modeSAddress ? `S_${t.modeSAddress.toString(16)}` : `T_${t.trackNumber}`;
            }
            t.lastUpdate = Date.now();
        }
        trackManager.update(tracks, { category: 255 });
        res.json({ ok: true, received: tracks.length, active: trackManager.getTrackCount() });
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
    console.log(`[SYSTEM] ATC Radar Gateway ready — max 800 targets @ 20FPS`);
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
