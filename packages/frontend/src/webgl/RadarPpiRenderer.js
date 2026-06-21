import { projectToLocal, hexToRgb } from './geo.js';

const VERT_SHADER_SRC = `
  attribute vec2 a_position;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  varying vec2 v_texCoord;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_texCoord = a_position;
  }
`;

const FRAG_SHADER_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform vec3 u_color;
  uniform float u_alpha;
  void main() {
    gl_FragColor = vec4(u_color, u_alpha);
  }
`;

const DASHED_VERT = `
  attribute vec2 a_position;
  attribute float a_distance;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  uniform float u_totalLength;
  varying float v_distance;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
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
  uniform float u_dashLength;
  uniform float u_gapLength;
  void main() {
    float pattern = u_dashLength + u_gapLength;
    float pos = mod(v_distance, pattern);
    if (pos > u_dashLength) discard;
    gl_FragColor = vec4(u_color, u_alpha);
  }
`;

const SWEEP_VERT = `
  attribute vec2 a_position;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const SWEEP_FRAG = `
  precision mediump float;
  uniform vec2 u_texCoord;
  uniform float u_sweepAngle;
  uniform float u_sweepWidth;
  uniform float u_time;
  uniform float u_radiusPx;
  uniform vec2 u_centerPx;

  void main() {
    vec2 pc = gl_FragCoord.xy - u_centerPx;
    float dist = length(pc);
    if (dist > u_radiusPx) discard;

    float angle = atan(pc.y, pc.x);
    float angDeg = degrees(angle);
    if (angDeg < 0.0) angDeg += 360.0;

    float sweepEnd = u_sweepAngle;
    float sweepStart = sweepEnd - u_sweepWidth;
    if (sweepStart < 0.0) sweepStart += 360.0;

    float inSweep = 0.0;
    if (sweepEnd > u_sweepWidth) {
      if (angDeg >= sweepStart && angDeg <= sweepEnd) inSweep = 1.0;
    } else {
      if (angDeg >= sweepStart || angDeg <= sweepEnd) inSweep = 1.0;
    }

    if (inSweep < 0.5) discard;

    float distFromEnd = 0.0;
    if (sweepEnd > u_sweepWidth) {
      distFromEnd = (sweepEnd - angDeg) / u_sweepWidth;
    } else {
      float d = sweepEnd - angDeg;
      if (d < 0.0) d += 360.0;
      distFromEnd = d / u_sweepWidth;
    }

    float intensity = pow(1.0 - distFromEnd, 2.0);
    float radialFade = 1.0 - (dist / u_radiusPx) * 0.3;

    gl_FragColor = vec4(0.0, 1.0, 0.25, intensity * 0.35 * radialFade);
  }
`;

