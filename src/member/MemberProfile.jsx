import { useState } from 'react';
import { useMember } from './MemberAuth.jsx';
import { changeMemberPassword, updateProfile } from '../api/memberPortal.js';
import { EXAM_SUGGESTIONS } from '../api/members.js';
import { fmtDate } from '../api/seats.js';
import PasswordForm from '../components/PasswordForm.jsx';
import { useToast } from '../components/Toast.jsx';

export default function MemberProfile() {
  const { member, setMember } = useMember();
  const toast = useToast();
  const initial = {
    email: member.email,
    preparingFor: member.preparingFor,
    guardianPhone: member.guardianPhone,
    address: member.address,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(initial).some((k) => form[k] !== initial[k]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      setMember(await updateProfile(form));
      toast('Your details were saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="member-page">
      <h1 className="member-title">Profile</h1>

      <section className="panel">
        <dl className="details">
          <div><dt>Name</dt><dd>{member.name}</dd></div>
          <div><dt>Member code</dt><dd>{member.code}</dd></div>
          <div><dt>Phone</dt><dd>{member.phone}</dd></div>
          <div><dt>Member since</dt><dd>{fmtDate(member.joinedOn)}</dd></div>
        </dl>
        <p className="hint">To change your name or phone number, please ask at the front desk.</p>
      </section>

      <section className="panel">
        <h2 className="member-h2">Your details</h2>
        <form onSubmit={submit} className="form-grid" noValidate>
          {error && <div className="alert">{error}</div>}
          <label className="form-field">
            <span>Email</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
          </label>
          <label className="form-field">
            <span>Preparing for</span>
            <input className="input" list="member-exams" value={form.preparingFor} onChange={set('preparingFor')} maxLength={80} />
            <datalist id="member-exams">{EXAM_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          <label className="form-field">
            <span>Emergency contact</span>
            <input className="input" type="tel" value={form.guardianPhone} onChange={set('guardianPhone')} placeholder="Parent / guardian phone" />
          </label>
          <label className="form-field">
            <span>Address</span>
            <textarea className="input textarea" rows={2} value={form.address} onChange={set('address')} maxLength={300} />
          </label>
          <button type="submit" className="btn btn-solid" disabled={!dirty || saving}>
            {saving && <span className="spinner" />} Save details
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="member-h2">Change password</h2>
        <PasswordForm changeFn={changeMemberPassword} onDone={(s) => { setMember(s); toast('Password changed.'); }} />
      </section>
    </div>
  );
}
