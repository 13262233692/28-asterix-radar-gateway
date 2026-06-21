'use strict';

class BitReader {
    constructor(buffer) {
        this.data = buffer;
        this.length = buffer.length;
        this.bytePos = 0;
        this.bitPos = 0;
    }

    readBit() {
        if (this.bytePos >= this.length) return 0;
        const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 0x01;
        this.bitPos++;
        if (this.bitPos >= 8) {
            this.bitPos = 0;
            this.bytePos++;
        }
        return bit;
    }

    readBits(n) {
        let result = 0;
        for (let i = 0; i < n; i++) {
            result = (result << 1) | this.readBit();
        }
        return result >>> 0;
    }

    readU8(n) { return this.readBits(n); }
    readU16(n) { return this.readBits(n); }
    readU32(n) { return this.readBits(n); }

    readS32(n) {
        let val = this.readU32(n);
        if (val & (1 << (n - 1))) {
            val = val - (1 << n);
        }
        return val;
    }

    skipBits(n) {
        for (let i = 0; i < n; i++) this.readBit();
    }

    alignToByte() {
        if (this.bitPos > 0) {
            this.bitPos = 0;
            this.bytePos++;
        }
    }

    eof() {
        return this.bytePos >= this.length;
    }
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
    const octetIdx = Math.floor((frn - 1) / 7);
    const bitIdx = 7 - ((frn - 1) % 7);
    if (octetIdx >= fspec.length) return false;
    return (fspec[octetIdx] & (1 << bitIdx)) !== 0;
}

function deg2rad(d) { return d * Math.PI / 180.0; }
function rad2deg(r) { return r * 180.0 / Math.PI; }

function wgs84Project(lat, lon, rangeM, bearingDeg) {
    const R = 6371000.0;
    const brng = deg2rad(bearingDeg);
    const lat1 = deg2rad(lat);
    const lon1 = deg2rad(lon);
    const d = rangeM / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
                                     Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: rad2deg(lat2), lon: rad2deg(lon2) };
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
        const tp = {
            modeSAddress: 0, latitude: 0, longitude: 0, flightLevel: 0,
            trackNumber: 0, timeOfDay: 0, groundSpeed: 0, trackAngle: 0,
            hasModeS: false, hasPosition: false, hasAltitude: false, callsign: ''
        };

        if (fspecHasItem(fspec, 1)) br.skipBits(8);
        if (fspecHasItem(fspec, 2)) { tp.modeSAddress = br.readU32(24); tp.hasModeS = true; }
        if (fspecHasItem(fspec, 3)) tp.timeOfDay = br.readU32(24) / 128.0;
        if (fspecHasItem(fspec, 4)) {
            const code = br.readU32(16);
            const a4 = (code >> 12) & 0x07, a3 = (code >> 8) & 0x07;
            const a2 = (code >> 4) & 0x07, a1 = code & 0x07;
            tp.trackNumber = a1 * 1000 + a2 * 100 + a3 * 10 + a4;
        }

        let rhoM = 0, thetaDeg = 0, hasRho = false, hasTheta = false;
        if (fspecHasItem(fspec, 5)) { rhoM = br.readU16(16) * (1.0 / 32.0) * 1852.0; hasRho = true; }
        if (fspecHasItem(fspec, 6)) { thetaDeg = br.readU16(16) * 360.0 / 65536.0; hasTheta = true; }
        if (hasRho && hasTheta) {
            const pos = wgs84Project(radar.radarLat, radar.radarLon, rhoM, thetaDeg);
            tp.latitude = pos.lat; tp.longitude = pos.lon; tp.hasPosition = true;
        }

        if (fspecHasItem(fspec, 7)) {
            const altCode = br.readU32(16);
            if (altCode & 0x0040) {
                const num = ((altCode & 0x001F) << 8) | ((altCode & 0x0F00) >> 4) |
                            ((altCode & 0x0020) << 5) | ((altCode & 0xE000) >> 7);
                tp.flightLevel = (num * 100 - 1200) / 100.0;
            } else {
                const num = ((altCode & 0x0010) << 4) | ((altCode & 0x000F) << 2) |
                            ((altCode & 0x0080) >> 6) | ((altCode & 0x0020) >> 5) |
                            ((altCode & 0x0F00) >> 8) | ((altCode & 0xE000) >> 11);
                tp.flightLevel = (num * 25) / 30.48 / 100.0;
            }
            tp.hasAltitude = true;
        }

        if (fspecHasItem(fspec, 8)) br.skipBits(8);
        if (fspecHasItem(fspec, 9)) br.skipBits(8);
        if (fspecHasItem(fspec, 10)) {
            const gs = br.readU16(16);
            tp.groundSpeed = gs > 16383 ? 0 : gs * 0.1;
        }
        if (fspecHasItem(fspec, 11)) tp.trackAngle = br.readU16(16) * 360.0 / 65536.0;
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
        const tp = {
            modeSAddress: 0, latitude: 0, longitude: 0, flightLevel: 0,
            trackNumber: 0, timeOfDay: 0, groundSpeed: 0, trackAngle: 0,
            hasModeS: false, hasPosition: false, hasAltitude: false, callsign: ''
        };

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
        if (fspecHasItem(fspec, 8)) { tp.latitude = br.readS32(32) * 180.0 / 2147483648.0; hasLat = true; }
        if (fspecHasItem(fspec, 9)) { tp.longitude = br.readS32(32) * 180.0 / 2147483648.0; hasLon = true; }
        if (hasLat && hasLon) tp.hasPosition = true;
        if (fspecHasItem(fspec, 10)) br.skipBits(32);
        if (fspecHasItem(fspec, 11)) br.skipBits(32);
        if (fspecHasItem(fspec, 12)) { tp.flightLevel = br.readU16(16) * 6.25 / 100.0; tp.hasAltitude = true; }
        if (fspecHasItem(fspec, 13)) br.skipBits(16);
        if (fspecHasItem(fspec, 14)) tp.groundSpeed = br.readU16(16) * 360.0 / 65536.0;
        if (fspecHasItem(fspec, 15)) tp.trackAngle = br.readU16(16) * 360.0 / 65536.0;
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

module.exports = { decodeFallback };