export class RadarPpiRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error('WebGL not supported');

    this.tracks = new Map();
    this.width = 0;
    this.height = 0;
    this.center = { x: 0, y: 0 };
    this.scale = 1.0;
    this.rangeNm = 200;
    this.centerLat = 39.86;
    this.centerLon = 116.47;
    this.sweepAngle = 0;
    this.lastFrameTime = performance.now();
    this.sweepSpeed = 360.0 / 4.0;

    this._initShaders();
    this._initBuffers();
    this.resize();
  }

  _compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _createProgram(vs, fs, attributes) {
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, this._compileShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, this._compileShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    const ret = { program };
    for (const a of attributes || []) {
      ret[a] = gl.getAttribLocation(program, a);
    }
    return ret;
  }

  _initShaders() {
    this.basicProg = this._createProgram(VERT_SHADER_SRC, FRAG_SHADER_SRC, ['a_position']);
    this.dashedProg = this._createProgram(DASHED_VERT, DASHED_FRAG, ['a_position', 'a_distance']);
    this.sweepProg = this._createProgram(SWEEP_VERT, SWEEP_FRAG, ['a_position']);
  }

  _initBuffers() {
    this.circleBuffer = this.gl.createBuffer();
    this.rangeRingCount = 0;

    this.azimuthBuffer = this.gl.createBuffer();
    this.azimuthIdxCount = 0;

    this.planeBuffer = this.gl.createBuffer();
    this.trailBuffer = this.gl.createBuffer();

    const square = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.squareBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, square, this.gl.STATIC_DRAW);
  }

  _buildRangeRings() {
    const segments = 256;
    const rings = 5;
    const vertices = [];
    const distances = [];

    for (let r = 1; r <= rings; r++) {
      const radius = (r / rings);
      const circumference = 2 * Math.PI * radius;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
        distances.push((i / segments) * circumference);
      }
    }

    this.rangeRingCount = (segments + 1) * rings;

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.circleBuffer);
    const data = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length / 2; i++) {
      data[i * 3] = vertices[i * 2];
      data[i * 3 + 1] = vertices[i * 2 + 1];
      data[i * 3 + 2] = distances[i];
    }
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
  }

  _buildAzimuthLines() {
    const count = 36;
    const vertices = [];
    const distances = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const cx = Math.cos(angle);
      const cy = Math.sin(angle);
      vertices.push(0, 0, cx, cy);
      distances.push(0, 1);
    }
    this.azimuthIdxCount = count * 2;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.azimuthBuffer);
    const data = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length / 2; i++) {
      data[i * 3] = vertices[i * 2];
      data[i * 3 + 1] = vertices[i * 2 + 1];
      data[i * 3 + 2] = distances[i];
    }
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
  }

  setCenter(lat, lon) {
    this.centerLat = lat;
    this.centerLon = lon;
  }

  setRange(rangeNm) {
    this.rangeNm = rangeNm;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.center.x = this.width / 2;
    this.center.y = this.height / 2;

    const pxPerNm = Math.min(this.width, this.height) / 2 / this.rangeNm;
    this.scale = pxPerNm * 1852;
    this.displayRadius = Math.min(this.width, this.height) / 2;

    this.gl.viewport(0, 0, this.width, this.height);
    this._buildRangeRings();
    this._buildAzimuthLines();
  }

  updateTracks(trackMap) {
    this.tracks = trackMap;
  }

  _projectTrack(track) {
    if (!track.hasPosition) return null;
    return projectToLocal(track.latitude, track.longitude, this.centerLat, this.centerLon);
  }

  _updatePlaneBuffers() {
    const gl = this.gl;
    const positions = [];
    const colors = [];

    const planeSize = 8.0;

    for (const track of this.tracks.values()) {
      const pos = this._projectTrack(track);
      if (!pos) continue;

      const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
      if (dist > this.rangeNm * 1852) continue;

      const px = pos.x;
      const py = pos.y;

      let color = [0.0, 1.0, 0.25];
      const fl = track.flightLevel || 0;
      if (fl >= 350) color = [1.0, 0.3, 0.3];
      else if (fl >= 250) color = [1.0, 0.8, 0.2];
      else if (fl >= 150) color = [0.3, 0.9, 1.0];
      else if (fl > 0) color = [0.0, 1.0, 0.25];

      const s = planeSize;
      positions.push(px - s, py - s, px + s, py - s, px - s, py + s);
      positions.push(px - s, py + s, px + s, py - s, px + s, py + s);

      for (let i = 0; i < 6; i++) colors.push(...color);
    }

    this.planeCount = positions.length / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
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

  _updateTrailBuffers() {
    const gl = this.gl;
    const positions = [];
    const colors = [];

    for (const track of this.tracks.values()) {
      const trail = track.trail;
      if (!trail || trail.length < 2) continue;

      let color = [0.0, 1.0, 0.25];
      const fl = track.flightLevel || 0;
      if (fl >= 350) color = [1.0, 0.3, 0.3];
      else if (fl >= 250) color = [1.0, 0.8, 0.2];
      else if (fl >= 150) color = [0.3, 0.9, 1.0];

      for (let i = 0; i < trail.length - 1; i++) {
        const p1 = projectToLocal(trail[i].lat, trail[i].lon, this.centerLat, this.centerLon);
        const p2 = projectToLocal(trail[i + 1].lat, trail[i + 1].lon, this.centerLat, this.centerLon);

        const d1 = Math.sqrt(p1.x * p1.x + p1.y * p1.y);
        const d2 = Math.sqrt(p2.x * p2.x + p2.y * p2.y);
        if (d1 > this.rangeNm * 1852 || d2 > this.rangeNm * 1852) continue;

        const fade = i / (trail.length - 1);
        const alpha = fade * 0.6;

        positions.push(p1.x, p1.y, p2.x, p2.y);
        colors.push(color[0], color[1], color[2], alpha, color[0], color[1], color[2], alpha * 0.9);
      }
    }

    this.trailCount = positions.length / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuffer);
    const totalFloats = positions.length + colors.length;
    const data = new Float32Array(totalFloats);
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
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    this.sweepAngle = (this.sweepAngle + this.sweepSpeed * dt) % 360;

    gl.clearColor(0.0, 0.015, 0.005, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.lineWidth(1);

    this._updatePlaneBuffers();
    this._updateTrailBuffers();

    this._drawSweep();
    this._drawAzimuthLines();
    this._drawRangeRings();
    this._drawTrails();
    this._drawPlanes();
  }

  _drawRangeRings() {
    const gl = this.gl;
    const p = this.dashedProg;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.center.x, this.center.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), this.scale * this.rangeNm * 1852);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0.0, 0.7, 0.2);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 0.5);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_dashLength'), 0.02);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_gapLength'), 0.01);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_totalLength'), 2 * Math.PI);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleBuffer);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(p.a_distance);
    gl.vertexAttribPointer(p.a_distance, 1, gl.FLOAT, false, 12, 8);

    for (let r = 0; r < 5; r++) {
      const offset = r * (257) * 12;
      gl.drawArrays(gl.LINE_STRIP, r * 257, 257);
    }
  }

  _drawAzimuthLines() {
    const gl = this.gl;
    const p = this.dashedProg;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.center.x, this.center.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), this.scale * this.rangeNm * 1852);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0.0, 0.55, 0.15);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 0.35);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_dashLength'), 0.03);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_gapLength'), 0.03);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_totalLength'), 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.azimuthBuffer);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(p.a_distance);
    gl.vertexAttribPointer(p.a_distance, 1, gl.FLOAT, false, 12, 8);

    gl.drawArrays(gl.LINES, 0, this.azimuthIdxCount);
  }

  _drawSweep() {
    const gl = this.gl;
    const p = this.sweepProg;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.center.x, this.center.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), this.scale * this.rangeNm * 1852);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_sweepAngle'), this.sweepAngle);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_sweepWidth'), 25.0);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_time'), performance.now() / 1000);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_radiusPx'), this.displayRadius);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_centerPx'), this.center.x, this.center.y);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.squareBuffer);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawPlanes() {
    if (this.planeCount === 0) return;
    const gl = this.gl;
    const p = this.basicProg;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.center.x, this.center.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), this.scale);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 1.0);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0, 1, 0.25);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 20, 0);

    const colorLoc = gl.getAttribLocation(p.program, 'a_color');
    if (colorLoc >= 0) {
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 20, 8);
      gl.disableVertexAttribArray(colorLoc);
    }

    for (let i = 0; i < this.planeCount; i += 6) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
      const data = new Float32Array(2 * 6);
      for (let j = 0; j < 6; j++) {
        data[j * 2] = (this.planeBuffer ? 0 : 0);
      }

      const stride = 20;
      const off = i * stride;
      const floatOff = off / 4;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const verts = new Float32Array(12);
      const cols = new Float32Array(18);
      const combined = new Float32Array(30);
      for (let v = 0; v < 6; v++) {
        const srcOff = (i + v) * 5;
        combined[v * 5] = 0;
        combined[v * 5 + 1] = 0;
        combined[v * 5 + 2] = 0;
        combined[v * 5 + 3] = 0;
        combined[v * 5 + 4] = 0;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
      gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 20, i * 20);
      gl.drawArrays(gl.TRIANGLES, i, 6);
      gl.deleteBuffer(buf);
    }
  }

  _drawTrails() {
    if (this.trailCount === 0) return;
    const gl = this.gl;
    const p = this.basicProg;
    gl.useProgram(p.program);

    gl.uniform2f(gl.getUniformLocation(p.program, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(p.program, 'u_center'), this.center.x, this.center.y);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_scale'), this.scale);
    gl.uniform3f(gl.getUniformLocation(p.program, 'u_color'), 0, 1, 0.25);
    gl.uniform1f(gl.getUniformLocation(p.program, 'u_alpha'), 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuffer);
    gl.enableVertexAttribArray(p.a_position);
    gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 24, 0);

    for (let i = 0; i < this.trailCount; i += 2) {
      gl.vertexAttribPointer(p.a_position, 2, gl.FLOAT, false, 24, i * 24);
      gl.drawArrays(gl.LINES, i, 2);
    }
  }

  getScreenPos(track) {
    const pos = this._projectTrack(track);
    if (!pos) return null;
    const cx = pos.x * this.scale + this.center.x;
    const cy = pos.y * this.scale + this.center.y;
    return { x: cx, y: cy, inRange: Math.sqrt(pos.x * pos.x + pos.y * pos.y) <= this.rangeNm * 1852 };
  }
}
