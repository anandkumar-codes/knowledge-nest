import { useState } from 'react';
import { EXAM_SUGGESTIONS, GENDERS, createMember, updateMember } from '../api/members.js';
import Modal from './Modal.jsx';

export default function MemberFormModal({ member, today, onClose, onSaved }) {
  const isNew = !member;
  const [form, setForm] = useState({
    name: member?.name ?? '',
    phone: member?.phone ?? '',
    email: member?.email ?? '',
    gender: member?.gender ?? '',
    preparingFor: member?.preparingFor ?? '',
    guardianPhone: member?.guardianPhone ?? '',
    joinedOn: member?.joinedOn ?? today,
    address: member?.address ?? '',
    notes: member?.notes ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError("Enter the member's name.");
    if (!form.phone.trim()) return setError('Enter a phone number.');
    setSaving(true);
    try {
      onSaved(isNew ? await createMember(form) : await updateMember(member.id, form));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add member' : `Edit ${member.name}`}
      subtitle={isNew ? 'Register someone who studies at Knowledge Nest.' : member.code}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="member-form" className="btn btn-solid" disabled={saving}>
            {saving && <span className="spinner" />} {isNew ? 'Add member' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}

        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Full name</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Priya Sharma" maxLength={80} />
          </label>
          <label className="form-field">
            <span>Phone</span>
            <input className="input" type="tel" value={form.phone} onChange={set('phone')} placeholder="98765 43210" />
          </label>
        </div>

        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Email <em className="optional">optional</em></span>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="priya@example.com" />
          </label>
          <label className="form-field">
            <span>Gender <em className="optional">optional</em></span>
            <select className="input" value={form.gender} onChange={set('gender')}>
              {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>

        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Preparing for <em className="optional">optional</em></span>
            <input className="input" list="exam-suggestions" value={form.preparingFor} onChange={set('preparingFor')} placeholder="e.g. UPSC CSE" maxLength={80} />
            <datalist id="exam-suggestions">
              {EXAM_SUGGESTIONS.map((x) => <option key={x} value={x} />)}
            </datalist>
          </label>
          <label className="form-field">
            <span>Emergency contact <em className="optional">optional</em></span>
            <input className="input" type="tel" value={form.guardianPhone} onChange={set('guardianPhone')} placeholder="Parent / guardian phone" />
          </label>
        </div>

        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Joined on</span>
            <input className="input" type="date" value={form.joinedOn} onChange={set('joinedOn')} />
          </label>
          <span />
        </div>

        <label className="form-field">
          <span>Address <em className="optional">optional</em></span>
          <textarea className="input textarea" rows={2} value={form.address} onChange={set('address')} maxLength={300} />
        </label>
        <label className="form-field">
          <span>Notes <em className="optional">optional</em></span>
          <textarea className="input textarea" rows={2} value={form.notes} onChange={set('notes')} maxLength={500} placeholder="Anything the front desk should know" />
        </label>
      </form>
    </Modal>
  );
}
