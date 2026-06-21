'use strict';

const TRACK_BINARY_SIZE = 44;

const TB_FLAGS = {
  MODE_S: 0x01,
  POSITION: 0x02,
  ALTITUDE: 0x04,
  SPEED: 0x08,
  HEADING: 0x10,
  CALLSIGN: 0x20
};

function grayToBinary14(gray) {
  gray = gray >>> 0 & 0x3FFF;
  let bin = gray;
  bin ^= (gray >>> 1);
  bin ^= (gray >>> 2);
  bin ^= (gray >>> 3);
  bin ^= (gray >>> 4);
  bin ^= (gray >>> 5);
  bin ^= (gray >>> 6);
  bin ^= (gray >>> 7);
  bin ^= (gray >>> 8);
  bin ^= (gray >>> 9);
  bin ^= (gray >>> 10);
  bin ^= (gray >>> 11);
  bin ^= (gray >>> 12);
  bin ^= (gray >>> 13);
  return (bin >>> 0) & 0x3FFF;
}

function decodeAltitudeGillhamFE(altWord) {
  altWord = altWord >>> 0 & 0xFFFF;
  if (!(altWord & 0x0040)) return -99999;

  const d1 = (altWord & 0x0001) ? 1 : 0;
  const d2 = (altWord & 0x0002) ? 1 : 0;
  const d4 = (altWord & 0x0004) ? 1 : 0;
  const a1 = (altWord & 0x0008) ? 1 : 0;
  const a2 = (altWord & 0x0080) ? 1 : 0;
  const a4 = (altWord & 0x0800) ? 1 : 0;
  const b1 = (altWord & 0x0010) ? 1 : 0;
  const b2 = (altWord & 0x0100) ? 1 : 0;
  const b4 = (altWord & 0x1000) ? 1 : 0;
  const c1 = (altWord & 0x0020) ? 1 : 0;
  const c2 = (altWord & 0x0200) ? 1 : 0;
  const c4 = (altWord & 0x2000) ? 1 : 0;

  const gray500 = (a1) | (a2 << 1) | (a4 << 2) |
                  (b1 << 3) | (b2 << 4) | (b4 << 5) |
                  (c1 << 6) | (c2 << 7) | (c4 << 8);
  let bin500 = grayToBinary14(gray500 << 5) >>> 5;
  bin500 &= 0x1FF;

  const gray100 = d1 | (d2 << 1) | (d4 << 2);
  let bin100 = grayToBinary14(gray100 << 11) >>> 11;
  bin100 &= 0x7;

  if (bin100 === 5 || bin100 === 6 || bin100 === 7) return -99998;

  if (bin500 & 1) {
    if (bin100 === 0) bin100 = 4;
    else if (bin100 === 1) bin100 = 3;
    else if (bin100 === 3) bin100 = 1;
    else if (bin100 === 4) bin100 = 0;
  }

  let feet = bin500 * 500 + bin100 * 100 - 1200;
  if (feet < -1500) feet = -1200;
  if (feet > 65000) feet = 65000;
  return feet;
}

function clamp(v, lo, hi) {
  v = +v;
  if (isNaN(v)) return lo;
  if (v === -Infinity) return lo;
  if (v === Infinity) return hi;
  return v < lo ? lo : (v > hi ? hi : v);
}
function clampI32(v, lo, hi) {
  lo = lo | 0;
  hi = hi | 0;
  if (typeof v === 'number' && isNaN(v)) return lo;
  if (v === -Infinity) return lo;
  if (v === Infinity) return hi;
  v = v | 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

class JSTrackObjectPool {
  constructor(initialSize = 1024) {
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
      callsign: '', key: undefined, lastUpdate: undefined, source: undefined,
      trailLength: 0, trail: undefined
    };
  }
  acquire() {
    if (this.pool.length > 0) {
      const o = this.pool.pop();
      o.modeSAddress = 0; o.latitude = 0; o.longitude = 0; o.flightLevel = 0;
      o.trackNumber = 0; o.timeOfDay = 0; o.groundSpeed = 0; o.trackAngle = 0;
      o.hasModeS = false; o.hasPosition = false; o.hasAltitude = false;
      o.callsign = ''; o.key = undefined; o.lastUpdate = undefined;
      o.source = undefined; o.trailLength = 0; o.trail = undefined;
      return o;
    }
    return this._createFresh();
  }
  release(obj) {
    if (this.pool.length < 4096) {
      obj.trail = undefined;
      this.pool.push(obj);
    }
  }
  releaseBatch(arr) {
    for (const o of arr) this.release(o);
  }
}

