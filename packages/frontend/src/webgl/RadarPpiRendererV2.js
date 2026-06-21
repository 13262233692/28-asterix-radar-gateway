import { projectToLocal, hexToRgb } from '../utils/geo.js';

const VERT_SHADER = `
  attribute vec2 a_position;
  attribute vec3 a_color;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  varying vec3 v_color;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`;

const FRAG_SHADER = `
  precision mediump float;
  varying vec3 v_color;
  uniform float u_alpha;
  void main() {
    gl_FragColor = vec4(v_color, u_alpha);
  }
`;

const DASHED_VERT = `
  attribute vec2 a_position;
  attribute float a_distance;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  uniform float u_worldScale;
  varying float v_distance;
  void main() {
    vec2 scaled = a_position * u_scale * u_worldScale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_distance = a_distance;
  }
`;

const DASHED_FRAG = `
  precision mediump float;
  varying float v_distance;
  uniform vec3 u_color;
  uniform float u_alpha;
  uniform float u_dash;
  uniform float u_gap;
  void main() {
    float pattern = u_dash + u_gap;
    float pos = mod(v_distance, pattern);
    if (pos > u_dash) discard;
    gl_FragColor = vec4(u_color, u_alpha);
  }
`;

const TRAIL_VERT = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  varying vec4 v_color;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`;

const TRAIL_FRAG = `
  precision mediump float;
  varying vec4 v_color;
  void main() {
    gl_FragColor = v_color;
  }
`;

const SWEEP_VERT = `
  attribute vec2 a_position;
  uniform vec2 u_center;
  uniform float u_radius;
  varying vec2 v_texCoord;
  void main() {
    vec2 p = a_position * u_radius + u_center;
    gl_Position = vec4(p, 0.0, 1.0);
    v_texCoord = a_position * u_radius;
  }
`;

const SWEEP_FRAG = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform vec2 u_centerPx;
  uniform float u_radiusPx;
  uniform float u_sweepAngle;
  uniform float u_sweepWidth;
  void main() {
    vec2 pc = v_texCoord;
    float dist = length(pc);
    if (dist > u_radiusPx) discard;

    float angle = atan(pc.y, pc.x);
    float angDeg = degrees(angle);
    if (angDeg < 0.0) angDeg += 360.0;

    float sweepEnd = u_sweepAngle;
    float sweepStart = sweepEnd - u_sweepWidth;
    float wrapped = sweepStart < 0.0;

    float inSweep = 0.0;
    if (wrapped) {
      if (angDeg >= sweepStart + 360.0 || angDeg <= sweepEnd) inSweep = 1.0;
    } else {
      if (angDeg >= sweepStart && angDeg <= sweepEnd) inSweep = 1.0;
    }
    if (inSweep < 0.5) discard;

    float distFromEnd = 0.0;
    if (wrapped) {
      float d = sweepEnd - angDeg;
      if (d < 0.0) d += 360.0;
      distFromEnd = d / u_sweepWidth;
    } else {
      distFromEnd = (sweepEnd - angDeg) / u_sweepWidth;
    }
    distFromEnd = clamp(distFromEnd, 0.0, 1.0);

    float intensity = pow(1.0 - distFromEnd, 2.0);
    float radial = 1.0 - (dist / u_radiusPx) * 0.4;

    gl_FragColor = vec4(0.0, 1.0, 0.25, intensity * 0.32 * radial);
  }
`;

export class RadarPpiRendererV2 {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;

    this.tracks = new Map();
    this.width = 0;
    this.height = 0;
    this.centerPx = { x: 0, y: 0 };
    this.rangeNm = 200;
    this.centerLat = 39.86;
    this.centerLon = 116.47;
    this.metersPerPx = 1;
    this.sweepAngle = 0;
    this.lastTime = performance.now();
    this.sweepRpm = 15;

