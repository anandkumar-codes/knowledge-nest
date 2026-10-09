import { useEffect, useMemo, useState } from 'react';

const ROWS = 6;
const COLS = 10;
const TOTAL = ROWS * COLS;

// Deterministic initial layout so the first paint looks intentional.
function initialSeats() {
  return Array.from({ length: TOTAL }, (_, i) => {
    const r = (i * 37) % 100;
    if (r < 58) return 'occupied';
    if (r < 70) return 'reserved';
    return 'free';
  });
}

const NEXT = { free: 'occupied', occupied: 'free', reserved: 'occupied' };

export default function SeatMap() {
  const [seats, setSeats] = useState(initialSeats);
  const [pulse, setPulse] = useState(-1);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      const i = Math.floor(Math.random() * TOTAL);
      setSeats((s) => s.map((v, idx) => (idx === i ? NEXT[v] : v)));
      setPulse(i);
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(
    () => seats.reduce((acc, s) => ({ ...acc, [s]: acc[s] + 1 }), { occupied: 0, reserved: 0, free: 0 }),
    [seats]
  );
  const pct = Math.round((counts.occupied / TOTAL) * 100);

  return (
    <div className="seatmap" aria-hidden="true">
      <div className="seatmap-head">
        <div className="seatmap-title">
          <span className="live-dot" /> Live floor · Hall A
        </div>
        <div className="seatmap-pct">
          {pct}%<small> occupied</small>
        </div>
      </div>

      <div className="seatmap-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {seats.map((s, i) => (
          <span
            key={i}
            className={`seat seat-${s}${pulse === i ? ' seat-pulse' : ''}${i % COLS === 4 ? ' seat-aisle' : ''}`}
          />
        ))}
      </div>

      <div className="seatmap-legend">
        <span><i className="seat seat-occupied" /> {counts.occupied} in use</span>
        <span><i className="seat seat-reserved" /> {counts.reserved} reserved</span>
        <span><i className="seat seat-free" /> {counts.free} free</span>
      </div>
    </div>
  );
}
