import { useEffect, useMemo, useState } from 'react';
import { bucketDays, compactInr, delta, getReport, pct, presets } from '../api/reports.js';
import { inr, methodsWithTotals } from '../api/payments.js';
import { fmtDate, fmtShort } from '../api/seats.js';
import { BarList, ChartCard, ColumnChart, Legend, LineChart, SeatHeatmap } from '../components/charts.jsx';
import '../styles/payments.css';
import '../styles/reports.css';

const SERIES = [
  { key: 'morning', className: 'viz-s2' }, // amber
  { key: 'evening', className: 'viz-s1' }, // teal
];
const UNIT_LABEL = { day: 'per day', week: 'per week', month: 'per month' };

export default function ReportsPage() {
  const [range, setRange] = useState({ from: null, to: null });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getReport(range.from, range.to)
      .then((d) => !cancelled && (setData(d), setError('')))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const shiftOf = useMemo(() => Object.fromEntries((data?.shifts ?? []).map((s) => [s.key, s])), [data]);
  const series = useMemo(() => SERIES.map((s) => ({ ...s, label: shiftOf[s.key]?.label ?? s.key })), [shiftOf]);
  const grouped = useMemo(() => (data ? bucketDays(data.days, data.capacity) : null), [data]);

  if (error && !data) return <div className="page"><div className="alert">{error}</div></div>;
  if (!data) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const { kpis } = data;
  const options = presets(data.today);
  const active = options.find((p) => p.from === data.from && p.to === data.to)?.key ?? 'custom';
  const { unit, buckets } = grouped;
  const revenueData = buckets.map((b) => ({ ...b, value: b.revenue }));

  const methodRows = methodsWithTotals(data.byMethod).map((m) => ({ key: m.key, label: m.label, value: data.byMethod[m.key] ?? 0 }));
  const shiftRows = [
    ...['morning', 'evening', 'full'].map((k) => ({ key: k, label: shiftOf[k]?.label ?? k, value: data.shiftMix[k] })),
    { key: 'day', label: 'Day passes', value: data.shiftMix.day ?? 0 },
  ];
  const dayPasses = kpis.dayPasses ?? { value: 0, revenue: 0 };
  const busiest = [...data.seatUse].sort((a, b) => b.rate - a.rate);
  const unused = data.seatUse.filter((s) => s.rate === 0 && s.status === 'active').length;

  return (
    <div className="page reports">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Insights</p>
          <h1>Reports</h1>
          <p className="page-sub">How Knowledge Nest is doing: money, occupancy and seats.</p>
        </div>
      </header>

      {/* One filter row; it scopes everything below. */}
      <div className="range-bar">
        <div className="segmented" role="radiogroup" aria-label="Report period">
          {options.map((p) => (
            <label key={p.key} className={active === p.key ? 'on' : ''}>
              <input type="radio" name="period" checked={active === p.key} onChange={() => setRange({ from: p.from, to: p.to })} />
              {p.label}
            </label>
          ))}
        </div>
        <div className="date-range">
          <input className="input" type="date" value={data.from} max={data.to} onChange={(e) => e.target.value && setRange({ from: e.target.value, to: data.to })} aria-label="From date" />
          <span>to</span>
          <input className="input" type="date" value={data.to} min={data.from} max={data.today} onChange={(e) => e.target.value && setRange({ from: data.from, to: e.target.value })} aria-label="To date" />
        </div>
        <span className="range-note">
          Compared with {fmtShort(data.previous.from)} – {fmtDate(data.previous.to)}
        </span>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className={`reports-body${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        <div className="kpi-row">
          <Kpi hero label="Revenue collected" value={inr(kpis.revenue.value)} change={delta(kpis.revenue.value, kpis.revenue.previous, 'money')} />
          <Kpi label="Average occupancy" value={pct(kpis.occupancy.value)} change={delta(kpis.occupancy.value, kpis.occupancy.previous, 'ratio')} note="of shift slots" />
          <Kpi
            label="New bookings"
            value={kpis.newBookings.value.toLocaleString('en-IN')}
            change={delta(kpis.newBookings.value, kpis.newBookings.previous)}
            note={dayPasses.value ? `incl. ${dayPasses.value} day pass${dayPasses.value === 1 ? '' : 'es'} · ${inr(dayPasses.revenue)}` : undefined}
          />
          <Kpi label="New members" value={kpis.newMembers.value.toLocaleString('en-IN')} change={delta(kpis.newMembers.value, kpis.newMembers.previous)} />
          <Kpi
            label="Renewal rate"
            value={kpis.renewals.rate === null ? '—' : pct(kpis.renewals.rate)}
            note={kpis.renewals.counted ? `${kpis.renewals.renewed} of ${kpis.renewals.counted} plans that ended` : 'No plans ended yet'}
          />
          <Kpi label="Outstanding dues" value={inr(kpis.outstanding.value)} note={`${kpis.outstanding.count} booking${kpis.outstanding.count === 1 ? '' : 's'} · as of today`} />
        </div>

        <div className="report-grid">
          <ChartCard
            className="span-2"
            title="Revenue"
            subtitle={`Net collected ${UNIT_LABEL[unit]}, after refunds`}
            table={
              <table className="table money-table">
                <thead><tr><th>{unit === 'day' ? 'Date' : 'Period'}</th><th className="num">Net collected</th></tr></thead>
                <tbody>
                  {revenueData.map((b) => (
                    <tr key={b.key}><td>{b.range}{b.partial ? ' (part month)' : ''}</td><td className="num">{inr(b.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {kpis.revenue.value === 0 && kpis.revenue.previous === 0 ? (
              <p className="chart-empty">No payments recorded in this period.</p>
            ) : (
              <ColumnChart data={revenueData} format={inr} axisFormat={compactInr} valueName="Revenue" />
            )}
          </ChartCard>

          <ChartCard
            className="span-2"
            title="Occupancy by shift"
            subtitle={`Share of ${data.capacity} seats booked, ${unit === 'day' ? 'each day' : `averaged ${UNIT_LABEL[unit]}`}`}
            legend={<Legend items={series} />}
            table={
              <table className="table money-table">
                <thead>
                  <tr><th>{unit === 'day' ? 'Date' : 'Period'}</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.key}><td>{b.range}</td>{series.map((s) => <td key={s.key} className="num">{pct(b[s.key], 1)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <LineChart data={buckets} series={series} />
          </ChartCard>

          <ChartCard
            title="Seat popularity"
            subtitle={`Share of shift-days each seat was booked${unused ? ` · ${unused} seat${unused === 1 ? '' : 's'} never used` : ''}`}
            table={
              <table className="table money-table">
                <thead><tr><th>Seat</th><th className="num">Booked</th></tr></thead>
                <tbody>
                  {busiest.map((s) => (
                    <tr key={s.label}><td>{s.label}{s.status === 'maintenance' ? ' (maintenance)' : ''}</td><td className="num">{pct(s.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <SeatHeatmap seats={data.seatUse} layout={data.layout} />
            <p className="chart-foot">
              Most used: {busiest.slice(0, 3).filter((s) => s.rate > 0).map((s) => `${s.label} (${pct(s.rate)})`).join(', ') || 'none yet'}
            </p>
          </ChartCard>

          <div className="report-side">
            <ChartCard
              title="Collections by method"
              subtitle="Net of refunds"
              table={
                <table className="table money-table">
                  <tbody>{methodRows.map((r) => <tr key={r.key}><td>{r.label}</td><td className="num">{inr(r.value)}</td></tr>)}</tbody>
                </table>
              }
            >
              <BarList rows={methodRows} format={inr} />
            </ChartCard>
            <ChartCard
              title="New bookings by type"
              subtitle="Bookings starting in this period"
              table={
                <table className="table money-table">
                  <tbody>{shiftRows.map((r) => <tr key={r.key}><td>{r.label}</td><td className="num">{r.value}</td></tr>)}</tbody>
                </table>
              }
            >
              <BarList rows={shiftRows} format={(n) => n.toLocaleString('en-IN')} />
            </ChartCard>
          </div>
        </div>

        <p className="reports-footnote">
          Renewal rate counts plans that reached their end date in this period and were followed by a new booking for the
          same member within 7 days. Extended plans don't count as ended. Plans that ended less than a week ago are only
          counted once renewed.
        </p>
      </div>
    </div>
  );
}

function Kpi({ label, value, change, note, hero }) {
  const dir = change ? Math.sign(change.diff) : 0;
  return (
    <div className={`kpi${hero ? ' kpi-hero' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {change ? (
        <span className={`kpi-delta ${dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}`}>
          <span aria-hidden="true">{dir > 0 ? '▲' : dir < 0 ? '▼' : '–'}</span> {change.text}
          <span className="sr-only"> compared with the previous period</span>
        </span>
      ) : (
        note && <span className="kpi-note">{note}</span>
      )}
      {change && note && <span className="kpi-note">{note}</span>}
    </div>
  );
}
