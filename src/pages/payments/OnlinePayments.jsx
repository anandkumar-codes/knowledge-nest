import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { approveClaim, inr, listClaims, rejectClaim } from '../../api/payments.js';
import { fmtShort, bookingShift } from '../../api/seats.js';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';

const FILTERS = [
  { key: 'pending', label: 'To verify' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const when = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Members' UPI payments waiting for staff to match them against the bank / UPI app.
export default function OnlinePayments({ onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const canReview = can('payments.manage');
  const canSeeMembers = can('members.view', 'members.manage');
  const [filter, setFilter] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await listClaims(filter));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const shiftOf = useMemo(() => Object.fromEntries((data?.shifts ?? []).map((s) => [s.key, s])), [data]);

  const approve = async (c) => {
    setBusyId(c.id);
    try {
      const { payment } = await approveClaim(c.id);
      toast(`${inr(c.amount)} from ${c.memberName} approved · receipt ${payment.receiptNo}.`);
      load();
      onChange?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (error && !data) return <div className="alert">{error}</div>;

  const rows = data?.claims ?? [];
  const total = rows.reduce((t, c) => t + c.amount, 0);

  return (
    <>
      <p className="online-intro">
        Members pay by UPI from the member portal and enter their transaction ID (UTR). Check each one against your
        bank or UPI app before approving. Approving records the payment and issues a receipt.
        {filter === 'approved' && (
          <> Payments marked <span className="auto-tag">Auto-confirmed</span> were never checked by staff: match them
          against your bank too, and void any you can't find (the member sees the reason and can submit again).</>
        )}
      </p>

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter online payments">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={`tab${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          {filter === 'pending' && rows.length > 0 && (
            <span className="toolbar-meta">{rows.length} waiting · {inr(total)}</span>
          )}
        </div>

        <div className="table-wrap">
          <table className="table money-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Member</th>
                <th>Seat</th>
                <th>UPI transaction ID</th>
                <th className="num">Amount</th>
                {filter !== 'pending' && <th>Reviewed</th>}
                <th className="th-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr><td colSpan={7} className="table-empty"><span className="spinner spinner-dark" /></td></tr>
              )}
              {data && rows.length === 0 && (
                <tr><td colSpan={7} className="table-empty">{filter === 'pending' ? 'Nothing to verify. You are all caught up.' : 'None yet.'}</td></tr>
              )}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{when(c.submittedAt)}</td>
                  <td>
                    <div className="member member-compact">
                      <div>
                        {canSeeMembers ? (
                          <Link to={`/admin/members/${c.memberId}`} className="member-name-link">{c.memberName}</Link>
                        ) : (
                          <strong>{c.memberName}</strong>
                        )}
                        <span>{c.memberPhone}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="seat-shift">
                      <span className="seat-pill seat-pill-sm">{c.seatLabel}</span>
                      <span className="muted" title={`${fmtShort(c.startDate)} – ${fmtShort(c.endDate)}`}>{bookingShift(c, shiftOf).label}</span>
                    </div>
                  </td>
                  <td><code className="utr">{c.utr}</code></td>
                  <td className="num"><strong>{inr(c.amount)}</strong></td>
                  {filter !== 'pending' && (
                    <td className="muted">
                      {c.reviewedBy ?? <span className="auto-tag">Auto-confirmed</span>} · {when(c.reviewedAt)}
                      {c.reviewNote && c.status === 'rejected' && <small className="claim-reason">{c.reviewNote}</small>}
                    </td>
                  )}
                  <td className="td-actions">
                    {filter === 'pending' && canReview && (
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={() => setRejecting(c)} disabled={busyId === c.id}>Reject</button>
                        <button className="btn btn-solid btn-sm" onClick={() => approve(c)} disabled={busyId === c.id}>
                          {busyId === c.id && <span className="spinner" />} Approve
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rejecting && (
        <RejectModal
          claim={rejecting}
          onClose={() => setRejecting(null)}
          onSaved={() => {
            toast('Payment rejected. The member can see your reason.');
            setRejecting(null);
            load();
            onChange?.();
          }}
        />
      )}
    </>
  );
}

function RejectModal({ claim: c, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Tell the member why.');
    setSaving(true);
    try {
      await rejectClaim(c.id, reason.trim());
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Reject this payment?"
      subtitle={`${inr(c.amount)} from ${c.memberName} · UTR ${c.utr}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="reject-form" className="btn btn-danger" disabled={saving}>
            {saving && <span className="spinner" />} Reject
          </button>
        </>
      }
    >
      <form id="reject-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <label className="form-field">
          <span>Reason (shown to the member)</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No payment found with this transaction ID" maxLength={200} autoFocus />
        </label>
        <p className="hint">The member can submit again with the correct transaction ID.</p>
      </form>
    </Modal>
  );
}
