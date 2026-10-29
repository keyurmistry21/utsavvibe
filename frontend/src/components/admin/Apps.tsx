"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { required, maxLen } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Modal } from "./Modal";
import { Select } from "../Select";
import { Plus } from "../Icons";
import { CopyBox } from "./CopyBox";
import { useApi } from "./hooks";

type Role = { id: string; name: string; isSystem: boolean; permissions: string[] };
type Key = { id: string; name: string; prefix: string; role: string; createdBy: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Delivery = { event: string; status: number; error: string; at: string };
type Hook = { id: string; url: string; events: string[]; active: boolean; recent: Delivery[] };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

function Secret({ title, secret, onClose }: { title: string; secret: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} dismissOnScrim={false} footer={<button className="primary" onClick={onClose}>I've copied it</button>}>
      <div className="error" role="alert">Copy it now. For your security it is shown only once and can't be shown again.</div>
      <CopyBox value={secret} label="Secret" />
    </Modal>
  );
}

function KeySection() {
  const { data: keys, error, reload } = useApi<Key[]>("/integrations/api-keys");
  const { data: roles } = useApi<Role[]>("/roles");
  const { user } = useCan();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed = (roles ?? []).filter((r) => !r.isSystem && !r.permissions.includes("users.manage") && !r.permissions.includes("integrations.manage") && (user?.owner || r.permissions.every((p) => user?.permissions.includes(p))));
  const val = useValidation({ name: required(name, "Give the key a name") || maxLen(name, 60, "The name"), roleId: roleId ? "" : "Choose a role" });
  const create = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try { const r = await api<{ secret: string }>("/integrations/api-keys", { method: "POST", json: { name, roleId } }); setSecret(r.secret); setAdding(false); setName(""); setRoleId(""); val.reset(); reload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const revoke = async (k: Key) => {
    if (!confirm(`Revoke "${k.name}"? Anything using this key stops working immediately.`)) return;
    try { await api(`/integrations/api-keys/${k.id}`, { method: "DELETE" }); reload(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card">
      <div className="cardhead"><h3 style={{ margin: 0 }}>API keys</h3><button className="primary" onClick={() => { setAdding(true); setErr(""); }}><Plus />Create key</button></div>
      <p className="muted">A key lets a script or tool use the admin API with the access of one role. Create a dedicated role (Settings → Roles) with only what the tool needs.</p>
      {(error || err) && !adding && <div className="error">{error || err}</div>}
      <div className="tablescroll">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th>Role</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {keys?.map((k) => (
              <tr key={k.id}>
                <td><b>{k.name}</b><div className="muted">by {k.createdBy || "—"}</div></td>
                <td><code>{k.prefix}…</code></td>
                <td>{k.role}</td>
                <td className="muted">{k.revokedAt ? <span className="badge bad">Revoked</span> : when(k.lastUsedAt)}</td>
                <td>{!k.revokedAt && <button className="danger" onClick={() => revoke(k)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys && !keys.length && <p className="muted">No API keys yet.</p>}
      {adding && (
        <Modal title="Create API key" onClose={() => setAdding(false)} dismissOnScrim={false} footer={<><button onClick={() => setAdding(false)}>Cancel</button><button className="primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create key"}</button></>}>
          {err && <div className="error">{err}</div>}
          <div className="field"><label htmlFor="k-name">Name</label><input id="k-name" autoFocus placeholder="e.g. Zapier orders" value={name} onChange={(e) => setName(e.target.value)} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
          <div className="field"><label>Role</label>
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} {...val.props("roleId")}>
              <option value="">Choose a role…</option>
              {allowed.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <FieldError k="roleId" msg={val.err("roleId")} />
            <div className="muted">Owner and roles that manage staff or integrations can't be used for keys.</div>
          </div>
        </Modal>
      )}
      {secret && <Secret title="Your new API key" secret={secret} onClose={() => setSecret("")} />}
    </div>
  );
}

function HookForm({ hook, events, onClose, onDone }: { hook: Hook | null; events: string[]; onClose: () => void; onDone: (secret?: string) => void }) {
  const [url, setUrl] = useState(hook?.url ?? "");
  const [sel, setSel] = useState<string[]>(hook?.events ?? []);
  const [active, setActive] = useState(hook?.active ?? true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const val = useValidation({ url: required(url, "Enter the URL that should receive events") || (/^https?:\/\//i.test(url) ? "" : "The URL must start with https://"), events: sel.length ? "" : "Pick at least one event" });
  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ secret?: string }>(hook ? `/integrations/webhooks/${hook.id}` : "/integrations/webhooks", { method: hook ? "PUT" : "POST", json: { url: url.trim(), events: sel, active } });
      onDone(r.secret);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={hook ? "Edit webhook" : "Add webhook"} onClose={onClose} dismissOnScrim={false} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      {err && <div className="error">{err}</div>}
      <div className="field"><label htmlFor="w-url">Endpoint URL</label><input id="w-url" autoFocus placeholder="https://hooks.zapier.com/…" value={url} onChange={(e) => setUrl(e.target.value)} {...val.props("url")} /><FieldError k="url" msg={val.err("url")} /></div>
      <div className="field"><label>Events</label>
        {events.map((ev) => (
          <label key={ev} className="check" style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
            <input type="checkbox" checked={sel.includes(ev)} onChange={(e) => setSel(e.target.checked ? [...sel, ev] : sel.filter((x) => x !== ev))} /><code>{ev}</code>
          </label>
        ))}
        <FieldError k="events" msg={val.err("events")} />
      </div>
      <label className="check" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
    </Modal>
  );
}

function HookSection() {
  const { data, error, reload } = useApi<{ events: string[]; hooks: Hook[] }>("/integrations/webhooks");
  const [edit, setEdit] = useState<Hook | "new" | null>(null);
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState<Record<string, Delivery[]>>({});
  const test = async (h: Hook) => {
    setErr("");
    try { const r = await api<{ deliveries: Delivery[] }>(`/integrations/webhooks/${h.id}/test`, { method: "POST" }); setLog({ ...log, [h.id]: r.deliveries }); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const remove = async (h: Hook) => {
    if (!confirm(`Delete the webhook for ${h.url}?`)) return;
    try { await api(`/integrations/webhooks/${h.id}`, { method: "DELETE" }); reload(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card">
      <div className="cardhead"><h3 style={{ margin: 0 }}>Webhooks</h3><button className="primary" disabled={!data} onClick={() => setEdit("new")}><Plus />Add webhook</button></div>
      <p className="muted">We send a signed JSON message to your URL when something happens. Failed deliveries are retried twice, and every attempt is listed here.</p>
      {(error || err) && <div className="error">{error || err}</div>}
      {data?.hooks.map((h) => {
        const recent = log[h.id] ?? h.recent;
        return (
          <div key={h.id} className="kv" style={{ display: "block" }}>
            <div className="cardhead" style={{ marginBottom: 4 }}>
              <span><b style={{ wordBreak: "break-all" }}>{h.url}</b> {!h.active && <span className="badge">Paused</span>}</span>
              <span className="acts"><button onClick={() => test(h)}>Send test</button> <button onClick={() => setEdit(h)}>Edit</button> <button className="danger" onClick={() => remove(h)}>Delete</button></span>
            </div>
            <div>{h.events.map((e) => <span key={e} className="chip">{e}</span>)}</div>
            {recent.length > 0 && (
              <div className="muted" style={{ marginTop: 6 }}>
                {recent.slice(0, 5).map((d, i) => <div key={i}><span className={`badge ${d.status >= 200 && d.status < 300 ? "ok" : "bad"}`}>{d.status || "failed"}</span> {d.event} · {when(d.at)}{d.error ? ` · ${d.error}` : ""}</div>)}
              </div>
            )}
          </div>
        );
      })}
      {data && !data.hooks.length && <p className="muted">No webhooks yet.</p>}
      {edit && data && <HookForm hook={edit === "new" ? null : edit} events={data.events} onClose={() => setEdit(null)} onDone={(s) => { setEdit(null); reload(); if (s) setSecret(s); }} />}
      {secret && <Secret title="Webhook signing secret" secret={secret} onClose={() => setSecret("")} />}
    </div>
  );
}

export function Apps() {
  return (
    <>
      <div className="pagehead"><div><h2>Apps and API</h2><div className="muted">Connect other tools to your store. This replaces Shopify apps: link Zapier or Make, or write your own script.</div></div></div>
      <KeySection />
      <HookSection />
      <div className="card" style={{ maxWidth: 860 }}>
        <h3>Developer notes</h3>
        <p className="muted" style={{ marginTop: 0 }}>Call the admin API with your key. It can do what its role allows, and nothing else:</p>
        <pre className="codeblock" style={{ overflowX: "auto" }}>{`curl https://YOUR-STORE/api/admin/products \\\n  -H "Authorization: Bearer uvk_..."`}</pre>
        <p className="muted">Each webhook request carries <code>x-utsavvibe-event</code> and <code>x-utsavvibe-signature: t=&lt;ts&gt;,v1=&lt;hex&gt;</code>, where <code>v1</code> is the hex HMAC-SHA256 of <code>"&lt;ts&gt;.&lt;raw body&gt;"</code> using the webhook's signing secret. Reject requests whose signature doesn't match or whose timestamp is more than a few minutes old.</p>
        <pre className="codeblock" style={{ overflowX: "auto" }}>{`const [t, v1] = header.match(/t=(\\d+),v1=(\\w+)/).slice(1);\nconst ok = v1 === crypto.createHmac("sha256", secret)\n  .update(t + "." + rawBody).digest("hex");`}</pre>
      </div>
    </>
  );
}