const gPool = new JSTrackObjectPool(2048);

class BitReader {
  constructor(buffer) {
    this.data = buffer;
    this.length = buffer.length;
    this.bytePos = 0;
    this.bitPos = 0;
  }
  readBit() {
    if (this.bytePos >= this.length) return 0;
    const bit = (this.data[this.bytePos] >>> (7 - this.bitPos)) & 0x01;
    this.bitPos++;
    if (this.bitPos >= 8) { this.bitPos = 0; this.bytePos++; }
    return bit;
  }
  readBits(n) {
    let result = 0;
    for (let i = 0; i < n; i++) result = (result << 1) | this.readBit();
    return result >>> 0;
  }
  readU8(n) { return this.readBits(n); }
  readU16(n) { return this.readBits(n); }
  readU32(n) { return this.readBits(n); }
  readS32(n) {
    n = n < 1 ? 1 : (n > 32 ? 32 : n);
    let val = this.readU32(n);
    if (n < 32 && (val & (1 << (n - 1)))) val = val - (1 << n);
    return val | 0;
  }
  readU16BE() {
    this.alignToByte();
    if (this.bytePos + 1 >= this.length) return 0;
    const v = (this.data[this.bytePos] << 8) | this.data[this.bytePos + 1];
    this.bytePos += 2; this.bitPos = 0;
    return v >>> 0;
  }
  skipBits(n) { for (let i = 0; i < n; i++) this.readBit(); }
  alignToByte() { if (this.bitPos > 0) { this.bitPos = 0; this.bytePos++; } }
  eof() { return this.bytePos >= this.length; }
}

function parseFSPEC(br) {
  const fspec = [];
  while (true) {
    const octet = br.readBits(8);
    fspec.push(octet);
    if (!(octet & 0x01)) break;
  }
  return fspec;
}
function fspecHasItem(fspec, frn) {
  if (frn === 0) return false;
  const oi = Math.floor((frn - 1) / 7);
  const bi = 7 - ((frn - 1) % 7);
  if (oi >= fspec.length) return false;
  return (fspec[oi] & (1 << bi)) !== 0;
}

function deg2rad(d) { return d * Math.PI / 180.0; }
function wgs84Project(lat, lon, rangeM, bearingDeg) {
  const R = 6371000.0;
  const brng = deg2rad(bearingDeg);
  const lat1 = deg2rad(lat);
  const lon1 = deg2rad(lon);
  const d = rangeM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
                                   Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

function decodeCallsignChars(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c === 32) s += ' ';
    else if (c >= 1 && c <= 26) s += String.fromCharCode(65 + c - 1);
    else if (c >= 48 && c <= 57) s += String.fromCharCode(48 + (c - 48));
    else s += ' ';
  }
  return s.trim();
}

