import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RadarPpiRendererV2 } from '../webgl/RadarPpiRendererV2.js';
import { formatModeS, formatFlightLevel, formatSpeed } from '../utils/geo.js';

const LABEL_RENDER_INTERVAL = 1000 / 20;

export default function RadarDisplay({ tracksRef, connected, stats, tickFrame }) {
  const canvasRef = useRef(null);
  const labelsCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const animRef = useRef(0);
  const lastLabelRenderRef = useRef(0);
  const [rangeNm, setRangeNm] = useState(200);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredTrack, setHoveredTrack] = useState(null);
  const [mousePos, setMousePos] = useState(null);

  const getRenderer = useCallback(() => rendererRef.current, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      const r = new RadarPpiRendererV2(canvasRef.current);
      r.setCenter(39.86, 116.47);
      r.setRange(rangeNm);
      rendererRef.current = r;
    } catch (e) {
      console.error('Renderer init failed:', e);
      return;
    }

    const onResize = () => {
      if (rendererRef.current) rendererRef.current.resize();
      if (labelsCanvasRef.current) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = containerRef.current?.clientWidth || window.innerWidth;
        const h = containerRef.current?.clientHeight || window.innerHeight;
        labelsCanvasRef.current.width = Math.floor(w * dpr);
        labelsCanvasRef.current.height = Math.floor(h * dpr);
        labelsCanvasRef.current.style.width = w + 'px';
        labelsCanvasRef.current.style.height = h + 'px';
      }
    };
    onResize();
    window.addEventListener('resize', onResize);

    const loop = () => {
      const r = rendererRef.current;
      if (r) {
        r.updateTracks(tracksRef.current);
        r.render();
        tickFrame();

        const now = performance.now();
        if (now - lastLabelRenderRef.current >= LABEL_RENDER_INTERVAL) {
          lastLabelRenderRef.current = now;
          drawLabels();
        }
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [tracksRef, tickFrame]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setRange(rangeNm);
  }, [rangeNm]);

  const drawLabels = useCallback(() => {
    if (!showLabels) return;
    const canvas = labelsCanvasRef.current;
    const r = rendererRef.current;
    if (!canvas || !r) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = '11px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'top';

    const displayTracks = [];
    for (const t of tracksRef.current.values()) {
      if (!t.hasPosition) continue;
      const sp = r.getScreenPos(t);
      if (!sp || !sp.inRange) continue;
      displayTracks.push({ t, sp });
    }

    const placed = [];
    const labelW = 92;
    const labelH = 38;
    const marginX = 14;
    const marginY = 8;

    for (const { t, sp } of displayTracks) {
      const cx = sp.x;
      const cy = sp.y;
      const labelX = cx + marginX;
      const labelY = cy - labelH / 2;

      let overlaps = false;
      for (const p of placed) {
        if (labelX < p.x + p.w + 2 && labelX + labelW + 2 > p.x &&
            labelY < p.y + p.h + 2 && labelY + labelH + 2 > p.y) {
          overlaps = true; break;
        }
      }
      if (overlaps) continue;
      placed.push({ x: labelX, y: labelY, w: labelW, h: labelH });

      const fl = t.flightLevel || 0;
      let fillColor = 'rgba(0, 40, 10, 0.75)';
      let borderColor = '#00ff41';
      let textColor = '#00ff41';
      if (fl >= 400) { borderColor = '#ff4444'; textColor = '#ff6666'; fillColor = 'rgba(40, 0, 0, 0.75)'; }
      else if (fl >= 300) { borderColor = '#ffcc33'; textColor = '#ffdd66'; fillColor = 'rgba(40, 30, 0, 0.75)'; }
      else if (fl >= 200) { borderColor = '#88ff55'; textColor = '#aaff77'; fillColor = 'rgba(10, 40, 10, 0.75)'; }
      else if (fl > 0) { borderColor = '#44ccff'; textColor = '#66ddff'; fillColor = 'rgba(0, 20, 40, 0.75)'; }

      ctx.fillStyle = fillColor;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(labelX, labelY, labelW, labelH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textColor;
      const id = t.callsign?.trim() || (t.modeSAddress ? formatModeS(t.modeSAddress) : '??????');
      ctx.fillText(id, labelX + 5, labelY + 3);
      ctx.fillText(formatFlightLevel(t.flightLevel) + ' ' + formatSpeed(t.groundSpeed), labelX + 5, labelY + 17);
    }
  }, [showLabels, tracksRef]);

  const onMouseMove = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    const r = rendererRef.current;
    if (!r) return;

    let best = null;
    let bestDist = 25;
    for (const t of tracksRef.current.values()) {
      if (!t.hasPosition) continue;
      const sp = r.getScreenPos(t);
      if (!sp || !sp.inRange) continue;
      const dx = sp.x - x;
      const dy = sp.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = { t, sp };
      }
    }
    setHoveredTrack(best ? best.t : null);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const ranges = [40, 80, 120, 200, 300, 400];
    const idx = ranges.indexOf(rangeNm);
    const newIdx = Math.max(0, Math.min(ranges.length - 1, idx + (e.deltaY > 0 ? 1 : -1)));
    setRangeNm(ranges[newIdx]);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0,
        cursor: 'crosshair',
        background: '#000'
      }}
      onMouseMove={onMouseMove}
      onWheel={onWheel}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%'
        }}
      />
      <canvas
        ref={labelsCanvasRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none'
        }}
      />

      <div style={{
        position: 'absolute', top: 12, left: 12,
        padding: '8px 14px',
        background: 'rgba(0, 20, 5, 0.75)',
        border: '1px solid #00ff41',
        fontSize: 12,
        lineHeight: 1.7,
        color: '#00ff41',
        letterSpacing: 0.5
      }}>
        <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4, letterSpacing: 2 }}>
          ◉ SSR RADAR PPI
        </div>
        <div>RANGE: <span style={{ color: '#ffcc33' }}>{rangeNm}NM</span></div>
        <div>TRACKS: <span style={{ color: '#66ddff' }}>{stats.count}</span></div>
        <div>FPS: <span style={{ color: stats.fps >= 18 ? '#00ff41' : '#ff6666' }}>{stats.fps}</span>/20</div>
        <div>LINK: {connected ? <span style={{ color: '#00ff41' }}>● ONLINE</span> : <span style={{ color: '#ff6666' }}>○ OFFLINE</span>}</div>
      </div>

      <div style={{
        position: 'absolute', top: 12, right: 12,
        padding: '8px 14px',
        background: 'rgba(0, 20, 5, 0.75)',
        border: '1px solid #00ff41',
        fontSize: 11,
        lineHeight: 1.8,
        color: '#00ff41',
        letterSpacing: 0.5
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>FLIGHT LEVELS</div>
        <div><span style={{ color: '#ff4444' }}>■</span> FL400+</div>
        <div><span style={{ color: '#ffcc33' }}>■</span> FL300-400</div>
        <div><span style={{ color: '#88ff55' }}>■</span> FL200-300</div>
        <div><span style={{ color: '#44ccff' }}>■</span> FL100-200</div>
        <div><span style={{ color: '#00ff41' }}>■</span> BELOW FL100</div>
      </div>

      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        padding: '6px 12px',
        background: 'rgba(0, 20, 5, 0.75)',
        border: '1px solid #00ff41',
        fontSize: 11,
        color: '#00ff41'
      }}>
        [滚轮] 缩放量程 · [悬停] 查看详情
      </div>

      {hoveredTrack && mousePos && (
        <div style={{
          position: 'absolute',
          left: Math.min(mousePos.x + 14, window.innerWidth - 220),
          top: Math.min(mousePos.y + 14, window.innerHeight - 160),
          padding: '10px 14px',
          background: 'rgba(0, 20, 5, 0.92)',
          border: '1px solid #ffcc33',
          fontSize: 12,
          lineHeight: 1.8,
          color: '#ffcc33',
          minWidth: 200,
          pointerEvents: 'none',
          boxShadow: '0 0 20px rgba(255, 204, 51, 0.25)'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 6, color: '#fff' }}>
            {hoveredTrack.callsign?.trim() || (hoveredTrack.modeSAddress ? formatModeS(hoveredTrack.modeSAddress) : 'UNKNOWN')}
          </div>
          {hoveredTrack.modeSAddress ? <div>MODE-S: 0x{formatModeS(hoveredTrack.modeSAddress)}</div> : null}
          <div>LAT: {hoveredTrack.latitude?.toFixed(4)}°</div>
          <div>LON: {hoveredTrack.longitude?.toFixed(4)}°</div>
          <div>ALT: {formatFlightLevel(hoveredTrack.flightLevel)}</div>
          <div>SPD: {formatSpeed(hoveredTrack.groundSpeed)}</div>
          <div>HDG: {hoveredTrack.trackAngle ? Math.round(hoveredTrack.trackAngle) + '°' : '---'}</div>
          <div>TRACK: {hoveredTrack.trackNumber || '---'}</div>
        </div>
      )}
    </div>
  );
}
