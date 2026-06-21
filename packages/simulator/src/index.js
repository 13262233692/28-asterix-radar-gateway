'use strict';

const dgram = require('dgram');

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const EARTH_R = 6371000.0;

const AIRLINE_PREFIXES = [
  'CCA', 'CES', 'CSN', 'CHH', 'CXA', 'CSH', 'CDG', 'CQH',
  'UAL', 'AAL', 'DAL', 'SWA', 'JBU', 'ASA', 'FDX', 'UPS',
  'BAW', 'VIR', 'AFR', 'KLM', 'DLH', 'SWR', 'SAS', 'IBE',
  'ANA', 'JAL', 'KAL', 'AAR', 'THA', 'SIA', 'MAS', 'QFA'
];

class Aircraft {
  constructor(id, centerLat, centerLon) {
    this.id = id;
    this.modeS = 0x400000 + Math.floor(Math.random() * 0xFFFFF);
    this.callsign = this._genCallsign();
    this.lat = centerLat + (Math.random() - 0.5) * 5;
    this.lon = centerLon + (Math.random() - 0.5) * 6;
    this.heading = Math.random() * 360;
    this.speedKt = 250 + Math.random() * 350;
    this.flightLevel = 50 + Math.floor(Math.random() * 400);
    this.climbRate = (Math.random() - 0.5) * 2000;
    this.turnRate = (Math.random() - 0.5) * 1.5;
    this.trail = [];
  }

  _genCallsign() {
    const p = AIRLINE_PREFIXES[Math.floor(Math.random() * AIRLINE_PREFIXES.length)];
    const n = Math.floor(Math.random() * 9999);
    return p + n.toString().padStart(3, '0');
  }

  _projectDestination(lat, lon, brngDeg, distM) {
    const lat1 = lat * DEG2RAD;
    const lon1 = lon * DEG2RAD;
    const brng = brngDeg * DEG2RAD;
    const d = distM / EARTH_R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
                                     Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * RAD2DEG, lon: lon2 * RAD2DEG };
  }

  update(dtSec, centerLat, centerLon) {
    const distM = (this.speedKt * 1852 / 3600) * dtSec;
    const pos = this._projectDestination(this.lat, this.lon, this.heading, distM);
    this.lat = pos.lat;
    this.lon = pos.lon;
    this.heading = (this.heading + this.turnRate * dtSec + 360) % 360;

    this.flightLevel += (this.climbRate / 60 / 100) * dtSec;
    if (this.flightLevel < 10) { this.flightLevel = 10; this.climbRate = Math.abs(this.climbRate); }
    if (this.flightLevel > 450) { this.flightLevel = 450; this.climbRate = -Math.abs(this.climbRate); }

    if (Math.random() < 0.005) this.turnRate = (Math.random() - 0.5) * 1.5;
    if (Math.random() < 0.002) this.climbRate = (Math.random() - 0.5) * 2000;

    this.trail.push({ lat: this.lat, lon: this.lon, fl: this.flightLevel, t: Date.now() });
    if (this.trail.length > 120) this.trail.splice(0, this.trail.length - 120);
  }
}