function decodeCat048(buf, radar) {
  const tracks = [];
  if (buf.length < 5) return tracks;
  const br = new BitReader(buf.slice(1));
  const lenField = br.readU16(16);

  while (!br.eof()) {
    const fspec = parseFSPEC(br);
    const tp = gPool.acquire();

    if (fspecHasItem(fspec, 1)) br.skipBits(8);
    if (fspecHasItem(fspec, 2)) { tp.modeSAddress = br.readU32(24); tp.hasModeS = true; }
    if (fspecHasItem(fspec, 3)) tp.timeOfDay = br.readU32(24) / 128.0;
    if (fspecHasItem(fspec, 4)) {
      const code = br.readU32(16);
      tp.trackNumber = ((code & 0x000F)) * 1000 + (((code >> 4) & 0x000F)) * 100 +
                        (((code >> 8) & 0x000F)) * 10 + (((code >> 12) & 0x000F));
    }

    let rhoM = 0, thetaDeg = 0, hasRho = false, hasTheta = false;
    if (fspecHasItem(fspec, 5)) { rhoM = (br.readU16(16) & 0xFFFF) * (1.0 / 32.0) * 1852.0; hasRho = true; }
    if (fspecHasItem(fspec, 6)) { thetaDeg = (br.readU16(16) & 0xFFFF) * 360.0 / 65536.0; hasTheta = true; }
    if (hasRho && hasTheta) {
      const pos = wgs84Project(radar.radarLat, radar.radarLon, rhoM, thetaDeg);
      tp.latitude = clamp(pos.lat, -90, 90);
      tp.longitude = clamp(pos.lon, -180, 180);
      tp.hasPosition = true;
    }

    if (fspecHasItem(fspec, 7)) {
      const altCode16 = br.readU32(16) & 0xFFFF;
      const feMode = (altCode16 & 0x0040) !== 0;
      if (feMode) {
        let feet = decodeAltitudeGillhamFE(altCode16);
        if (feet < -90000) {
          const num = ((altCode16 & 0x001F) << 8) | ((altCode16 & 0x0F00) >>> 4) |
                      ((altCode16 & 0x0020) << 5) | ((altCode16 & 0xE000) >>> 7);
          const n = num & 0x7FF;
          feet = n * 100 - 1200;
        }
        feet = clamp(feet, -1200, 65000);
        tp.flightLevel = feet / 100.0;
        tp.hasAltitude = true;
      } else {
        const num = ((altCode16 & 0x0010) << 4) | ((altCode16 & 0x000F) << 2) |
                    ((altCode16 & 0x0080) >>> 6) | ((altCode16 & 0x0020) >>> 5) |
                    ((altCode16 & 0x0F00) >>> 8) | ((altCode16 & 0xE000) >>> 11);
        let metricRaw = num & 0x0FFF;
        if (metricRaw & 0x0800) metricRaw = metricRaw - 0x1000;
        let meters = metricRaw * 25;
        meters = clamp(meters, -500, 20000);
        tp.flightLevel = (meters / 30.48) / 100.0;
        tp.hasAltitude = true;
      }
    }

    if (fspecHasItem(fspec, 8)) br.skipBits(8);
    if (fspecHasItem(fspec, 9)) br.skipBits(8);
    if (fspecHasItem(fspec, 10)) {
      const gs = br.readU16(16) & 0xFFFF;
      tp.groundSpeed = gs > 16383 ? 0 : gs * 0.1;
    }
    if (fspecHasItem(fspec, 11)) {
      tp.trackAngle = (br.readU16(16) & 0xFFFF) * 360.0 / 65536.0;
    }
    if (fspecHasItem(fspec, 13)) br.skipBits(8);
    if (fspecHasItem(fspec, 16)) br.skipBits(8);
    if (fspecHasItem(fspec, 17)) br.skipBits(32);
    if (fspecHasItem(fspec, 20)) {
      const chars = [];
      for (let i = 0; i < 8; i++) chars.push(br.readU8(6));
      tp.callsign = decodeCallsignChars(chars);
    }
    if (fspecHasItem(fspec, 23)) br.skipBits(8);
    if (fspecHasItem(fspec, 12)) br.skipBits(56);

    br.alignToByte();
    if (tp.hasPosition || tp.hasModeS) tracks.push(tp);
    else gPool.release(tp);
    if (br.bytePos >= buf.length - 2) break;
  }
  return tracks;
}

