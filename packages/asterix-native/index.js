'use strict';

const {
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
} = require('./src/js_fallback');

let nativeExports = null;
let nativeAvailable = false;

try {
  nativeExports = require('./build/Release/asterix_decoder.node');
  nativeAvailable = !!nativeExports && typeof nativeExports.decode === 'function';
} catch (e) {
  nativeAvailable = false;
}

function decode(buffer, options) {
  if (nativeAvailable && nativeExports.decode) {
    try {
      return nativeExports.decode(buffer, options);
    } catch (e) {
      return decodeFallback(buffer, options);
    }
  }
  return decodeFallback(buffer, options);
}

function decodeBinary(buffer, options) {
  if (nativeAvailable && nativeExports.decodeBinary) {
    try {
      return nativeExports.decodeBinary(buffer, options);
    } catch (e) {
      return decodeBinaryFallback(buffer, options);
    }
  }
  return decodeBinaryFallback(buffer, options);
}

function resetPool() {
  if (nativeAvailable && nativeExports.resetPool) {
    try { nativeExports.resetPool(); } catch (e) {}
  }
  if (gPool && typeof gPool.pool !== 'undefined') {
    gPool.pool.length = 0;
    gPool._init(2048);
  }
}

module.exports = {
  decode,
  decodeBinary,
  resetPool,
  nativeAvailable,
  TRACK_BINARY_SIZE: nativeExports && nativeExports.TRACK_BINARY_SIZE ? nativeExports.TRACK_BINARY_SIZE : TRACK_BINARY_SIZE,
  TB_FLAGS: nativeExports && nativeExports.TB_FLAGS ? nativeExports.TB_FLAGS : TB_FLAGS,
  TB_FLAGS_MODE_S: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.MODE_S) ? nativeExports.TB_FLAGS.MODE_S : 0x01,
  TB_FLAGS_POSITION: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.POSITION) ? nativeExports.TB_FLAGS.POSITION : 0x02,
  TB_FLAGS_ALTITUDE: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.ALTITUDE) ? nativeExports.TB_FLAGS.ALTITUDE : 0x04,
  TB_FLAGS_SPEED: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.SPEED) ? nativeExports.TB_FLAGS.SPEED : 0x08,
  TB_FLAGS_HEADING: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.HEADING) ? nativeExports.TB_FLAGS.HEADING : 0x10,
  TB_FLAGS_CALLSIGN: (nativeExports && nativeExports.TB_FLAGS && nativeExports.TB_FLAGS.CALLSIGN) ? nativeExports.TB_FLAGS.CALLSIGN : 0x20,
  JSTrackObjectPool,
  gPool,
  grayToBinary14,
  decodeAltitudeGillhamFE,
  clamp,
  clampI32
};
