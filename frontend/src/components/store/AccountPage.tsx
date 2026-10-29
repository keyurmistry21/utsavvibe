"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "../Select";
import { accountCall, getMe, rememberMarket, type Me } from "./account";

type M = { code: string; name: string; currency: string };

export function AccountPage({ market, markets }: { market: string; markets: M[] }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getMe().then(setMe); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  // After signing in the shop opens in the market they chose last time. First time: this one becomes their default.
  const land = async (acct: Me) => {
    const target = (acct.preferredMarket ?? market).toLowerCase();
    if (!acct.preferredMarket) await accountCall("/me", "PUT", { preferredMarket: market.toUpperCase() }).catch(() => {});
    rememberMarket(target);
    window.location.href = `/${target}`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setNote(""); setBusy(true);
    try {
      if (mode === "forgot") {
        await accountCall("/forgot", "POST", { email: f.email, market });
        setNote("If there's an account for that email, we've sent a link to reset the password.");
      } else if (mode === "up") {
        await land(await accountCall<Me>("/register", "POST", { name: f.name, email: f.email, password: f.password, market: market.toUpperCase() }));
      } else {
        await land(await accountCall<Me>("/login", "POST", { email: f.email, password: f.password }));
      }
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  if (me === undefined) return <p className="muted">Loading…</p>;

  if (me) {
    const pref = (me.preferredMarket ?? market).toLowerCase();
    return (
      <>
        <h1>Your account</h1>
        <div className="card">
          <p>Signed in as <b>{me.email}</b></p>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="acct-mkt">Your shop (currency and prices)</label>
            <Select id="acct-mkt" value={pref} onChange={async (e) => {
              const code = e.target.value;
              await accountCall("/me", "PUT", { preferredMarket: code.toUpperCase() }).catch(() => {});
              rememberMarket(code);
              setMe({ ...me, preferredMarket: code.toUpperCase() });
              router.push(`/${code}/account`);
            }}>
              {markets.map((m) => <option key={m.code} value={m.code.toLowerCase()}>{m.name} ({m.currency})</option>)}
            </Select>
            <p className="muted" style={{ fontSize: 13 }}>We open this shop every time you sign in. Changing the region in the header updates it too.</p>
          </div>
          <button onClick={async () => { await accountCall("/logout", "POST"); setMe(null); }}>Sign out</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{mode === "up" ? "Create account" : mode === "forgot" ? "Reset password" : "Sign in"}</h1>
      <form className="card" onSubmit={submit} style={{ maxWidth: 440 }}>
        {mode === "up" && <div className="field"><label htmlFor="ac-name">Name</label><input id="ac-name" value={f.name} onChange={set("name")} autoComplete="name" required /></div>}
        <div className="field"><label htmlFor="ac-email">Email</label><input id="ac-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></div>
        {mode !== "forgot" && <div className="field"><label htmlFor="ac-pw">Password</label><input id="ac-pw" type="password" value={f.password} onChange={set("password")} autoComplete={mode === "up" ? "new-password" : "current-password"} minLength={mode === "up" ? 10 : 1} maxLength={200} required />{mode === "up" && <p className="muted" style={{ fontSize: 13 }}>At least 10 characters.</p>}</div>}
        {err && <div className="error">{err}</div>}
        {note && <p className="giftok">{note}</p>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
        <p className="muted" style={{ fontSize: 14, marginTop: 14 }}>
          {mode !== "in" && <button type="button" className="link" onClick={() => { setMode("in"); setErr(""); setNote(""); }}>Sign in</button>}
          {mode === "in" && <><button type="button" className="link" onClick={() => { setMode("up"); setErr(""); }}>Create account</button> · <button type="button" className="link" onClick={() => { setMode("forgot"); setErr(""); }}>Forgot password?</button></>}
          {mode === "up" && <> · <button type="button" className="link" onClick={() => setMode("forgot")}>Forgot password?</button></>}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>Your account remembers your shop ({market.toUpperCase()} unless you change it) so you always land on the right currency and products.</p>
      </form>
    </>
  );
}