function decodeCat062(buf) {
  const tracks = [];
  if (buf.length < 5) return tracks;
  const br = new BitReader(buf.slice(1));
  const lenField = br.readU16(16);

  while (!br.eof()) {
    const fspec = parseFSPEC(br);
    const tp = gPool.acquire();

    if (fspecHasItem(fspec, 1)) tp.trackNumber = br.readU32(24);
    if (fspecHasItem(fspec, 2)) br.skipBits(8);
    if (fspecHasItem(fspec, 3)) tp.timeOfDay = br.readU32(24) / 128.0;
    if (fspecHasItem(fspec, 4)) { tp.modeSAddress = br.readU32(24); tp.hasModeS = true; }
    if (fspecHasItem(fspec, 5)) br.skipBits(8);
    if (fspecHasItem(fspec, 6)) br.skipBits(8);
    if (fspecHasItem(fspec, 7)) {
      br.skipBits(4);
      const rep = br.readU8(4);
      for (let r = 0; r < rep + 1; r++) br.skipBits(32);
    }
    let hasLat = false, hasLon = false;
    if (fspecHasItem(fspec, 8)) {
      let raw = br.readS32(32) | 0;
      raw = clampI32(raw, -1073741823, 1073741823);
      const lat = raw * 180.0 / 2147483648.0;
      if (lat >= -90 && lat <= 90 && isFinite(lat)) {
        tp.latitude = lat; hasLat = true;
      }
    }
    if (fspecHasItem(fspec, 9)) {
      let raw = br.readS32(32) | 0;
      raw = clampI32(raw, -2147483647, 2147483647);
      const lon = raw * 180.0 / 2147483648.0;
      if (lon >= -180 && lon <= 180 && isFinite(lon)) {
        tp.longitude = lon; hasLon = true;
      }
    }
    if (hasLat && hasLon) tp.hasPosition = true;
    if (fspecHasItem(fspec, 10)) br.skipBits(32);
    if (fspecHasItem(fspec, 11)) br.skipBits(32);
    if (fspecHasItem(fspec, 12)) {
      const altRaw = br.readU32(16) & 0xFFFF;
      const validBit = (altRaw & 0x4000) !== 0;
      const metricG = (altRaw & 0x8000) !== 0;
      const altValue = altRaw & 0x3FFF;
      let fl;
      if (metricG) {
        const meters = clamp(altValue * 6.25, 0, 20000);
        fl = (meters / 30.48) / 100.0;
      } else {
        fl = altValue * 6.25 / 100.0;
      }
      if (!validBit || fl < -12 || fl > 700) {
        if (!validBit) fl = 0;
        fl = clamp(fl, -12, 700);
      }
      tp.flightLevel = fl;
      tp.hasAltitude = true;
    }
    if (fspecHasItem(fspec, 13)) br.skipBits(16);
    if (fspecHasItem(fspec, 14)) {
      tp.groundSpeed = clamp((br.readU16(16) & 0xFFFF) * 360.0 / 65536.0, 0, 2000);
    }
    if (fspecHasItem(fspec, 15)) {
      tp.trackAngle = (br.readU16(16) & 0xFFFF) * 360.0 / 65536.0;
    }
    if (fspecHasItem(fspec, 16)) br.skipBits(32);
    if (fspecHasItem(fspec, 17)) br.skipBits(32);
    if (fspecHasItem(fspec, 18)) br.skipBits(16);
    if (fspecHasItem(fspec, 19)) br.skipBits(8);
    if (fspecHasItem(fspec, 20)) {
      const chars = [];
      for (let i = 0; i < 8; i++) chars.push(br.readU8(6));
      tp.callsign = decodeCallsignChars(chars);
    }
    if (fspecHasItem(fspec, 21)) br.skipBits(8);
    if (fspecHasItem(fspec, 22)) {
      const chars = [];
      for (let i = 0; i < 8; i++) chars.push(br.readU8(8));
      if (!tp.callsign) tp.callsign = decodeCallsignChars(chars);
    }
    if (fspecHasItem(fspec, 23)) br.skipBits(8);
    if (fspecHasItem(fspec, 24)) br.skipBits(8);
    if (fspecHasItem(fspec, 25)) br.skipBits(16);
    if (fspecHasItem(fspec, 26)) br.skipBits(16);
    if (fspecHasItem(fspec, 27)) br.skipBits(8);
    if (fspecHasItem(fspec, 28)) br.skipBits(8);
    if (fspecHasItem(fspec, 29)) br.skipBits(32);
    if (fspecHasItem(fspec, 30)) br.skipBits(32);

    br.alignToByte();
    if (tp.hasPosition || tp.hasModeS) tracks.push(tp);
    else gPool.release(tp);
    if (br.bytePos >= buf.length - 2) break;
  }
  return tracks;
}

