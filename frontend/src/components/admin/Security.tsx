"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { auth, type AdminUser } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { api } from "@/lib/api";
import { CopyBox } from "./CopyBox";

type Entry = { id: string; at: string; userEmail: string; action: string; detail: string; ip: string };

function TwoFactor() {
  const [on, setOn] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { auth<AdminUser>("/me").then((u) => setOn(!!u.twoFactor)).catch(() => setOn(false)); }, []);
  useEffect(() => { if (setup) QRCode.toDataURL(setup.uri, { margin: 2, width: 200, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr("")); else setQr(""); }, [setup]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); setMsg(""); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const start = () => run(async () => { setSetup(await auth("/2fa/start", { method: "POST" })); setCode(""); });
  const enable = () => run(async () => { await auth("/2fa/enable", { method: "POST", json: { code: code.trim() } }); setOn(true); setSetup(null); setCode(""); setMsg("Two-factor sign-in is on. You'll need a code each time you sign in."); });
  const disable = () => run(async () => { await auth("/2fa/disable", { method: "POST", json: { password: pw, code: code.trim() } }); setOn(false); setDisabling(false); setPw(""); setCode(""); setMsg("Two-factor sign-in is off."); });

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="cardhead"><h3 style={{ margin: 0 }}>Two-factor sign-in</h3>{on !== null && <span className={`badge ${on ? "ok" : ""}`}>{on ? "On" : "Off"}</span>}</div>
      <p className="muted">After your password, you also type a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy). It stops someone who guesses or steals your password.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      {on === false && !setup && <button className="primary" disabled={busy} onClick={start}>Set up two-factor</button>}
      {setup && (
        <>
          <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Scan this code with your authenticator app, or type the key by hand.</li>
          </ol>
          {qr && <img src={qr} alt="QR code to add UtsavVibe to your authenticator app" width={200} height={200} />}
          <div className="field" style={{ maxWidth: 420 }}><label>Setup key</label><CopyBox value={setup.secret} label="Setup key" /></div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="tf-code">Enter the 6-digit code to confirm</label>
            <input id="tf-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="primary" disabled={busy || !code.trim()} onClick={enable}>Turn on</button> <button onClick={() => setSetup(null)}>Cancel</button>
        </>
      )}
      {on && !disabling && <button onClick={() => { setDisabling(true); setErr(""); setMsg(""); }}>Turn off two-factor</button>}
      {on && disabling && (
        <>
          <div className="row">
            <div className="field"><label htmlFor="tf-pw">Your password</label><input id="tf-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div className="field"><label htmlFor="tf-dcode">Current 6-digit code</label><input id="tf-dcode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></div>
          </div>
          <button className="danger" disabled={busy || !pw || !code.trim()} onClick={disable}>Turn off</button> <button onClick={() => { setDisabling(false); setPw(""); setCode(""); }}>Cancel</button>
        </>
      )}
    </div>
  );
}

function Log() {
  const { data, error, reload } = useApi<Entry[]>("/users/audit-log");
  return (
    <div className="card">
      <div className="cardhead"><h3 style={{ margin: 0 }}>Security log</h3><button onClick={reload}>Refresh</button></div>
      <p className="muted">Sign-ins, failed attempts, and changes to staff, roles, keys and webhooks. The latest 200 entries. Passwords and keys are never recorded.</p>
      {error && <div className="error">{error}</div>}
      <div className="tablescroll">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td>{e.userEmail || "—"}</td>
                <td><span className={`badge ${/failed/.test(e.action) ? "bad" : ""}`}>{e.action.replace(/_/g, " ")}</span></td>
                <td>{e.detail}</td>
                <td className="muted">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.length && <p className="muted">Nothing logged yet.</p>}
    </div>
  );
}

export function Security() {
  const { can } = useCan();
  return (
    <>
      <div className="pagehead"><div><h2>Security</h2><div className="muted">Protect your admin account and see who did what.</div></div></div>
      <TwoFactor />
      {can("users.manage") && <Log />}
    </>
  );
}
