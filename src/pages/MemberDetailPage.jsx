import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { GENDERS, archiveMember, bookingState, getMember, restoreMember, setPortalAccess, standing } from '../api/members.js';
import { timeAgo } from '../api/team.js';
import Modal from '../components/Modal.jsx';
import { bookingShift, daysBetween, fmtDate, fmtShort, isDayPass, releaseBooking } from '../api/seats.js';
import { initials } from '../components/AdminLayout.jsx';
import { AssignSeatModal, ChangeSeatModal, ExtendModal } from '../components/BookingDialogs.jsx';
import MemberFormModal from '../components/MemberFormModal.jsx';
import DeleteMemberModal from '../components/DeleteMemberModal.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { publicUrl } from '../platform/native.js';
import { useToast } from '../components/Toast.jsx';
import { CopyIcon, EditIcon, MessageIcon, PhoneIcon, SeatIcon } from '../components/Icons.jsx';
import { inr, methodLabel, paymentStatus } from '../api/payments.js';
import { AdjustFeeModal, CollectPaymentModal, ReceiptModal } from '../components/PaymentDialogs.jsx';
import '../styles/seats.css';
import '../styles/members.css';
import '../styles/bookings.css';
import '../styles/payments.css';

export default function MemberDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('members.manage');
  const canBook = can('seats.manage', 'bookings.manage');
  const canSeePayments = can('payments.view', 'payments.manage');
  const canCollect = can('payments.manage');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [changing, setChanging] = useState(null); // a booking, or 'choose' when they hold more than one seat
  const [extending, setExtending] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [portalCreds, setPortalCreds] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const [portalBusy, setPortalBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'release'|'archive', booking? }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getMember(id));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) {
    return (
      <div className="page">
        <Link to="/admin/members" className="back-link">← Members</Link>
        <div className="alert">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const { member: m, today } = data;
  const SHIFTS = Object.fromEntries(data.shifts.map((s) => [s.key, s]));
  const st = standing(m, today);
  const archived = m.status === 'archived';

  const runConfirm = async () => {
    setBusy(true);
    try {
      if (confirm.kind === 'release') {
        await releaseBooking(confirm.booking.id);
        toast(confirm.booking.startDate > today ? 'Upcoming booking cancelled.' : `Seat ${confirm.booking.seatLabel} released.`);
      } else if (confirm.kind === 'archive') {
        await archiveMember(m.id);
        toast(`${m.name} archived.`);
      }
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setConfirm(null);
      setBusy(false);
    }
  };

  const hasBookings = st.current.length > 0 || st.upcoming.length > 0;

  const portal = async (action) => {
    setPortalBusy(true);
    try {
      const res = await setPortalAccess(m.id, action);
      if (res.tempPassword) setPortalCreds({ password: res.tempPassword, isNew: action === 'enable' });
      else toast(`${m.name} can no longer sign in to the member portal.`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPortalBusy(false);
    }
  };
  const totals = m.bookings.reduce(
    (t, b) => ({ fee: t.fee + b.fee, paid: t.paid + b.paid, balance: t.balance + Math.max(b.balance, 0) }),
    { fee: 0, paid: 0, balance: 0 }
  );

  const details = [
    ['Phone', <a key="p" href={`tel:${m.phone.replace(/\s/g, '')}`}>{m.phone}</a>],
    ['Email', m.email ? <a key="e" href={`mailto:${m.email}`}>{m.email}</a> : null],
    ['Preparing for', m.preparingFor],
    ['Gender', GENDERS.find((g) => g.key === m.gender && g.key)?.label],
    ['Emergency contact', m.guardianPhone ? <a key="g" href={`tel:${m.guardianPhone.replace(/\s/g, '')}`}>{m.guardianPhone}</a> : null],
    ['Address', m.address],
    ['Joined', fmtDate(m.joinedOn)],
    ['Added by', m.createdBy],
  ].filter(([, v]) => v);

  return (
    <div className="page">
      <Link to="/admin/members" className="back-link">← Members</Link>

      <header className="profile-head">
        <span className="avatar avatar-xl">{initials(m.name)}</span>
        <div className="profile-head-text">
          <h1>{m.name}</h1>
          <p>
            <span className="code-chip">{m.code}</span>
            {m.anonymized && <span className="removed-chip">Details removed</span>}
            {m.portal.enabled && (
              <span className="portal-chip" title="Has member portal access">
                <PhoneIcon width={12} height={12} aria-hidden="true" /> Portal
              </span>
            )}
            {archived ? (
              <span className="status status-disabled">Archived</span>
            ) : st.current.length ? (
              <span className="status status-active">Seat {st.current.map((b) => b.seatLabel).join(', ')}</span>
            ) : (
              <span className="status status-idle">No seat</span>
            )}
          </p>
        </div>
        <div className="profile-actions">
          {canEdit && !m.anonymized && (
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              <EditIcon width={16} height={16} /> Edit
            </button>
          )}
          {canBook && !archived && (
            st.current.length ? (
              <button
                className="btn btn-solid"
                onClick={() => setChanging(st.current.length === 1 ? st.current[0] : 'choose')}
              >
                <SeatIcon width={16} height={16} /> Change seat
              </button>
            ) : (
              <button className="btn btn-solid" onClick={() => setAssigning(true)}>
                <SeatIcon width={16} height={16} /> Assign seat
              </button>
            )
          )}
        </div>
      </header>

      <div className="profile-grid">
        <div className="profile-main">
          <section className="panel">
            <div className="panel-head">
              <h2>Current seat</h2>
              <p>{st.current.length ? 'Where they sit today.' : 'Not seated today.'}</p>
            </div>
            {st.current.length === 0 && (
              <div className="empty-seat">
                <p>{archived ? 'Restore this member to book a seat.' : `${m.name.split(' ')[0]} doesn't have a seat today.`}</p>
                {canBook && !archived && (
                  <button className="btn btn-solid btn-sm" onClick={() => setAssigning(true)}>Assign a seat</button>
                )}
              </div>
            )}
            <div className="booking-cards">
              {st.current.map((b) => {
                const left = daysBetween(today, b.endDate);
                const total = daysBetween(b.startDate, b.endDate) + 1;
                const used = Math.min(total, daysBetween(b.startDate, today) + 1);
                const day = isDayPass(b);
                const expiring = !day && left <= 5;
                return (
                  <div key={b.id} className={`booking-card${expiring ? ' is-expiring' : ''}`}>
                    <div className="booking-card-top">
                      <span className="seat-badge">{b.seatLabel}</span>
                      <div>
                        <strong>{bookingShift(b, SHIFTS).label}</strong>
                        <span>{bookingShift(b, SHIFTS).time}</span>
                      </div>
                      <Link to={`/admin/seats?seat=${b.seatId}`} className="link">View on plan</Link>
                    </div>
                    <div className="progress" aria-hidden="true">
                      <span style={{ width: `${(used / total) * 100}%` }} />
                    </div>
                    <div className="booking-card-dates">
                      <span>{day ? fmtDate(b.startDate) : `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`}</span>
                      <em>{day ? 'Today only' : left === 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`}</em>
                    </div>
                    {canSeePayments && (
                      <div className="booking-card-money">
                        <span>Fee {inr(b.fee)} · Paid {inr(b.paid)}</span>
                        <span className={`pay-status pay-${paymentStatus(b).key}`}>{paymentStatus(b).label}</span>
                      </div>
                    )}
                    {(canBook || canCollect) && (
                      <div className="slot-actions">
                        {canCollect && b.balance > 0 && (
                          <button className="btn btn-solid btn-sm" onClick={() => setCollecting(b)}>Collect {inr(b.balance)}</button>
                        )}
                        {canBook && <button className="btn btn-ghost btn-sm" onClick={() => setChanging(b)}>Change seat</button>}
                        {canBook && !day && <button className="btn btn-ghost btn-sm" onClick={() => setExtending(b)}>Extend</button>}
                        {canBook && (
                          <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={() => setConfirm({ kind: 'release', booking: b })}>
                            Release
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {st.upcoming.length > 0 && (
              <>
                <h3 className="seat-section-title">Upcoming</h3>
                <ul className="upcoming">
                  {st.upcoming.map((b) => (
                    <li key={b.id}>
                      <div>
                        <strong>Seat {b.seatLabel} · {bookingShift(b, SHIFTS).label}</strong>
                        <span>{isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtShort(b.endDate)}`}</span>
                      </div>
                      {canBook && <button className="link" onClick={() => setConfirm({ kind: 'release', booking: b })}>Cancel</button>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel panel-flush">
            <div className="panel-head panel-head-pad">
              <h2>Booking history</h2>
              <p>{m.bookings.length ? `${m.bookings.length} booking${m.bookings.length === 1 ? '' : 's'} since joining.` : 'No bookings yet.'}</p>
            </div>
            {m.bookings.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Seat</th>
                      <th>Shift</th>
                      <th>Period</th>
                      <th>Status</th>
                      {canSeePayments && <th>Payment</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {m.bookings.map((b) => {
                      const s = bookingState(b, today);
                      return (
                        <tr key={b.id}>
                          <td>
                            <strong>{b.seatLabel}</strong>
                            {b.movedFrom && <small className="moved-from"> · moved from {b.movedFrom.seatLabel}</small>}
                          </td>
                          <td>{bookingShift(b, SHIFTS).label}</td>
                          <td className="muted">
                            {isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}
                            {b.releasedAt && <small className="released-on"> · released {fmtShort(b.releasedAt.slice(0, 10))}</small>}
                          </td>
                          <td><span className={`hist hist-${s.key}`}>{s.label}</span></td>
                          {canSeePayments && (
                            <td>
                              <div className="pay-cell">
                                <span className={`pay-status pay-${paymentStatus(b).key}`}>{paymentStatus(b).label}</span>
                                {canCollect && b.balance > 0 && (
                                  <button className="link" onClick={() => setCollecting(b)}>Collect</button>
                                )}
                                {canCollect && (
                                  <button className="link link-muted" onClick={() => setAdjusting(b)}>Adjust</button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {canSeePayments && (
            <section className="panel panel-flush">
              <div className="panel-head panel-head-pad">
                <h2>Payments</h2>
                <p>
                  {totals.fee ? (
                    <>
                      Total fees {inr(totals.fee)} · Paid {inr(totals.paid)} ·{' '}
                      {totals.balance > 0 ? <strong className="due-amount">{inr(totals.balance)} due</strong> : 'Nothing due'}
                    </>
                  ) : (
                    'No fees recorded yet.'
                  )}
                </p>
              </div>
              {data.payments.length > 0 && (
                <div className="table-wrap">
                  <table className="table money-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Receipt</th>
                        <th>Seat</th>
                        <th>Method</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.id} className={p.voidedAt ? 'is-void' : ''}>
                          <td className="nowrap">{fmtShort(p.paidOn)}</td>
                          <td>
                            <button className="link receipt-link" onClick={() => setViewingReceipt(p)}>{p.receiptNo}</button>
                            {p.voidedAt && <span className="void-tag" title={p.voidReason}>Void</span>}
                          </td>
                          <td><span className="seat-pill seat-pill-sm">{p.seatLabel}</span></td>
                          <td className="nowrap">
                            {methodLabel(p.method)}
                            {p.reference && <small className="ref"> · {p.reference}</small>}
                          </td>
                          <td className="num nowrap">
                            <strong className={p.kind === 'refund' ? 'neg' : ''}>
                              {p.kind === 'refund' ? `− ${inr(p.amount)}` : inr(p.amount)}
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="profile-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Details</h2>
            </div>
            <dl className="details">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {m.notes && (
              <div className="member-notes">
                <span>Notes</span>
                <p>{m.notes}</p>
              </div>
            )}
          </section>

          <section className="panel portal-panel">
            <div className="panel-head">
              <h2>Member portal</h2>
              <p>
                {m.portal.enabled
                  ? `Can sign in with ${m.phone}. Last sign-in: ${m.portal.lastLogin ? timeAgo(m.portal.lastLogin) : 'never'}.`
                  : 'Let this member check their seat, dues and receipts, and pay online, from their phone.'}
              </p>
            </div>
            <span className={`status ${m.portal.enabled ? 'status-active' : 'status-idle'}`}>{m.portal.enabled ? 'Access on' : 'Access off'}</span>
            {canEdit && !archived && !m.anonymized && (
              <div className="portal-actions">
                {m.portal.enabled ? (
                  <>
                    <button className="btn btn-ghost btn-sm" disabled={portalBusy} onClick={() => portal('reset')}>Reset password</button>
                    <button className="btn btn-ghost btn-sm btn-ghost-danger" disabled={portalBusy} onClick={() => portal('disable')}>Turn off</button>
                  </>
                ) : (
                  <button className="btn btn-solid btn-sm" disabled={portalBusy} onClick={() => portal('enable')}>
                    {portalBusy && <span className="spinner" />} Give portal access
                  </button>
                )}
              </div>
            )}
          </section>

          {canEdit && (
            <section className="panel danger-zone">
              {m.anonymized ? (
                <>
                  <p>
                    This member's personal details were removed. Their bookings and payments are kept anonymously for your
                    records. You can delete those too.
                  </p>
                  <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={() => setDeleting(true)}>Delete record…</button>
                </>
              ) : archived ? (
                <>
                  <p>Archived members are hidden from lists and can't be booked. Restore them, or delete them for good.</p>
                  <div className="portal-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        try {
                          await restoreMember(m.id);
                          toast(`${m.name} restored.`);
                          load();
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      }}
                    >
                      Restore member
                    </button>
                    <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={() => setDeleting(true)}>Delete member…</button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {hasBookings
                      ? 'To archive this member, first release their current and upcoming seat bookings.'
                      : 'Left the reading room? Archive them to keep their history without cluttering your lists.'}
                  </p>
                  <button
                    className="btn btn-ghost btn-sm btn-ghost-danger"
                    onClick={() => setConfirm({ kind: 'archive' })}
                    disabled={hasBookings}
                  >
                    Archive member
                  </button>
                </>
              )}
            </section>
          )}
        </aside>
      </div>

      {editing && (
        <MemberFormModal
          member={m}
          today={today}
          onClose={() => setEditing(false)}
          onSaved={() => {
            toast('Member details saved.');
            setEditing(false);
            load();
          }}
        />
      )}
      {assigning && (
        <AssignSeatModal
          member={m}
          today={today}
          onClose={() => setAssigning(false)}
          onSaved={(a) => {
            toast(`Seat ${a.seatLabel} booked for ${m.name}.`);
            setAssigning(false);
            load();
          }}
        />
      )}
      {collecting && (
        <CollectPaymentModal
          booking={collecting}
          today={today}
          shiftLabel={bookingShift(collecting, SHIFTS).label}
          shiftTime={bookingShift(collecting, SHIFTS).time}
          onSaved={() => load()}
          onClose={() => setCollecting(null)}
        />
      )}
      {adjusting && (
        <AdjustFeeModal
          booking={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            toast('Fee updated.');
            setAdjusting(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteMemberModal
          member={m}
          onClose={() => setDeleting(false)}
          onDeleted={(mode) => {
            setDeleting(false);
            if (mode === 'anonymize') {
              toast('Personal details removed. Bookings and payments were kept.');
              load();
            } else {
              toast(`${m.name} was deleted.`);
              navigate('/admin/members', { replace: true });
            }
          }}
        />
      )}
      {portalCreds && <PortalCredentials member={m} {...portalCreds} onClose={() => setPortalCreds(null)} />}
      {viewingReceipt && (
        <ReceiptModal
          payment={viewingReceipt}
          shiftLabel={bookingShift(viewingReceipt, SHIFTS).label}
          shiftTime={bookingShift(viewingReceipt, SHIFTS).time}
          onClose={() => setViewingReceipt(null)}
        />
      )}
      {changing === 'choose' && (
        <Modal title="Which seat?" subtitle={`${m.name} has more than one seat today.`} onClose={() => setChanging(null)} width={420}>
          <div className="choice-cards">
            {st.current.map((b) => (
              <button key={b.id} type="button" className="choice-btn" onClick={() => setChanging(b)}>
                <strong>Seat {b.seatLabel}</strong>
                <span>{bookingShift(b, SHIFTS).label} · until {fmtShort(b.endDate)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {changing && changing !== 'choose' && (
        <ChangeSeatModal
          booking={changing}
          today={today}
          onClose={() => setChanging(null)}
          onSaved={(a) => {
            toast(`${m.name} moved from seat ${changing.seatLabel} to ${a.seatLabel}.`);
            setChanging(null);
            load();
          }}
        />
      )}
      {extending && (
        <ExtendModal
          allocation={extending}
          today={today}
          onClose={() => setExtending(null)}
          onSaved={(a) => {
            toast(`Extended to ${fmtDate(a.endDate)}.`);
            setExtending(null);
            load();
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          {...(confirm.kind === 'archive'
            ? {
                title: `Archive ${m.name}?`,
                message: 'Their profile and booking history are kept. You can restore them any time.',
                confirmLabel: 'Archive',
              }
            : {
                title: confirm.booking.startDate > today ? 'Cancel upcoming booking?' : `Release seat ${confirm.booking.seatLabel}?`,
                message:
                  confirm.booking.startDate > today
                    ? `The booking from ${fmtDate(confirm.booking.startDate)} will be cancelled.`
                    : 'The plan ends now and the seat becomes available immediately.',
                confirmLabel: confirm.booking.startDate > today ? 'Cancel booking' : 'Release seat',
              })}
          danger
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => !busy && setConfirm(null)}
        />
      )}
    </div>
  );
}

// One-time sign-in details for the member portal, with quick ways to share them.
function PortalCredentials({ member: m, password, isNew, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${publicUrl()}/member/login`;
  const message = [
    `Hi ${m.name.split(' ')[0]}, ${isNew ? 'your Knowledge Nest member portal is ready' : 'your Knowledge Nest portal password was reset'}.`,
    `Sign in: ${url}`,
    `Phone: ${m.phone}`,
    `One-time password: ${password}`,
    "You'll choose your own password when you sign in.",
  ].join('\n');
  let digits = m.phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      /* clipboard blocked; details are visible to copy by hand */
    }
  };

  return (
    <Modal
      title={isNew ? 'Portal access turned on' : 'Portal password reset'}
      subtitle="Share these details with the member. The password is shown only once."
      onClose={onClose}
      width={460}
      footer={<button className="btn btn-solid" onClick={onClose}>Done</button>}
    >
      <div className="credentials">
        <div><span>Sign in at</span><code>{url}</code></div>
        <div><span>Phone</span><code>{m.phone}</code></div>
        <div><span>One-time password</span><code>{password}</code></div>
      </div>
      <div className="share-row">
        <button className="btn btn-ghost" onClick={copy}><CopyIcon /> {copied ? 'Copied' : 'Copy message'}</button>
        <a className="btn btn-ghost btn-whatsapp" href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
          <MessageIcon /> Send on WhatsApp
        </a>
      </div>
    </Modal>
  );
}