    this._init();
    this.resize();
  }

  _init() {
    const gl = this.gl;
    this.basic = this._makeProgram(VERT_SHADER, FRAG_SHADER, ['a_position', 'a_color']);
    this.dashed = this._makeProgram(DASHED_VERT, DASHED_FRAG, ['a_position', 'a_distance']);
    this.trail = this._makeProgram(TRAIL_VERT, TRAIL_FRAG, ['a_position', 'a_color']);
    this.sweep = this._makeProgram(SWEEP_VERT, SWEEP_FRAG, ['a_position']);

    this._buildStaticGeometry();

    this.planeBuf = gl.createBuffer();
    this.planeCount = 0;
    this.trailBuf = gl.createBuffer();
    this.trailCount = 0;
  }

  _makeProgram(vsSrc, fsSrc, attribs) {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    const out = { program: p };
    for (const a of attribs) out[a] = gl.getAttribLocation(p, a);
    return out;
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  _buildStaticGeometry() {
    const gl = this.gl;

    const ringSegments = 512;
    const ringCount = 5;
    const ringVerts = [];
    const ringDist = [];
    for (let r = 1; r <= ringCount; r++) {
      const rad = r / ringCount;
      const circ = 2 * Math.PI * rad;
      for (let i = 0; i <= ringSegments; i++) {
        const a = (i / ringSegments) * Math.PI * 2;
        ringVerts.push(Math.cos(a) * rad, Math.sin(a) * rad);
        ringDist.push((i / ringSegments) * circ);
      }
    }
    this.ringVertexCount = (ringSegments + 1) * ringCount;
    this.ringBuf = gl.createBuffer();
    const ringData = new Float32Array(ringVerts.length + ringDist.length);
    for (let i = 0; i < ringVerts.length / 2; i++) {
      ringData[i * 3] = ringVerts[i * 2];
      ringData[i * 3 + 1] = ringVerts[i * 2 + 1];
      ringData[i * 3 + 2] = ringDist[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ringData, gl.STATIC_DRAW);

    const azCount = 72;
    const azVerts = [];
    const azDist = [];
    for (let i = 0; i < azCount; i++) {
      const a = (i / azCount) * Math.PI * 2;
      azVerts.push(0, 0, Math.cos(a), Math.sin(a));
      azDist.push(0, 1);
    }
    this.azVertexCount = azCount * 2;
    this.azBuf = gl.createBuffer();
    const azData = new Float32Array(azVerts.length + azDist.length);
    for (let i = 0; i < azVerts.length / 2; i++) {
      azData[i * 3] = azVerts[i * 2];
      azData[i * 3 + 1] = azVerts[i * 2 + 1];
      azData[i * 3 + 2] = azDist[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.azBuf);
    gl.bufferData(gl.ARRAY_BUFFER, azData, gl.STATIC_DRAW);

    const sq = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);
    this.sqBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sqBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sq, gl.STATIC_DRAW);
  }

  _flColorForFL(fl) {
    if (!fl || fl <= 0) return [0.4, 0.4, 0.4];
    if (fl >= 400) return [1.0, 0.2, 0.2];
    if (fl >= 350) return [1.0, 0.4, 0.3];
    if (fl >= 300) return [1.0, 0.7, 0.2];
    if (fl >= 250) return [1.0, 1.0, 0.2];
    if (fl >= 200) return [0.6, 1.0, 0.3];
    if (fl >= 150) return [0.2, 1.0, 0.8];
    if (fl >= 100) return [0.3, 0.8, 1.0];
    return [0.0, 1.0, 0.25];
  }

  setCenter(lat, lon) { this.centerLat = lat; this.centerLon = lon; }
  setRange(nm) { this.rangeNm = nm; this.resize(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.centerPx.x = this.width / 2;
    this.centerPx.y = this.height / 2;
    const minDim = Math.min(this.width, this.height);
    this.radiusPx = minDim / 2;
    this.metersPerPx = (this.rangeNm * 1852) / this.radiusPx;
    this.gl.viewport(0, 0, this.width, this.height);
  }

  updateTracks(map) { this.tracks = map; }

  _project(track) {
    if (!track.hasPosition) return null;
    return projectToLocal(track.latitude, track.longitude, this.centerLat, this.centerLon);
  }

  _updatePlaneBuffer() {
    const gl = this.gl;
    const positions = [];
    const colors = [];
    const sizePx = 6.0;
    const sizeM = sizePx * this.metersPerPx;
    const triSize = sizeM;

    for (const t of this.tracks.values()) {
      const pos = this._project(t);
      if (!pos) continue;
      const distM = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
      if (distM > this.rangeNm * 1852) continue;

      const col = this._flColorForFL(t.flightLevel);

      const heading = (t.trackAngle || 0) * Math.PI / 180;
      const ch = Math.cos(heading);
      const sh = Math.sin(heading);

      const frontX = ch * triSize * 1.8;
      const frontY = sh * triSize * 1.8;
      const backLX = -ch * triSize - sh * triSize * 0.8;
      const backLY = -sh * triSize + ch * triSize * 0.8;
      const backRX = -ch * triSize + sh * triSize * 0.8;
      const backRY = -sh * triSize - ch * triSize * 0.8;

      positions.push(
        pos.x + frontX, pos.y + frontY,
        pos.x + backLX, pos.y + backLY,
        pos.x + backRX, pos.y + backRY
      );
      for (let i = 0; i < 3; i++) colors.push(...col);
    }

    this.planeCount = positions.length / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuf);
    const data = new Float32Array(positions.length + colors.length);
    for (let i = 0; i < positions.length / 2; i++) {
      data[i * 5] = positions[i * 2];
      data[i * 5 + 1] = positions[i * 2 + 1];
      data[i * 5 + 2] = colors[i * 3];
      data[i * 5 + 3] = colors[i * 3 + 1];
      data[i * 5 + 4] = colors[i * 3 + 2];
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  _updateTrailBuffer() {
    const gl = this.gl;
    const positions = [];
    const colors = [];
    const maxPointsPerTrail = 60;

    for (const t of this.tracks.values()) {
      const trail = t.trail;
      if (!trail || trail.length < 2) continue;
      const col = this._flColorForFL(t.flightLevel);
      const startIdx = Math.max(0, trail.length - maxPointsPerTrail);

      for (let i = startIdx; i < trail.length - 1; i++) {
        const p1 = projectToLocal(trail[i].lat, trail[i].lon, this.centerLat, this.centerLon);
        const p2 = projectToLocal(trail[i + 1].lat, trail[i + 1].lon, this.centerLat, this.centerLon);

        const d1 = Math.sqrt(p1.x * p1.x + p1.y * p1.y);
        const d2 = Math.sqrt(p2.x * p2.x + p2.y * p2.y);
        if (d1 > this.rangeNm * 1852 || d2 > this.rangeNm * 1852) continue;

        const totalPoints = trail.length - startIdx - 1;
        const alpha1 = ((i - startIdx) / totalPoints) * 0.7;
        const alpha2 = ((i + 1 - startIdx) / totalPoints) * 0.7;

        positions.push(p1.x, p1.y, p2.x, p2.y);
        colors.push(col[0], col[1], col[2], alpha1);
        colors.push(col[0], col[1], col[2], alpha2);
      }
    }

    this.trailCount = positions.length / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    const data = new Float32Array(positions.length + colors.length);
    let di = 0;
    for (let i = 0; i < positions.length / 2; i++) {
      data[di++] = positions[i * 2];
      data[di++] = positions[i * 2 + 1];
      data[di++] = colors[i * 4];
      data[di++] = colors[i * 4 + 1];
      data[di++] = colors[i * 4 + 2];
      data[di++] = colors[i * 4 + 3];
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  render() {
    const gl = this.gl;
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.sweepAngle = (this.sweepAngle + (360 * this.sweepRpm / 60) * dt) % 360;

    gl.clearColor(0.0, 0.015, 0.005, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._updatePlaneBuffer();
    this._updateTrailBuffer();

    this._drawSweep();
    this._drawAzimuth();
    this._drawRings();
    this._drawTrails();
    this._drawPlanes();
  }

  _drawSweep() {
    const gl = this.gl;
    const p = this.sweep;
    gl.useProgram(p.program);

    const halfW = this.width / this.width;
    const halfH = this.height / this.height;

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'),
      (this.centerPx.x / this.width) * 2 - 1,
      -((this.centerPx.y / this.height) * 2 - 1));
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_radius'),
      this.radiusPx / this.width * 2);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_centerPx'), 0, 0);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_radiusPx'), this.radiusPx);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_sweepAngle'), this.sweepAngle);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_sweepWidth'), 30.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sqBuf);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawRings() {
    const gl = this.gl;
    const p = this.dashed;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.centerPx.x, this.centerPx.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), 1.0);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_worldScale'), this.radiusPx);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0.0, 0.7, 0.2);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 0.55);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_dash'), 0.015);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_gap'), 0.01);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuf);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(p.a_distance);
    gl.vertexAttribPointer(p.a_distance, 1, gl.FLOAT, false, 12, 8);

    for (let r = 0; r < 5; r++) {
      gl.drawArrays(gl.LINE_STRIP, r * 513, 513);
    }
  }

  _drawAzimuth() {
    const gl = this.gl;
    const p = this.dashed;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.centerPx.x, this.centerPx.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), 1.0);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_worldScale'), this.radiusPx);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0.0, 0.5, 0.15);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 0.4);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_dash'), 0.02);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_gap'), 0.04);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.azBuf);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(p.a_distance);
    gl.vertexAttribPointer(p.a_distance, 1, gl.FLOAT, false, 12, 8);

    gl.drawArrays(gl.LINES, 0, this.azVertexCount);
  }

  _drawTrails() {
    if (this.trailCount === 0) return;
    const gl = this.gl;
    const p = this.trail;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.centerPx.x, this.centerPx.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), 1.0 / this.metersPerPx);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(p.a_color);
    gl.vertexAttribPointer(p.a_color, 4, gl.FLOAT, false, 24, 8);

    gl.lineWidth(1.5);
    gl.drawArrays(gl.LINES, 0, this.trailCount);
  }

  _drawPlanes() {
    if (this.planeCount === 0) return;
    const gl = this.gl;
    const p = this.basic;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.centerPx.x, this.centerPx.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), 1.0 / this.metersPerPx);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuf);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(p.a_color);
    gl.vertexAttribPointer(p.a_color, 3, gl.FLOAT, false, 20, 8);

    gl.drawArrays(gl.TRIANGLES, 0, this.planeCount);
  }

  getScreenPos(track) {
    const pos = this._project(track);
    if (!pos) return null;
    return {
      x: pos.x / this.metersPerPx + this.centerPx.x,
      y: pos.y / this.metersPerPx + this.centerPx.y,
      inRange: Math.sqrt(pos.x * pos.x + pos.y * pos.y) <= this.rangeNm * 1852
    };
  }
}
