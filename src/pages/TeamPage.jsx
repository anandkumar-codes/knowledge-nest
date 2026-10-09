import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  canGrant, createUser, deleteUser, listRoles, listUsers, resetUserPassword, timeAgo, updateUser,
} from '../api/team.js';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { initials } from '../components/AdminLayout.jsx';
import { CopyIcon, CrownIcon, EditIcon, KeyIcon, PlusIcon, SearchIcon, TrashIcon } from '../components/Icons.jsx';
import { publicUrl } from '../platform/native.js';

export default function TeamPage() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const canManage = can('team.manage');

  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const [editing, setEditing] = useState(null); // user object, or {} for new
  const [confirm, setConfirm] = useState(null); // { kind, user }
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null); // { email, password, title }

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()]);
      setUsers(u);
      setRoles(r);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (roleFilter === 'super' && !u.isSuperAdmin) return false;
      if (roleFilter !== 'all' && roleFilter !== 'super' && u.role?.id !== roleFilter) return false;
      return !q || u.name.toLowerCase().includes(q) || u.email.includes(q);
    });
  }, [users, query, roleFilter]);

  const rolePerms = (u) => roles.find((r) => r.id === u.role?.id)?.permissions ?? [];
  const isManageable = (u) => canManage && !u.isSuperAdmin && u.id !== me.id && canGrant(me, rolePerms(u));

  const runConfirm = async () => {
    const { kind, user: u } = confirm;
    setBusy(true);
    try {
      if (kind === 'delete') {
        await deleteUser(u.id);
        toast(`${u.name} was removed from the team.`);
      } else if (kind === 'toggle') {
        const status = u.status === 'active' ? 'disabled' : 'active';
        await updateUser(u.id, { status });
        toast(status === 'disabled' ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`);
      } else if (kind === 'reset') {
        const { tempPassword } = await resetUserPassword(u.id);
        setCredentials({ title: 'Password reset', email: u.email, password: tempPassword });
      }
      setConfirm(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = users && {
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    disabled: users.filter((u) => u.status === 'disabled').length,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1>Team</h1>
          <p className="page-sub">People who can sign in to the Knowledge Nest admin console.</p>
        </div>
        {canManage && (
          <button className="btn btn-solid" onClick={() => setEditing({})}>
            <PlusIcon /> Add team member
          </button>
        )}
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search team"
            />
          </div>
          <select className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
            <option value="all">All roles</option>
            <option value="super">Super admin</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {counts && (
            <div className="toolbar-meta">
              {counts.total} members · {counts.active} active{counts.disabled ? ` · ${counts.disabled} disabled` : ''}
            </div>
          )}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                {canManage && <th className="th-actions"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {users === null && !error && (
                <tr><td colSpan={5} className="table-empty"><span className="spinner spinner-dark" /></td></tr>
              )}
              {users && filtered.length === 0 && (
                <tr><td colSpan={5} className="table-empty">No team members match your search.</td></tr>
              )}
              {filtered.map((u) => (
                <tr key={u.id} className={u.status === 'disabled' ? 'row-muted' : ''}>
                  <td>
                    <div className="member">
                      <span className={`avatar${u.isSuperAdmin ? ' avatar-sand' : ''}`}>{initials(u.name)}</span>
                      <div>
                        <strong>{u.name}{u.id === me.id && <span className="you">You</span>}</strong>
                        <span>{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {u.isSuperAdmin ? (
                      <span className="badge badge-sand"><CrownIcon width={12} height={12} /> Super admin</span>
                    ) : (
                      <span className="badge">{u.role?.name ?? '—'}</span>
                    )}
                  </td>
                  <td>
                    <span className={`status status-${u.status}`}>{u.status === 'active' ? 'Active' : 'Disabled'}</span>
                  </td>
                  <td className="muted">{timeAgo(u.lastLoginAt)}</td>
                  {canManage && (
                    <td className="td-actions">
                      {isManageable(u) && (
                        <div className="row-actions">
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}>
                            <EditIcon />
                          </button>
                          <button className="icon-btn" title="Reset password" aria-label={`Reset password for ${u.name}`} onClick={() => setConfirm({ kind: 'reset', user: u })}>
                            <KeyIcon />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ kind: 'toggle', user: u })}>
                            {u.status === 'active' ? 'Disable' : 'Enable'}
                          </button>
                          <button className="icon-btn icon-btn-danger" title="Remove" aria-label={`Remove ${u.name}`} onClick={() => setConfirm({ kind: 'delete', user: u })}>
                            <TrashIcon />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <MemberModal
          member={editing.id ? editing : null}
          roles={roles}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null);
            load();
            if (result.tempPassword) {
              setCredentials({ title: 'Team member added', email: result.user.email, password: result.tempPassword });
            } else {
              toast(editing.id ? 'Changes saved.' : `${result.user.name} was added to the team.`);
            }
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          {...{
            delete: {
              title: 'Remove team member?',
              message: `${confirm.user.name} will lose access immediately and their account will be deleted. This can't be undone.`,
              confirmLabel: 'Remove',
              danger: true,
            },
            toggle: confirm.user.status === 'active'
              ? { title: 'Disable account?', message: `${confirm.user.name} will be signed out and won't be able to sign in until re-enabled.`, confirmLabel: 'Disable', danger: true }
              : { title: 'Enable account?', message: `${confirm.user.name} will be able to sign in again.`, confirmLabel: 'Enable' },
            reset: {
              title: 'Reset password?',
              message: `A new temporary password will be generated for ${confirm.user.name}. Their current password will stop working.`,
              confirmLabel: 'Reset password',
            },
          }[confirm.kind]}
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => !busy && setConfirm(null)}
        />
      )}

      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

