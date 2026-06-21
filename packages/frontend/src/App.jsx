import React from 'react';
import RadarDisplay from './components/RadarDisplay.jsx';
import { useTrackStore } from './hooks/useTrackStore.js';

const WS_URL = (typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'ws://localhost:8091'
  : `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8091`;

export default function App() {
  const { tracksRef, stcaConflictsRef, stcaConflictKeysRef, connected, stats, tickFrame } = useTrackStore(WS_URL);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <RadarDisplay
        tracksRef={tracksRef}
        stcaConflictsRef={stcaConflictsRef}
        stcaConflictKeysRef={stcaConflictKeysRef}
        connected={connected}
        stats={stats}
        tickFrame={tickFrame}
      />
    </div>
  );
}