function decodeFallback(buffer, options) {
  if (!Buffer.isBuffer(buffer)) return [];
  if (buffer.length < 1) return [];
  const radar = options || { radarLat: 39.86, radarLon: 116.47 };
  const category = buffer[0];
  try {
    if (category === 48) return decodeCat048(buffer, radar);
    if (category === 62) return decodeCat062(buffer);
    return [];
  } catch (e) {
    return [];
  }
}

function decodeBinaryFallback(buffer, options) {
  const tracks = decodeFallback(buffer, options);
  const count = tracks.length;
  const totalBytes = 4 + count * TRACK_BINARY_SIZE;
  const outBuf = Buffer.allocUnsafe(totalBytes);
  outBuf.writeUInt32LE(count, 0);
  let off = 4;
  for (let i = 0; i < count; i++) {
    const t = tracks[i];
    outBuf.writeUInt32LE(t.modeSAddress >>> 0, off); off += 4;
    outBuf.writeUInt32LE(t.trackNumber >>> 0, off); off += 4;
    outBuf.writeInt32LE(clampI32(Math.trunc((t.latitude || 0) * 1e7), -900000000, 900000000), off); off += 4;
    outBuf.writeInt32LE(clampI32(Math.trunc((t.longitude || 0) * 1e7), -1800000000, 1800000000), off); off += 4;
    outBuf.writeInt32LE(clampI32(Math.trunc((t.flightLevel || 0) * 100), -5000, 70000), off); off += 4;
    outBuf.writeInt32LE(clampI32(Math.trunc((t.groundSpeed || 0) * 100), 0, 200000), off); off += 4;
    outBuf.writeInt32LE(clampI32(Math.trunc(((t.trackAngle || 0) % 360) * 100), 0, 36000), off); off += 4;
    outBuf.writeUInt32LE(Math.trunc((t.timeOfDay || 0) * 128) >>> 0, off); off += 4;
    let flags = 0;
    if (t.hasModeS) flags |= TB_FLAGS.MODE_S;
    if (t.hasPosition) flags |= TB_FLAGS.POSITION;
    if (t.hasAltitude) flags |= TB_FLAGS.ALTITUDE;
    if (t.groundSpeed > 0) flags |= TB_FLAGS.SPEED;
    if (t.trackAngle >= 0 && t.trackAngle <= 360) flags |= TB_FLAGS.HEADING;
    if (t.callsign && t.callsign.length > 0) flags |= TB_FLAGS.CALLSIGN;
    outBuf[off++] = flags & 0xFF;
    const cs = (t.callsign || '').padEnd(8, ' ').slice(0, 8);
    for (let j = 0; j < 8; j++) outBuf[off++] = cs.charCodeAt(j) & 0xFF;
  }
  return outBuf;
}

module.exports = {
  decodeFallback,
  decodeBinaryFallback,
  JSTrackObjectPool,
  gPool,
  TRACK_BINARY_SIZE,
  TB_FLAGS,
  grayToBinary14,
  decodeAltitudeGillhamFE,
  clamp,
  clampI32
};
