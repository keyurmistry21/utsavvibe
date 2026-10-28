"use client";

import { useState } from "react";
import { auth, type AdminUser } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { PasswordCard } from "./Settings";

export function AccountSettings() {
  const { user } = useCan();
  const [name, setName] = useState(user?.name ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const val = useValidation({ name: required(name, "Enter your name") });
  const save = async () => {
    if (!val.submit()) return;
    try { await auth<AdminUser>("/profile", { method: "PUT", json: { name } }); setMsg({ ok: true, text: "Saved. Your new name shows after you reload." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <>
      <div className="pagehead"><h2>My account</h2></div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h3>Profile</h3>
        <div className="field"><label htmlFor="ac-name">Name</label><input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
        <div className="field"><label>Email</label><input value={user?.email ?? ""} disabled /></div>
        <div className="field"><label>Role</label><input value={user?.role ?? "No role"} disabled /></div>
        {msg && <div className={msg.ok ? "muted" : "error"}>{msg.text}</div>}
        <button className="primary" onClick={save}>Save</button>
      </div>
      <PasswordCard />
    </>
  );
}
