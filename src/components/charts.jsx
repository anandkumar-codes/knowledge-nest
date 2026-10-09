import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { niceScale, pct } from '../api/reports.js';

// Track an element's width so SVG charts can lay out in real pixels.
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Tooltip({ x, y, width, children }) {
  if (x == null) return null;
  const left = Math.min(Math.max(x, 80), Math.max(width - 80, 80));
  return (
    <div className="viz-tooltip" style={{ left, top: y }} role="status">
      {children}
    </div>
  );
}

// Show at most ~one label per `minGap` px so x-axis text never collides.
const labelEvery = (n, plotW, minGap = 58) => Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / minGap))));

/** Single-series column chart (e.g. revenue per day). data: [{ key, label, range, value }] */
export function ColumnChart({ data, format, axisFormat = format, valueName }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 240;
  const M = { top: 26, right: 8, bottom: 28, left: 54 };
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = H - M.top - M.bottom;
  const max = Math.max(...data.map((d) => d.value), 0);
  const { max: yMax, step } = niceScale(max);
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(band - 2, 2) * 0.72);
  const y = (v) => M.top + plotH - (v / yMax) * plotH;
  const every = labelEvery(data.length, plotW);
  const peak = data.findIndex((d) => d.value === max && max > 0);

  const bar = (d, i) => {
    const cx = M.left + band * i + band / 2;
    const top = y(d.value);
    const h = M.top + plotH - top;
    if (h <= 0) return null;
    const r = Math.min(4, h, barW / 2);
    const x0 = cx - barW / 2;
    const x1 = cx + barW / 2;
    const base = M.top + plotH;
    // Rounded data-end, square at the baseline.
    const dPath = `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`;
    return <path key={d.key} d={dPath} className={`viz-bar${hover === i ? ' is-hover' : ''}`} />;
  };

  const ticks = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="viz-wrap" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${valueName} chart`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'viz-baseline' : 'viz-grid'} x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{axisFormat(t)}</text>
            </g>
          ))}
          {data.map(bar)}
          {peak >= 0 && hover == null && (
            <text className="viz-label" x={M.left + band * peak + band / 2} y={y(max) - 8} textAnchor="middle">
              {format(max)}
            </text>
          )}
          {data.map((d, i) =>
            i % every === 0 ? (
              <text key={d.key} className="viz-tick" x={M.left + band * i + band / 2} y={H - 8} textAnchor="middle">
                {d.label}
              </text>
            ) : null
          )}
          {data.map((d, i) => (
            <rect
              key={d.key}
              className="viz-hit"
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={plotH}
              tabIndex={0}
              aria-label={`${d.range}: ${format(d.value)}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {h && (
        <Tooltip x={M.left + band * hover + band / 2} y={Math.max(y(h.value) - 10, 4)} width={width}>
          <strong>{format(h.value)}</strong>
          <span>{h.range}</span>
        </Tooltip>
      )}
    </div>
  );
}

