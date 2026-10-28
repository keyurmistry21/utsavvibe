"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft, Plus } from "../Icons";
import { useApi } from "./hooks";

type Role = { id?: string; name: string; description: string; isSystem?: boolean; users?: number; permissions: string[] };
type Meta = { groups: { group: string; items: { key: string; label: string }[] }[] };

function RoleEditor({ initial, meta, onDone }: { initial: Role; meta: Meta; onDone: () => void }) {
  const { can } = useCan();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [srvName, setSrvName] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!initial.isSystem;
  const val = useValidation({ name: required(f.name, "Enter a role name") || maxLen(f.name, 50, "The name") || srvName, description: maxLen(f.description, 300, "The description") });

  // manage includes view, so ticking one ticks the other and unticking view unticks manage
  const toggle = (key: string, on: boolean) => setF((c) => {
    const s = new Set(c.permissions);
    const area = key.split(".")[0];
    if (on) { s.add(key); if (key.endsWith(".manage") && meta.groups.some((g) => g.items.some((i) => i.key === `${area}.view`))) s.add(`${area}.view`); }
    else { s.delete(key); if (key.endsWith(".view")) s.delete(`${area}.manage`); }
    return { ...c, permissions: [...s] };
  });

  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try { await api(f.id ? `/roles/${f.id}` : "/roles", { method: f.id ? "PUT" : "POST", json: { name: f.name, description: f.description, permissions: f.permissions } }); onDone(); }
    catch (e) { const m = (e as Error).message; if (/already exists/.test(m)) setSrvName(m); else setErr(m); setBusy(false); }
  };
  const remove = async () => {
    if (!f.id || !confirm(`Delete the role "${f.name}"?`)) return;
    try { await api(`/roles/${f.id}`, { method: "DELETE" }); onDone(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={onDone}><ArrowLeft />Roles and permissions</button></div>
      <div className="pagehead"><h2>{f.id ? f.name : "Add role"}</h2></div>
      {err && <div className="error">{err}</div>}
      {locked && <div className="okmsg">The Owner role always has full access and can't be changed.</div>}
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="field"><label htmlFor="r-name">Role name</label><input id="r-name" autoFocus disabled={locked} value={f.name} onChange={(e) => { setSrvName(""); setF({ ...f, name: e.target.value }); }} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="r-desc">Description</label><input id="r-desc" disabled={locked} value={f.description} placeholder="What is this role for?" onChange={(e) => setF({ ...f, description: e.target.value })} {...val.props("description")} /><FieldError k="description" msg={val.err("description")} /></div>
      </div>
      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Permissions</h3>
        <p className="muted" style={{ marginTop: -4 }}>You can only give access you have yourself. "Manage" includes "view".</p>
        {meta.groups.map((g) => (
          <div key={g.group} className="permgroup">
            <h4>{g.group}</h4>
            {g.items.map((i) => {
              const on = locked || f.permissions.includes(i.key);
              const blocked = !locked && !can(i.key);
              return (
                <label key={i.key} className={`check ${blocked ? "off" : ""}`} title={blocked ? "You don't have this permission yourself" : ""}>
                  <input type="checkbox" checked={on} disabled={locked || blocked} onChange={(e) => toggle(i.key, e.target.checked)} />
                  <span><b>{i.key.endsWith(".view") ? "View" : i.key.endsWith(".manage") ? "Manage" : "Access"}</b> · {i.label}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div className="savebar">
        {f.id && !locked && <button className="danger" onClick={remove}>Delete role</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onDone}>{locked ? "Back" : "Discard"}</button>
        {!locked && <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
      </div>
    </>
  );
}

export function Roles() {
  const { data: roles, error, reload } = useApi<Role[]>("/roles");
  const { data: meta } = useApi<Meta>("/users/meta");
  const [edit, setEdit] = useState<Role | null>(null);
  if (edit && meta) return <RoleEditor key={edit.id ?? "new"} initial={edit} meta={meta} onDone={() => { setEdit(null); reload(); }} />;
  return (
    <>
      <div className="pagehead">
        <div><h2>Roles and permissions</h2><div className="muted">A role is a set of things staff are allowed to do. Give each person the least access they need.</div></div>
        <div className="headtools"><button className="primary" disabled={!meta} onClick={() => setEdit({ name: "", description: "", permissions: [] })}><Plus />Add role</button></div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="tablescroll">
          <table>
            <thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Users</th></tr></thead>
            <tbody>
              {roles?.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setEdit(r)}>
                  <td><b>{r.name}</b>{r.isSystem && <span className="chip">Locked</span>}</td>
                  <td className="muted">{r.description}</td>
                  <td>{r.isSystem ? "All" : r.permissions.length}</td>
                  <td>{r.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
