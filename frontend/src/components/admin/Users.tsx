"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { email as emailErr, maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Modal } from "./Modal";
import { Switch } from "./Switch";
import { Select } from "../Select";
import { Plus } from "../Icons";
import { useApi } from "./hooks";

type Role = { id: string; name: string; description: string; isSystem: boolean; users: number; permissions: string[] };
type Staff = { id: string; email: string; name: string; active: boolean; lastLoginAt: string | null; createdAt: string; role: { id: string; name: string } | null };

const generate = () => {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join("");
};
const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");
const pwErr = (v: string) => (!v ? "Enter a password" : v.length < 10 ? `Use at least 10 characters (${v.length} so far)` : "");

function PasswordField({ id, value, onChange, val, k }: { id: string; value: string; onChange: (v: string) => void; val: ReturnType<typeof useValidation>; k: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field"><div className="genrow"><label htmlFor={id}>Password</label><span className="acts"><button className="link" type="button" onClick={() => { onChange(generate()); setShow(true); }}>Generate</button><button className="link" type="button" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button></span></div>
      <input id={id} type={show ? "text" : "password"} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} {...val.props(k)} />
      <FieldError k={k} msg={val.err(k)} />
      <div className="muted">Share it with them securely. They can change it under My account.</div>
    </div>
  );
}

function AddUser({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", roleId: "", password: "" });
  const [srv, setSrv] = useState<{ email?: string; role?: string }>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const val = useValidation({
    name: required(f.name, "Enter a name") || maxLen(f.name, 100, "The name"),
    email: emailErr(f.email, true) || srv.email || "",
    roleId: f.roleId ? srv.role ?? "" : "Choose a role",
    password: pwErr(f.password),
  });
  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try { await api("/users", { method: "POST", json: { ...f, email: f.email.trim() } }); onDone(); }
    catch (e) { const m = (e as Error).message; if (/email/i.test(m)) setSrv({ email: m }); else if (/role|grant|owner/i.test(m)) setSrv({ role: m }); else setErr(m); setBusy(false); }
  };
  return (
    <Modal title="Add user" onClose={onClose} dismissOnScrim={false} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add user"}</button></>}>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <div className="field"><label htmlFor="u-name">Name</label><input id="u-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
        <div className="field"><label htmlFor="u-email">Email</label><input id="u-email" type="email" value={f.email} onChange={(e) => { setSrv({}); setF({ ...f, email: e.target.value }); }} {...val.props("email")} /><FieldError k="email" msg={val.err("email")} /></div>
      </div>
      <div className="field"><label>Role</label>
        <Select value={f.roleId} onChange={(e) => { setSrv({}); setF({ ...f, roleId: e.target.value }); }} {...val.props("roleId")}>
          <option value="">Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <FieldError k="roleId" msg={val.err("roleId")} />
        {roles.find((r) => r.id === f.roleId)?.description && <div className="muted">{roles.find((r) => r.id === f.roleId)!.description}</div>}
      </div>
      <PasswordField id="u-pw" value={f.password} onChange={(password) => setF({ ...f, password })} val={val} k="password" />
    </Modal>
  );
}

function EditUser({ u, roles, isMe, onClose, onDone }: { u: Staff; roles: Role[]; isMe: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: u.name, roleId: u.role?.id ?? "", active: u.active });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [ok, setOk] = useState("");
  const val = useValidation({ name: required(f.name, "Enter a name") || maxLen(f.name, 100, "The name"), roleId: f.roleId ? "" : "Choose a role" });
  const pv = useValidation({ pw: pwErr(pw ?? "") });
  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try { await api(`/users/${u.id}`, { method: "PUT", json: f }); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const reset = async () => {
    if (!pv.submit()) return;
    setPwBusy(true); setErr(""); setOk("");
    try { await api(`/users/${u.id}/reset-password`, { method: "POST", json: { password: pw } }); setOk(`Password changed. ${u.name || u.email} was signed out everywhere.`); setPw(null); pv.reset(); }
    catch (e) { setErr((e as Error).message); }
    setPwBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Delete ${u.name || u.email}? They lose access immediately. Orders they handled are not affected.`)) return;
    try { await api(`/users/${u.id}`, { method: "DELETE" }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={u.name || u.email} onClose={onClose} dismissOnScrim={false} footer={<>{!isMe && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}<button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      {err && <div className="error">{err}</div>}
      {ok && <div className="okmsg">{ok}</div>}
      <p className="muted" style={{ marginTop: 0 }}>{u.email}</p>
      <div className="field"><label htmlFor="e-name">Name</label><input id="e-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
      <div className="field"><label>Role</label>
        <Select value={f.roleId} disabled={isMe} onChange={(e) => setF({ ...f, roleId: e.target.value })} {...val.props("roleId")}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <FieldError k="roleId" msg={val.err("roleId")} />
        {isMe && <div className="muted">You can't change your own role.</div>}
      </div>
      <div className="cardhead" style={{ marginBottom: 12 }}>
        <span><b>Can sign in</b><div className="muted">Turn off to block access without deleting the user.</div></span>
        <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label="Can sign in" disabled={isMe} />
      </div>
      <h4>Reset password</h4>
      {pw === null ? <button onClick={() => { setPw(""); setOk(""); }}>Set a new password</button> : (
        <>
          <PasswordField id="e-pw" value={pw} onChange={setPw} val={pv} k="pw" />
          <button className="primary" disabled={pwBusy} onClick={reset}>{pwBusy ? "Saving…" : "Change password"}</button> <button onClick={() => { setPw(null); pv.reset(); }}>Cancel</button>
        </>
      )}
    </Modal>
  );
}

export function Users() {
  const { user } = useCan();
  const { data: users, error, reload } = useApi<Staff[]>("/users");
  const { data: roles } = useApi<Role[]>("/roles");
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Staff | null>(null);
  const [q, setQ] = useState("");
  const shown = (users ?? []).filter((u) => `${u.name} ${u.email} ${u.role?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="pagehead">
        <div><h2>Users</h2><div className="muted">Staff who can sign in to this admin. What they can do depends on their role.</div></div>
        <div className="headtools"><button className="primary" disabled={!roles} onClick={() => setAdd(true)}><Plus />Add user</button></div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="field"><label htmlFor="u-q">Search users</label><input id="u-q" value={q} placeholder="Name, email or role" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="tablescroll">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setEdit(u)}>
                  <td><b>{u.name || u.email}</b>{u.id === user?.id && <span className="chip">You</span>}<div className="muted">{u.email}</div></td>
                  <td>{u.role?.name ?? <span className="muted">No role</span>}</td>
                  <td><span className={`badge ${u.active ? "ok" : ""}`}>{u.active ? "Active" : "Deactivated"}</span></td>
                  <td className="muted">{ago(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users && !shown.length && <p className="muted">No users match.</p>}
      </div>
      {add && roles && <AddUser roles={roles} onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
      {edit && roles && <EditUser u={edit} roles={roles} isMe={edit.id === user?.id} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}