class AsterixEncoder {
  static _callsignToBytes(cs) {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const c = cs[i] || ' ';
      if (c === ' ') out.push(32);
      else if (c >= 'A' && c <= 'Z') out.push(c.charCodeAt(0) - 64);
      else if (c >= '0' && c <= '9') out.push(c.charCodeAt(0));
      else out.push(32);
    }
    return out;
  }

  static _writeBits(buf, bitPos, value, n) {
    for (let i = 0; i < n; i++) {
      const b = (value >> (n - 1 - i)) & 1;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      if (b) buf[byteIdx] |= (1 << bitIdx);
      else buf[byteIdx] &= ~(1 << bitIdx);
      bitPos++;
    }
    return bitPos;
  }

  static encodeCat062(ac) {
    const MAX_BUF = 256;
    const buf = Buffer.alloc(MAX_BUF);
    buf.fill(0);
    buf[0] = 62;

    let bitPos = 24;

    const fspec = [0, 0, 0, 0, 0];
    const setFspec = (frn) => {
      if (frn === 0) return;
      const oi = Math.floor((frn - 1) / 7);
      const bi = 7 - ((frn - 1) % 7);
      fspec[oi] |= (1 << bi);
    };
    const markFspecContinuation = () => {
      for (let i = 0; i < fspec.length - 1; i++) fspec[i] |= 0x01;
    };

    setFspec(1);
    setFspec(3);
    setFspec(4);
    setFspec(8);
    setFspec(9);
    setFspec(12);
    setFspec(14);
    setFspec(15);
    setFspec(20);
    markFspecContinuation();
    fspec[fspec.length - 1] &= ~0x01;

    let bytePos = 3;
    for (let i = 0; i < fspec.length; i++) buf[bytePos++] = fspec[i];

    buf.writeUIntBE(ac.id & 0xFFFFFF, bytePos, 3); bytePos += 3;

    const tod = Math.floor(((Date.now() / 1000) % 86400) * 128);
    buf.writeUIntBE(tod & 0xFFFFFF, bytePos, 3); bytePos += 3;

    buf.writeUIntBE(ac.modeS & 0xFFFFFF, bytePos, 3); bytePos += 3;

    const latRaw = Math.floor(ac.lat * 2147483648 / 180);
    buf.writeInt32BE(latRaw, bytePos); bytePos += 4;

    const lonRaw = Math.floor(ac.lon * 2147483648 / 180);
    buf.writeInt32BE(lonRaw, bytePos); bytePos += 4;

    const altRaw = Math.floor(ac.flightLevel * 100 / 6.25);
    buf.writeUInt16BE(altRaw & 0xFFFF, bytePos); bytePos += 2;

    const gsRaw = Math.floor(ac.speedKt * 65536 / 360);
    buf.writeUInt16BE(gsRaw & 0xFFFF, bytePos); bytePos += 2;

    const hdgRaw = Math.floor(ac.heading * 65536 / 360);
    buf.writeUInt16BE(hdgRaw & 0xFFFF, bytePos); bytePos += 2;

    const csBytes = this._callsignToBytes(ac.callsign);
    let csBitPos = bytePos * 8;
    for (let i = 0; i < 8; i++) {
      csBitPos = this._writeBits(buf, csBitPos, csBytes[i] & 0x3F, 6);
    }
    bytePos = Math.ceil(csBitPos / 8);

    const totalLen = bytePos;
    buf.writeUInt16BE(totalLen, 1);

    return buf.slice(0, totalLen);
  }
}

class Simulator {
  constructor() {
    this.centerLat = 39.86;
    this.centerLon = 116.47;
    this.aircraft = [];
    this.socket = dgram.createSocket('udp4');
    this.groups = [
      { address: '239.192.0.2', port: 8601 }
    ];
    this.tps = 20;
    this.lastTime = Date.now();
  }

  _initAircraft(count) {
    for (let i = 0; i < count; i++) {
      this.aircraft.push(new Aircraft(i + 1, this.centerLat, this.centerLon));
    }
  }

  start(aircraftCount = 800) {
    this._initAircraft(aircraftCount);
    console.log(`[SIM] Spawned ${aircraftCount} simulated aircraft`);
    console.log(`[SIM] Targeting ${this.groups.map(g => g.address + ':' + g.port).join(', ')}`);
    console.log(`[SIM] Emitting @ ${this.tps}Hz`);

    const intervalMs = Math.floor(1000 / this.tps);

    setInterval(() => this._tick(), intervalMs);
    setInterval(() => this._printStats(), 5000);
  }

  _tick() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    for (const ac of this.aircraft) {
      ac.update(dt, this.centerLat, this.centerLon);
    }

    for (const ac of this.aircraft) {
      const pkt = AsterixEncoder.encodeCat062(ac);
      for (const g of this.groups) {
        try {
          this.socket.send(pkt, 0, pkt.length, g.port, g.address);
        } catch (e) {}
      }
    }

    if (this.httpEndpoint && this._httpTickAcc++ % 2 === 0) {
      const batch = [];
      for (const ac of this.aircraft) {
        batch.push({
          key: 'S_' + ac.modeS.toString(16),
          trackNumber: ac.id,
          modeSAddress: ac.modeS,
          latitude: ac.lat,
          longitude: ac.lon,
          flightLevel: ac.flightLevel,
          groundSpeed: ac.speedKt,
          trackAngle: ac.heading,
          callsign: ac.callsign,
          hasPosition: true,
          hasModeS: true,
          hasAltitude: true,
          trail: ac.trail.slice(-60)
        });
      }
      try {
        const data = JSON.stringify({ tracks: batch });
        const req = this._httpReq;
        const http = require('http');
        const options = {
          hostname: 'localhost',
          port: 8090,
          path: '/api/tracks/batch',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          }
        };
        const r = http.request(options, (res) => {
          res.resume();
        });
        r.on('error', () => {});
        r.setTimeout(100);
        r.write(data);
        r.end();
      } catch (e) {}
    }
  }

  _printStats() {
    console.log(`[SIM] ${this.aircraft.length} targets @ ${this.tps}Hz → ${this.aircraft.length * this.tps} updates/s`);
  }
}

const sim = new Simulator();
sim.httpEndpoint = 'http://localhost:8090';
sim._httpTickAcc = 0;
sim.start(parseInt(process.argv[2]) || 800);
