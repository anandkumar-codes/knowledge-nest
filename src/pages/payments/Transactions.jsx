import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { downloadCsv, inr, listPayments, methodLabel, methodsWithTotals } from '../../api/payments.js';
import { addDays, fmtDate, fmtShort, bookingShift } from '../../api/seats.js';
import { ReceiptModal, VoidPaymentModal } from '../../components/PaymentDialogs.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SearchIcon } from '../../components/Icons.jsx';

function ranges(today) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'week', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last', label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

export default function Transactions() {
  const { can } = useAuth();
  const toast = useToast();
  const canVoid = can('payments.manage');
  const canSeeMembers = can('members.view', 'members.manage');

  const [range, setRange] = useState({ key: 'month', from: null, to: null });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [method, setMethod] = useState('all');
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState(null);
  const [voiding, setVoiding] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await listPayments(range.from, range.to));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const presets = data ? ranges(data.today) : [];
  const shiftOf = useMemo(() => Object.fromEntries((data?.shifts ?? []).map((s) => [s.key, s])), [data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.payments ?? []).filter(
      (p) =>
        (method === 'all' || p.method === method) &&
        (!q ||
          p.memberName.toLowerCase().includes(q) ||
          p.receiptNo.toLowerCase().includes(q) ||
          p.reference.toLowerCase().includes(q) ||
          p.seatLabel.toLowerCase() === q)
    );
  }, [data, method, query]);

  const exportCsv = () => {
    downloadCsv(
      `knowledge-nest-payments-${data.from}-to-${data.to}.csv`,
      ['Date', 'Receipt', 'Type', 'Member', 'Phone', 'Seat', 'Shift', 'Method', 'Reference', 'Amount', 'Received by', 'Status', 'Notes'],
      rows.map((p) => [
        p.paidOn, p.receiptNo, p.kind === 'refund' ? 'Refund' : 'Payment', p.memberName, p.memberPhone, p.seatLabel,
        bookingShift(p, shiftOf).label, methodLabel(p.method), p.reference, p.kind === 'refund' ? -p.amount : p.amount,
        p.receivedBy ?? '', p.voidedAt ? `Void: ${p.voidReason}` : 'OK', p.notes,
      ])
    );
  };

  if (error && !data) return <div className="alert">{error}</div>;
  if (!data) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const { summary } = data;
  const activeKey = presets.find((p) => p.from === data.from && p.to === data.to)?.key ?? 'custom';

  return (
    <>
      <div className="range-bar">
        <div className="segmented" role="radiogroup" aria-label="Date range">
          {presets.map((p) => (
            <label key={p.key} className={activeKey === p.key ? 'on' : ''}>
              <input type="radio" name="range" checked={activeKey === p.key} onChange={() => setRange({ key: p.key, from: p.from, to: p.to })} />
              {p.label}
            </label>
          ))}
        </div>
        <div className="date-range">
          <input className="input" type="date" value={data.from} max={data.to} onChange={(e) => e.target.value && setRange({ key: 'custom', from: e.target.value, to: data.to })} aria-label="From date" />
          <span>to</span>
          <input className="input" type="date" value={data.to} min={data.from} max={data.today} onChange={(e) => e.target.value && setRange({ key: 'custom', from: data.from, to: e.target.value })} aria-label="To date" />
        </div>
      </div>

      <div className="money-summary">
        <div className="money-total">
          <span>Net collected</span>
          <strong>{inr(summary.net)}</strong>
          <small>
            {fmtShort(data.from)}{data.from !== data.to ? ` – ${fmtDate(data.to)}` : `, ${data.from.slice(0, 4)}`} · {summary.count} entr{summary.count === 1 ? 'y' : 'ies'}
          </small>
        </div>
        <div className="money-split">
          <div><span>Received</span><strong>{inr(summary.received)}</strong></div>
          <div><span>Refunded</span><strong className={summary.refunded ? 'neg' : ''}>{summary.refunded ? `− ${inr(summary.refunded)}` : inr(0)}</strong></div>
        </div>
        <div className="money-methods" style={{ '--n': methodsWithTotals(summary.byMethod).length }}>
          {methodsWithTotals(summary.byMethod).map((m) => (
            <button key={m.key} type="button" className={`method-chip${method === m.key ? ' on' : ''}`} onClick={() => setMethod((cur) => (cur === m.key ? 'all' : m.key))}>
              <span>{m.label}</span>
              <strong>{inr(summary.byMethod[m.key])}</strong>
            </button>
          ))}
        </div>
      </div>

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="search">
            <SearchIcon />
            <input type="search" placeholder="Member, receipt no. or UPI ref" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search payments" />
          </div>
          {method !== 'all' && (
            <span className="toolbar-meta">
              {methodLabel(method)} only <button className="link" onClick={() => setMethod('all')}>Clear</button>
            </span>
          )}
          <button className="btn btn-ghost btn-sm export-btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        </div>

        <div className="table-wrap">
          <table className="table money-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt</th>
                <th>Member</th>
                <th>Seat</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Received by</th>
                <th className="th-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="table-empty">No payments in this period.</td></tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className={p.voidedAt ? 'is-void' : ''}>
                  <td className="nowrap">{fmtShort(p.paidOn)}</td>
                  <td>
                    <button className="link receipt-link" onClick={() => setViewing(p)}>{p.receiptNo}</button>
                    {p.voidedAt && <span className="void-tag" title={p.voidReason}>Void</span>}
                  </td>
                  <td>
                    {canSeeMembers && p.memberId ? (
                      <Link to={`/admin/members/${p.memberId}`} className="member-name-link">{p.memberName}</Link>
                    ) : (
                      p.memberName
                    )}
                  </td>
                  <td><span className="seat-pill seat-pill-sm">{p.seatLabel}</span></td>
                  <td className="nowrap">
                    {methodLabel(p.method)}
                    {p.reference && <small className="ref"> · {p.reference}</small>}
                  </td>
                  <td className="num nowrap">
                    <strong className={p.kind === 'refund' ? 'neg' : ''}>{p.kind === 'refund' ? `− ${inr(p.amount)}` : inr(p.amount)}</strong>
                    {p.kind === 'refund' && <small className="kind-tag">Refund</small>}
                  </td>
                  <td className="muted">{p.receivedBy ?? '—'}</td>
                  <td className="td-actions">
                    {canVoid && !p.voidedAt && (
                      <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={() => setVoiding(p)}>Void</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {viewing && (
        <ReceiptModal
          payment={viewing}
          shiftLabel={bookingShift(viewing, shiftOf).label}
          shiftTime={bookingShift(viewing, shiftOf).time}
          onClose={() => setViewing(null)}
        />
      )}
      {voiding && (
        <VoidPaymentModal
          payment={voiding}
          onClose={() => setVoiding(null)}
          onSaved={(p) => {
            toast(`${p.receiptNo} voided.`);
            setVoiding(null);
            load();
          }}
        />
      )}
    </>
  );
}
