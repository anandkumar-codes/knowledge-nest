import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { canGrant, createRole, deleteRole, listPermissions, listRoles, updateRole } from '../api/team.js';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { CrownIcon, EditIcon, PlusIcon, TrashIcon, UsersIcon } from '../components/Icons.jsx';

const groupBy = (perms) =>
  perms.reduce((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

export default function RolesPage() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const canManage = can('roles.manage');

  const [roles, setRoles] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // role, {} for new
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([listRoles(), listPermissions()]);
      setRoles(r);
      setCatalog(p);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupBy(catalog), [catalog]);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteRole(deleting.id);
      toast(`Role "${deleting.name}" deleted.`);
      setDeleting(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1>Roles &amp; access</h1>
          <p className="page-sub">Each role is a set of permissions. Assign roles to team members on the Team page.</p>
        </div>
        {canManage && (
          <button className="btn btn-solid" onClick={() => setEditing({})}>
            <PlusIcon /> New role
          </button>
        )}
      </header>

      {error && <div className="alert">{error}</div>}
      {roles === null && !error && <div className="page-loading"><span className="spinner spinner-dark" /></div>}

      {roles && (
        <div className="role-grid">
          <article className="role-card role-card-super">
            <div className="role-card-head">
              <span className="role-icon"><CrownIcon /></span>
              <div>
                <h3>Super admin</h3>
                <p>The owner account. Holds every permission and can't be edited or removed.</p>
              </div>
            </div>
            <div className="role-meta">
              <span>All {catalog.length} permissions</span>
              <span>1 member</span>
            </div>
          </article>

          {roles.map((role) => {
            const editable = canManage && canGrant(me, role.permissions);
            const covered = Object.entries(groups).filter(([, ps]) => ps.some((p) => role.permissions.includes(p.key)));
            return (
              <article key={role.id} className="role-card">
                <div className="role-card-head">
                  <span className="role-icon">{role.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <h3>{role.name}</h3>
                    <p>{role.description || 'No description.'}</p>
                  </div>
                </div>
                <div className="chips">
                  {covered.length === 0 && <span className="chip chip-empty">No permissions</span>}
                  {covered.map(([group, ps]) => {
                    const n = ps.filter((p) => role.permissions.includes(p.key)).length;
                    return (
                      <span key={group} className="chip" title={`${n} of ${ps.length}`}>
                        {group}{n < ps.length ? ` ${n}/${ps.length}` : ''}
                      </span>
                    );
                  })}
                </div>
                <div className="role-meta">
                  <span>{role.permissions.length} of {catalog.length} permissions</span>
                  <span><UsersIcon width={14} height={14} /> {role.memberCount} member{role.memberCount === 1 ? '' : 's'}</span>
                </div>
                <div className="role-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...role, readOnly: !editable })}>
                    {editable ? <><EditIcon width={15} height={15} /> Edit</> : 'View'}
                  </button>
                  {editable && (
                    <button
                      className="icon-btn icon-btn-danger"
                      onClick={() => setDeleting(role)}
                      disabled={role.memberCount > 0}
                      title={role.memberCount > 0 ? 'Reassign its members before deleting' : 'Delete role'}
                      aria-label={`Delete ${role.name}`}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <RoleEditor
          role={editing.id ? editing : null}
          readOnly={editing.readOnly}
          groups={groups}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            toast(editing.id ? `Role "${saved.name}" updated.` : `Role "${saved.name}" created.`);
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message="This role will be removed permanently. No team members are using it."
          confirmLabel="Delete role"
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => !busy && setDeleting(null)}
        />
      )}
    </div>
  );
}

function RoleEditor({ role, readOnly, groups, me, onClose, onSaved }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState(() => new Set(role?.permissions ?? ['dashboard.view']));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const mine = (key) => me.isSuperAdmin || me.permissions.includes(key);
  const toggle = (key) =>
    setPerms((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const setGroup = (ps, on) =>
    setPerms((s) => {
      const next = new Set(s);
      ps.filter((p) => mine(p.key)).forEach((p) => (on ? next.add(p.key) : next.delete(p.key)));
      return next;
    });

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the role a name.');
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim(), permissions: [...perms] };
      onSaved(role ? await updateRole(role.id, body) : await createRole(body));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={readOnly ? role.name : role ? `Edit ${role.name}` : 'New role'}
      subtitle={readOnly ? 'You can view this role but not change it.' : 'Choose exactly what people with this role can do.'}
      onClose={onClose}
      width={720}
      footer={
        readOnly ? (
          <button className="btn btn-solid" onClick={onClose}>Close</button>
        ) : (
          <>
            <span className="foot-note">{perms.size} permission{perms.size === 1 ? '' : 's'} selected</span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" form="role-form" className="btn btn-solid" disabled={saving}>
              {saving && <span className="spinner" />} {role ? 'Save role' : 'Create role'}
            </button>
          </>
        )
      }
    >
      <form id="role-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        {role?.memberCount > 0 && !readOnly && (
          <div className="note">Changes apply immediately to the {role.memberCount} member{role.memberCount === 1 ? '' : 's'} with this role.</div>
        )}
        <div className="form-row">
          <label className="form-field">
            <span>Role name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder="e.g. Evening Supervisor" maxLength={40} />
          </label>
          <label className="form-field">
            <span>Description</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} placeholder="What is this role for?" maxLength={200} />
          </label>
        </div>

        <div className="perm-matrix">
          {Object.entries(groups).map(([group, ps]) => {
            const grantable = ps.filter((p) => mine(p.key));
            const allOn = grantable.length > 0 && grantable.every((p) => perms.has(p.key));
            return (
              <div key={group} className="perm-group">
                <div className="perm-group-head">
                  <h4>{group}</h4>
                  {!readOnly && grantable.length > 1 && (
                    <button type="button" className="link" onClick={() => setGroup(ps, !allOn)}>
                      {allOn ? 'Clear' : 'Select all'}
                    </button>
                  )}
                </div>
                {ps.map((p) => {
                  const locked = readOnly || !mine(p.key);
                  return (
                    <label key={p.key} className={`perm${locked ? ' locked' : ''}`} title={!readOnly && !mine(p.key) ? "You can't grant a permission you don't have" : undefined}>
                      <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} disabled={locked} />
                      <span className="box" />
                      <span className="perm-text">
                        {p.label}
                        <code>{p.key}</code>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}
