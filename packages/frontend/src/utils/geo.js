const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const EARTH_RADIUS_M = 6371000.0;

export function projectToLocal(lat, lon, centerLat, centerLon) {
  const lat1 = centerLat * DEG2RAD;
  const lat2 = lat * DEG2RAD;
  const dLat = (lat - centerLat) * DEG2RAD;
  const dLon = (lon - centerLon) * DEG2RAD;

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_M * c;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * RAD2DEG;

  const b = bearing * DEG2RAD;
  return {
    x: distance * Math.sin(b),
    y: distance * Math.cos(b)
  };
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 1, b: 0.25 };
}

export function rgbToVec(r, g, b, a = 1.0) {
  return new Float32Array([r, g, b, a]);
}

export function formatModeS(addr) {
  return addr.toString(16).toUpperCase().padStart(6, '0');
}

export function formatFlightLevel(fl) {
  if (!fl || fl <= 0) return '---';
  return 'FL' + Math.round(fl).toString().padStart(3, '0');
}

export function formatSpeed(gs) {
  if (!gs || gs <= 0) return '---';
  return Math.round(gs) + 'kt';
}
