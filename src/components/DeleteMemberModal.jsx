import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { deleteMember, getRelated } from '../api/members.js';
import { inr } from '../api/payments.js';
import { fmtDate, fmtShort } from '../api/seats.js';
import Modal from './Modal.jsx';
import { CalendarIcon, CardIcon, ClockIcon, PhoneIcon, SeatIcon } from './Icons.jsx';

/**
 * Delete an archived member. Shows what's linked to them first, suggests the safest option,
 * and offers "remove personal details only" (keeps history) or "delete everything".
 */
export default function DeleteMemberModal({ member: m, onClose, onDeleted }) {
  const { can } = useAuth();
  const [rel, setRel] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRelated(m.id)
      .then((r) => {
        setRel(r);
        const history = r.bookings.total > 0 || r.payments.count > 0 || r.payments.voided > 0;
        setMode(history && !m.anonymized ? 'anonymize' : 'erase');
      })
      .catch((err) => setError(err.message));
  }, [m.id, m.anonymized]);

  const hasMoney = !!rel && (rel.payments.count > 0 || rel.payments.voided > 0);
  const hasHistory = !!rel && (rel.bookings.total > 0 || hasMoney);
  const blocked = !!rel && (rel.claims.pending > 0 || rel.bookings.open > 0);
  const eraseNotAllowed = hasMoney && !can('payments.manage');
  const needsTyping = mode === 'erase' && hasHistory;
  const ready = mode && !blocked && !(mode === 'erase' && eraseNotAllowed) && (!needsTyping || typed === m.name);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await deleteMember(m.id, mode, m.name);
      onDeleted(mode);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={m.anonymized ? 'Delete this record?' : `Delete ${m.name}?`}
      subtitle={`${m.code}${m.phone ? ` · ${m.phone}` : ''} · archived`}
      onClose={onClose}
      width={580}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep archived</button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={!ready || busy}>
            {busy && <span className="spinner" />} {mode === 'anonymize' ? 'Remove personal details' : 'Delete permanently'}
          </button>
        </>
      }
    >
      {!rel ? (
        error ? <div className="alert">{error}</div> : <div className="page-loading" style={{ minHeight: 160 }}><span className="spinner spinner-dark" /></div>
      ) : (
        <div className="form-grid delete-member">
          {error && <div className="alert">{error}</div>}

          <section>
            <h3 className="seat-section-title">Connected to this member</h3>
            {hasHistory || rel.claims.total || rel.portalEnabled ? (
              <ul className="related-list">
                {rel.bookings.total > 0 && (
                  <li>
                    <span className="related-icon"><SeatIcon width={16} height={16} /></span>
                    <span>
                      <strong>{rel.bookings.total} booking{rel.bookings.total === 1 ? '' : 's'}</strong>
                      <small>
                        Seat{rel.bookings.seatCount === 1 ? '' : 's'} {rel.bookings.seats.join(', ')}
                        {rel.bookings.seatCount > rel.bookings.seats.length ? '…' : ''} · {fmtShort(rel.bookings.first)} – {fmtDate(rel.bookings.last)}
                      </small>
                    </span>
                  </li>
                )}
                {(rel.payments.count > 0 || rel.payments.voided > 0) && (
                  <li>
                    <span className="related-icon"><CardIcon width={16} height={16} /></span>
                    <span>
                      <strong>{rel.payments.count} payment{rel.payments.count === 1 ? '' : 's'} · {inr(rel.payments.received - rel.payments.refunded)} net</strong>
                      <small>
                        Receipts in the ledger and revenue reports
                        {rel.payments.refunded ? ` · ${inr(rel.payments.refunded)} refunded` : ''}
                        {rel.payments.voided ? ` · ${rel.payments.voided} voided` : ''}
                        {rel.payments.last ? ` · last on ${fmtDate(rel.payments.last)}` : ''}
                      </small>
                    </span>
                  </li>
                )}
                {rel.dues.total > 0 && (
                  <li className="is-warn">
                    <span className="related-icon"><ClockIcon width={16} height={16} /></span>
                    <span>
                      <strong>{inr(rel.dues.total)} still unpaid</strong>
                      <small>On {rel.dues.bookings} booking{rel.dues.bookings === 1 ? '' : 's'}</small>
                    </span>
                  </li>
                )}
                {rel.claims.total > 0 && (
                  <li className={rel.claims.pending ? 'is-block' : ''}>
                    <span className="related-icon"><CalendarIcon width={16} height={16} /></span>
                    <span>
                      <strong>{rel.claims.total} online payment submission{rel.claims.total === 1 ? '' : 's'}</strong>
                      <small>{rel.claims.pending ? `${rel.claims.pending} still waiting to be verified` : 'All reviewed'}</small>
                    </span>
                  </li>
                )}
                {rel.portalEnabled && (
                  <li>
                    <span className="related-icon"><PhoneIcon width={16} height={16} /></span>
                    <span>
                      <strong>Member portal access</strong>
                      <small>Will be turned off</small>
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="related-none">Nothing. No bookings, payments or online submissions are linked to this member.</p>
            )}
          </section>

          <section>
            <h3 className="seat-section-title">Suggestions</h3>
            <ul className="suggestions">
              {rel.claims.pending > 0 && (
                <li className="is-block">
                  Review their {rel.claims.pending} waiting online payment{rel.claims.pending === 1 ? '' : 's'} first in{' '}
                  <Link to="/admin/payments?view=online" onClick={onClose}>Payments → Online payments</Link>. Deleting is blocked until then.
                </li>
              )}
              {rel.bookings.open > 0 && <li className="is-block">Release their active or upcoming booking first.</li>}
              {rel.dues.total > 0 && (
                <li className="is-warn">
                  {inr(rel.dues.total)} is still unpaid. Collect it, or waive it with <em>Adjust</em> in their booking history. After
                  deleting, it won't show in Dues any more.
                </li>
              )}
              {hasMoney && !m.anonymized && (
                <li>
                  <strong>Recommended: remove personal details only.</strong> Their {inr(rel.payments.received - rel.payments.refunded)} of
                  payments stay on record, so receipts, the ledger and revenue reports remain correct.
                </li>
              )}
              {rel.bookings.total > 0 && !hasMoney && !m.anonymized && (
                <li>
                  Removing personal details keeps their {rel.bookings.total} past booking{rel.bookings.total === 1 ? '' : 's'} in
                  occupancy reports. Deleting everything takes them out.
                </li>
              )}
              {!hasHistory && !rel.claims.total && <li>Nothing else is linked, so deleting is safe.</li>}
              {!m.anonymized && (
                <li>Might they come back? Keep them archived: <em>Restore</em> brings back their profile and history in one click.</li>
              )}
              {m.phone && <li>Their phone number {m.phone} becomes free to register again.</li>}
            </ul>
          </section>

          {!blocked && (
            <fieldset className="form-field">
              <span>How to delete</span>
              <div className="choice-cards delete-options">
                {hasHistory && !m.anonymized && (
                  <label className={mode === 'anonymize' ? 'on' : ''}>
                    <input type="radio" name="mode" checked={mode === 'anonymize'} onChange={() => setMode('anonymize')} />
                    <strong>Remove personal details only</strong>
                    <span>Name, phone, email and address are wiped. Bookings and payments stay, anonymously.</span>
                  </label>
                )}
                <label className={`${mode === 'erase' ? 'on' : ''}${eraseNotAllowed ? ' is-disabled' : ''}`}>
                  <input type="radio" name="mode" checked={mode === 'erase'} onChange={() => setMode('erase')} disabled={eraseNotAllowed} />
                  <strong>{hasHistory ? 'Delete everything permanently' : 'Delete permanently'}</strong>
                  <span>
                    {eraseNotAllowed
                      ? 'Needs the "Collect & refund fees" permission, because payment records would be deleted.'
                      : hasHistory
                        ? 'The member and all their bookings and payments are removed. Past revenue figures will change.'
                        : 'The member is removed. This cannot be undone.'}
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {needsTyping && !blocked && !eraseNotAllowed && (
            <label className="form-field">
              <span>Type <strong>{m.name}</strong> to confirm</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
