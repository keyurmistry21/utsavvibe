"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";

type R = { id: string; product: string; name: string; rating: number; title: string; body: string; verified: boolean; status: string; createdAt: string };

// Moderate customer reviews: pending ones wait here until approved. Verified buyers are approved automatically.
export function Reviews() {
  const { can } = useCan();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const { data, error, reload } = useApi<{ counts: { pending: number }; reviews: R[] }>(`/reviews?status=${status}`);
  const [err, setErr] = useState("");
  const set = async (id: string, s: string) => { setErr(""); try { await api(`/reviews/${id}`, { method: "PUT", json: { status: s } }); reload(); } catch (e) { setErr((e as Error).message); } };
  const del = async (id: string) => { if (!confirm("Delete this review for good?")) return; try { await api(`/reviews/${id}`, { method: "DELETE" }); reload(); } catch (e) { setErr((e as Error).message); } };
  const manage = can("products.manage");

  return (
    <>
      <div className="pagehead"><div><h2>Reviews</h2><div className="muted">Approve what shows on product pages. Reviews from verified buyers go live automatically.</div></div></div>
      <div className="tabs">{(["pending", "approved", "rejected"] as const).map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}{s === "pending" && data?.counts.pending ? ` (${data.counts.pending})` : ""}</button>)}</div>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Product</th><th>Review</th><th>By</th><th /></tr></thead>
          <tbody>
            {data?.reviews.map((r) => (
              <tr key={r.id}>
                <td>{r.product}</td>
                <td><span style={{ color: "#e0a100" }}>{"★".repeat(r.rating)}</span><span style={{ color: "#ccc" }}>{"★".repeat(5 - r.rating)}</span> {r.title && <b>{r.title}</b>}<div>{r.body}</div></td>
                <td>{r.name}{r.verified && <div><span className="badge good">Verified buyer</span></div>}<div className="muted">{new Date(r.createdAt).toLocaleDateString()}</div></td>
                <td className="r">{manage && <>
                  {r.status !== "approved" && <button className="link" onClick={() => set(r.id, "approved")}>Approve</button>}{" "}
                  {r.status !== "rejected" && <button className="link" onClick={() => set(r.id, "rejected")}>Reject</button>}{" "}
                  <button className="link" onClick={() => del(r.id)}>Delete</button></>}</td>
              </tr>
            ))}
            {data && !data.reviews.length && <tr><td colSpan={4}>Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