/** Multi-series line chart on a 0–100% axis. series: [{ key, label, className }] */
export function LineChart({ data, series }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 260;
  const M = { top: 16, right: 100, bottom: 28, left: 44 };
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = H - M.top - M.bottom;
  const n = data.length;
  const x = (i) => M.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  // Axis starts at 0% and stops at a clean step above the data (never past 100%).
  const peak = Math.max(...data.flatMap((d) => series.map((s) => d[s.key])), 0);
  const { max: niceTop, step: niceStep } = niceScale(Math.max(peak * 100, 1));
  const top = Math.min(1, niceTop / 100);
  const tickStep = top === 1 ? 0.25 : niceStep / 100;
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += tickStep) ticks.push(t);
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const every = labelEvery(n, plotW);
  const last = n - 1;

  // Direct end labels only when they won't collide; the legend always carries identity.
  const ends = series.map((s) => ({ ...s, y: y(data[last]?.[s.key] ?? 0) }));
  const endLabelsFit = ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.y - b.y) >= 18));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    setHover(Math.max(0, Math.min(last, Math.round(n === 1 ? 0 : (px / plotW) * (n - 1)))));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else return;
    e.preventDefault();
  };
  const h = hover != null ? data[hover] : null;

  return (
    <div className="viz-wrap" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${series.map((s) => s.label).join(' and ')} occupancy chart`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'viz-baseline' : 'viz-grid'} x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {pct(t, Number.isInteger(Math.round(t * 1000) / 10) ? 0 : 1)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % every === 0 ? (
              <text key={d.key} className="viz-tick" x={x(i)} y={H - 8} textAnchor="middle">{d.label}</text>
            ) : null
          )}
          {series.map((s) => (
            <path
              key={s.key}
              className={`viz-line ${s.className}`}
              d={data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[s.key])}`).join(' ')}
            />
          ))}
          {hover != null && <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} />}
          {series.map((s) => {
            const i = hover ?? last;
            return <circle key={s.key} className={`viz-dot ${s.className}`} cx={x(i)} cy={y(data[i]?.[s.key] ?? 0)} r={4} />;
          })}
          {endLabelsFit && hover == null &&
            ends.map((s) => (
              <text key={s.key} className="viz-label" x={x(last) + 10} y={s.y} dy="0.32em">
                {s.label} {pct(data[last]?.[s.key] ?? 0)}
              </text>
            ))}
          <rect
            className="viz-hit"
            x={M.left - 6}
            y={M.top}
            width={plotW + 12}
            height={plotH}
            tabIndex={0}
            aria-label="Occupancy over time. Use left and right arrow keys to read values."
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onFocus={() => setHover((v) => v ?? last)}
            onBlur={() => setHover(null)}
          />
        </svg>
      )}
      {h && (
        <Tooltip x={x(hover)} y={M.top} width={width}>
          <span className="viz-tip-title">{h.range}</span>
          {series.map((s) => (
            <span key={s.key} className="viz-tip-row">
              <i className={`viz-key ${s.className}`} aria-hidden="true" />
              <strong>{pct(h[s.key], 1)}</strong>
              <span>{s.label}</span>
            </span>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="viz-legend">
      {items.map((it) => (
        <span key={it.key}>
          <i className={`viz-key ${it.className}`} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontal bars with the value at the tip. rows: [{ key, label, value }] — one series, one color. */
export function BarList({ rows, format }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="viz-barlist">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="viz-barlist-label">{r.label}</span>
          <span className="viz-barlist-track">
            {/* Scale within the track minus room for the value label, so bar lengths stay proportional. */}
            <span className="viz-barlist-bar" style={{ '--r': max ? Math.max(r.value / max, r.value ? 0.015 : 0) : 0 }} />
            <span className="viz-barlist-value">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const BINS = [0.2, 0.4, 0.6, 0.8, 1.0001];
export const binOf = (rate) => BINS.findIndex((b) => rate < b);

/** Hall plan coloured by how much each seat was used (sequential, one hue). */
export function SeatHeatmap({ seats, layout }) {
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!hover || !wrap.current) return;
    const cell = wrap.current.querySelector(`[data-seat="${hover.label}"]`);
    if (!cell) return;
    const a = wrap.current.getBoundingClientRect();
    const b = cell.getBoundingClientRect();
    setPos({ x: b.left - a.left + b.width / 2, y: b.top - a.top - 6, width: a.width });
  }, [hover]);

  const rows = layout.rows.map((r) => seats.filter((s) => s.row === r));
  return (
    <div className="viz-wrap heat-wrap" ref={wrap} onPointerLeave={() => setHover(null)}>
      <div className="heat-grid">
        {rows.map((rowSeats, i) => (
          <div className="heat-row" key={layout.rows[i]}>
            <span className="row-label">{layout.rows[i]}</span>
            {rowSeats.map((s) => (
              <span
                key={s.label}
                data-seat={s.label}
                className={`heat-cell heat-${binOf(s.rate)}${s.status === 'maintenance' ? ' is-maintenance' : ''}${s.position === layout.aisleAfter ? ' aisle-after' : ''}${hover?.label === s.label ? ' is-hover' : ''}`}
                tabIndex={0}
                role="img"
                aria-label={`Seat ${s.label}: booked ${pct(s.rate)} of shift-days`}
                onPointerEnter={() => setHover(s)}
                onFocus={() => setHover(s)}
                onBlur={() => setHover(null)}
              >
                {s.label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Less used</span>
        {BINS.map((b, i) => (
          <i key={b} className={`heat-cell heat-${i}`} title={`${i * 20}–${Math.min(i * 20 + 20, 100)}%`} />
        ))}
        <span>More used</span>
      </div>
      {hover && pos && (
        <Tooltip x={pos.x} y={pos.y} width={pos.width}>
          <strong>{pct(hover.rate)}</strong>
          <span>Seat {hover.label} · shift-days booked{hover.status === 'maintenance' ? ' · under maintenance now' : ''}</span>
        </Tooltip>
      )}
    </div>
  );
}

/** Card wrapper with a chart ⇄ table toggle (every chart has a table twin). */
export function ChartCard({ title, subtitle, table, legend, children, className = '' }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`panel chart-card ${className}`}>
      <header className="chart-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {table && (
          <button type="button" className="link" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'View as table'}
          </button>
        )}
      </header>
      {!showTable && legend}
      {showTable ? <div className="table-wrap chart-table">{table}</div> : children}
    </section>
  );
}
