"use client";

import { useState } from "react";
import { accountCall } from "./account";

export function ResetPassword({ market, c, e, t }: { market: string; c: string; e: string; t: string }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  return (
    <>
      <h1>Choose a new password</h1>
      {done ? <p className="giftok">Password changed. <a href={`/${market}/account`}>Sign in</a></p> : (
        <form className="card" style={{ maxWidth: 440 }} onSubmit={async (ev) => { ev.preventDefault(); setErr(""); try { await accountCall("/reset", "POST", { c, e, t, password: pw }); setDone(true); } catch (x) { setErr((x as Error).message); } }}>
          <div className="field"><label htmlFor="rp">New password</label><input id="rp" type="password" value={pw} onChange={(x) => setPw(x.target.value)} autoComplete="new-password" minLength={10} maxLength={200} required /><p className="muted" style={{ fontSize: 13 }}>At least 10 characters.</p></div>
          {err && <div className="error">{err}</div>}
          <button className="primary">Change password</button>
        </form>
      )}
    </>
  );
}
