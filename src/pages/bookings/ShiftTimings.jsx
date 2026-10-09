import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getShifts, saveShifts } from '../../api/bookings.js';
import { useToast } from '../../components/Toast.jsx';
import { ClockIcon } from '../../components/Icons.jsx';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fmt = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const pct = (hhmm) => (toMinutes(hhmm) / 1440) * 100;

function toForm(shifts) {
  const by = Object.fromEntries(shifts.map((s) => [s.key, s]));
  return {
    morning: { label: by.morning.label, start: by.morning.start, end: by.morning.end },
    evening: { label: by.evening.label, start: by.evening.start, end: by.evening.end },
    full: { label: by.full.label },
  };
}

// Client-side mirror of the server rules, for instant feedback.
function problem(f) {
  for (const k of ['morning', 'evening']) {
    if (!f[k].label.trim()) return 'Every shift needs a name.';
    if (!f[k].start || !f[k].end) return `Enter both times for ${f[k].label}.`;
    if (f[k].start >= f[k].end) return `${f[k].label} must end after it starts.`;
  }
  if (!f.full.label.trim()) return 'Every shift needs a name.';
  if (f.morning.end > f.evening.start) return `${f.morning.label} must end by the time ${f.evening.label} starts.`;
  return '';
}

export default function ShiftTimings({ onSaved }) {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('settings.manage');
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShifts()
      .then((s) => {
        setSaved(toForm(s));
        setForm(toForm(s));
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!form) return error ? <div className="alert">{error}</div> : <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  // Time inputs can report seconds ("06:00:07"); shifts are kept to the minute.
  const set = (key, field) => (e) => {
    const value = e.target.type === 'time' ? e.target.value.slice(0, 5) : e.target.value;
    setForm((f) => ({ ...f, [key]: { ...f[key], [field]: value } }));
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const issue = problem(form);
  const valid = !issue;

  const submit = async (e) => {
    e.preventDefault();
    if (issue) return setError(issue);
    setSaving(true);
    setError('');
    try {
      const next = toForm(await saveShifts(form));
      setSaved(next);
      setForm(next);
      toast('Shift timings saved.');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <form className="timings" onSubmit={submit} noValidate>
      <section className="panel">
        <div className="panel-head">
          <h2>Daily schedule</h2>
          <p>A seat can be shared by one {form.morning.label.toLowerCase() || 'morning'} and one {form.evening.label.toLowerCase() || 'evening'} member, or held by one {form.full.label.toLowerCase() || 'full-day'} member.</p>
        </div>

        <div className="timeline" aria-hidden="true">
          <div className="timeline-track">
            {valid && (
              <>
                <span className="tl-seg tl-morning" style={{ left: `${pct(form.morning.start)}%`, width: `${pct(form.morning.end) - pct(form.morning.start)}%` }}>
                  {form.morning.label}
                </span>
                <span className="tl-seg tl-evening" style={{ left: `${pct(form.evening.start)}%`, width: `${pct(form.evening.end) - pct(form.evening.start)}%` }}>
                  {form.evening.label}
                </span>
                <span className="tl-full" style={{ left: `${pct(form.morning.start)}%`, width: `${pct(form.evening.end) - pct(form.morning.start)}%` }}>
                  <span>{form.full.label} · {fmt(form.morning.start)} – {fmt(form.evening.end)}</span>
                </span>
              </>
            )}
          </div>
          <div className="timeline-hours">
            {hours.map((h) => (
              <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h === 24 ? '' : fmt(`${String(h).padStart(2, '0')}:00`)}</span>
            ))}
          </div>
        </div>
      </section>

      <div className="timing-cards">
        {['morning', 'evening'].map((key) => (
          <section key={key} className={`panel timing-card timing-${key}`}>
            <div className="timing-card-head">
              <span className="timing-icon"><ClockIcon /></span>
              <h3>{form[key].label || 'Untitled shift'}</h3>
            </div>
            <label className="form-field">
              <span>Name</span>
              <input className="input" value={form[key].label} onChange={set(key, 'label')} disabled={!canEdit} maxLength={24} />
            </label>
            <div className="form-row form-row-even">
              <label className="form-field">
                <span>Starts</span>
                <input className="input" type="time" step={60} value={form[key].start} onChange={set(key, 'start')} disabled={!canEdit} />
              </label>
              <label className="form-field">
                <span>Ends</span>
                <input className="input" type="time" step={60} value={form[key].end} onChange={set(key, 'end')} disabled={!canEdit} />
              </label>
            </div>
          </section>
        ))}
        <section className="panel timing-card timing-full">
          <div className="timing-card-head">
            <span className="timing-icon"><ClockIcon /></span>
            <h3>{form.full.label || 'Untitled shift'}</h3>
          </div>
          <label className="form-field">
            <span>Name</span>
            <input className="input" value={form.full.label} onChange={set('full', 'label')} disabled={!canEdit} maxLength={24} />
          </label>
          <p className="hint">
            Runs from the start of {form.morning.label || 'the first shift'} to the end of {form.evening.label || 'the second shift'}
            {valid && <> ({fmt(form.morning.start)} – {fmt(form.evening.end)})</>}.
          </p>
        </section>
      </div>

      {(error || (dirty && issue)) && <div className="alert">{error || issue}</div>}

      <div className="timings-foot">
        <p className="hint">
          {canEdit
            ? 'Changing times updates labels everywhere. Existing bookings keep their shift; nobody is moved.'
            : 'Only people with the "Manage reading room settings" permission can change shift timings.'}
        </p>
        {canEdit && (
          <div className="timings-actions">
            {dirty && <button type="button" className="btn btn-ghost" onClick={() => { setForm(saved); setError(''); }}>Discard</button>}
            <button type="submit" className="btn btn-solid" disabled={!dirty || !valid || saving}>
              {saving && <span className="spinner" />} Save timings
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
