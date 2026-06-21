import { useEffect, useRef, useState, useCallback } from 'react';

export function useTrackStore(wsUrl) {
  const tracksRef = useRef(new Map());
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0, fps: 0 });
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const listenersRef = useRef(new Set());

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const notify = useCallback(() => {
    for (const fn of listenersRef.current) {
      try { fn(tracksRef.current); } catch (e) {}
    }
  }, []);

  const applyTrackUpdate = useCallback((track) => {
    const existing = tracksRef.current.get(track.key);
    if (!existing) {
      tracksRef.current.set(track.key, { ...track });
    } else {
      const merged = { ...existing };
      if (track.hasPosition) {
        merged.latitude = track.latitude;
        merged.longitude = track.longitude;
        merged.hasPosition = true;
      }
      if (track.hasAltitude) merged.flightLevel = track.flightLevel;
      if (track.hasModeS) merged.modeSAddress = track.modeSAddress;
      if (track.callsign && track.callsign.trim()) merged.callsign = track.callsign.trim();
      if (track.groundSpeed) merged.groundSpeed = track.groundSpeed;
      if (track.trackAngle) merged.trackAngle = track.trackAngle;
      if (track.trail && track.trail.length > 0) {
        merged.trail = track.trail;
      }
      merged.lastUpdate = Date.now();
      tracksRef.current.set(track.key, merged);
    }
  }, []);

  useEffect(() => {
    let ws;
    let reconnectTimer;
    const RECONNECT_DELAY = 2000;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'snapshot') {
            tracksRef.current = new Map();
            for (const t of msg.tracks) {
              if (t.hasPosition) {
                tracksRef.current.set(t.key, { ...t, lastUpdate: Date.now() });
              }
            }
            setStats(s => ({ ...s, count: tracksRef.current.size }));
            notify();
          } else if (msg.type === 'update') {
            for (const t of msg.tracks) {
              if (t.hasPosition) applyTrackUpdate(t);
            }
            setStats(s => ({ ...s, count: tracksRef.current.size }));
            notify();
          } else if (msg.type === 'cleanup') {
            for (const [key, t] of tracksRef.current) {
              if (Date.now() - (t.lastUpdate || 0) > 60000) {
                tracksRef.current.delete(key);
              }
            }
            setStats(s => ({ ...s, count: tracksRef.current.size }));
            notify();
          }
        } catch (e) {
          console.warn('WS parse error', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) {}
      };
    };

    const scheduleReconnect = () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      try { ws.close(); } catch (e) {}
    };
  }, [wsUrl, applyTrackUpdate, notify]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFpsTimeRef.current) / 1000;
      setStats(s => ({ ...s, fps: Math.round(frameCountRef.current / elapsed) }));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const tickFrame = useCallback(() => {
    frameCountRef.current++;
  }, []);

  return {
    tracksRef,
    connected,
    stats,
    subscribe,
    tickFrame
  };
}