function MemberModal({ member, roles, me, onClose, onSaved }) {
  const isNew = !member;
  const grantable = roles.filter((r) => canGrant(me, r.permissions));
  const [form, setForm] = useState({
    name: member?.name ?? '',
    email: member?.email ?? '',
    roleId: member?.role?.id ?? grantable[0]?.id ?? '',
    passwordMode: 'generate',
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const selectedRole = roles.find((r) => r.id === form.roleId);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Enter a name.');
    if (isNew && !form.email.trim()) return setError('Enter an email address.');
    if (!form.roleId) return setError('Choose a role.');
    if (isNew && form.passwordMode === 'set' && (form.password.length < 8 || !/[a-z]/i.test(form.password) || !/\d/.test(form.password))) {
      return setError('Use at least 8 characters, including a letter and a number.');
    }
    setSaving(true);
    try {
      const result = isNew
        ? await createUser({
            name: form.name.trim(),
            email: form.email.trim(),
            roleId: form.roleId,
            ...(form.passwordMode === 'set' ? { password: form.password } : {}),
          })
        : { user: await updateUser(member.id, { name: form.name.trim(), roleId: form.roleId }) };
      onSaved(result);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add team member' : `Edit ${member.name}`}
      subtitle={isNew ? 'They can sign in to the admin console with the role you choose.' : member.email}
      onClose={onClose}
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
        <label className="form-field">
          <span>Full name</span>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Priya Sharma" />
        </label>
        {isNew && (
          <label className="form-field">
            <span>Email address</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="priya@knowledgenest.in" />
          </label>
        )}
        <label className="form-field">
          <span>Role</span>
          <select className="input" value={form.roleId} onChange={set('roleId')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id} disabled={!canGrant(me, r.permissions)}>
                {r.name}{!canGrant(me, r.permissions) ? ' (beyond your access)' : ''}
              </option>
            ))}
          </select>
          {selectedRole && (
            <small className="hint">
              {selectedRole.description || 'No description.'} · {selectedRole.permissions.length} permissions
            </small>
          )}
        </label>

        {isNew && (
          <fieldset className="form-field">
            <span>Password</span>
            <div className="segmented">
              <label className={form.passwordMode === 'generate' ? 'on' : ''}>
                <input type="radio" name="pm" value="generate" checked={form.passwordMode === 'generate'} onChange={set('passwordMode')} />
                Generate temporary
              </label>
              <label className={form.passwordMode === 'set' ? 'on' : ''}>
                <input type="radio" name="pm" value="set" checked={form.passwordMode === 'set'} onChange={set('passwordMode')} />
                Set it now
              </label>
            </div>
            {form.passwordMode === 'set' ? (
              <input className="input" type="text" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="8+ characters, a letter and a number" />
            ) : (
              <small className="hint">We'll show you a one-time password to share with them.</small>
            )}
            {form.passwordMode === 'set' && (
              <small className="hint">They'll be asked to replace it with their own when they first sign in.</small>
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

function CredentialsModal({ title, email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          'Knowledge Nest admin',
          `Sign in: ${publicUrl()}/admin/login`,
          `Email: ${email}`,
          `Temporary password: ${password}`,
          "You'll be asked to choose your own password when you first sign in.",
        ].join('\n')
      );
      setCopied(true);
    } catch {
      /* clipboard blocked; the values are visible to copy by hand */
    }
  };
  return (
    <Modal
      title={title}
      subtitle="Share these sign-in details securely. They'll be asked to choose their own password when they first sign in."
      onClose={onClose}
      width={460}
      footer={<button className="btn btn-solid" onClick={onClose}>Done</button>}
    >
      <div className="credentials">
        <div><span>Email</span><code>{email}</code></div>
        <div><span>Temporary password</span><code>{password}</code></div>
      </div>
      <button className="btn btn-ghost btn-block" onClick={copy}>
        <CopyIcon /> {copied ? 'Copied to clipboard' : 'Copy details'}
      </button>
    </Modal>
  );
}
