"use client";

import { useState } from "react";

export type ReviewData = { count: number; average: number | null; reviews: { name: string; rating: number; title: string; body: string; verified: boolean; createdAt: string }[] };

const Stars = ({ n }: { n: number }) => <span className="stars" aria-label={`${n} out of 5`}>{"★★★★★".slice(0, n)}<i>{"★★★★★".slice(n)}</i></span>;

export function Reviews({ handle, data }: { handle: string; data: ReviewData | null }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", rating: 5, title: "", body: "" });
  const [state, setState] = useState<"" | "pending" | "approved">("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/store/reviews/${encodeURIComponent(handle)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error === "validation" ? "Please add your name, a rating and a few words (10+ characters)." : d.error ?? "Something went wrong");
      setState(d.status); setOpen(false);
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <section id="reviews" className="reviews">
      <h2>Reviews{data?.count ? ` (${data.count})` : ""}</h2>
      {data?.count ? <p className="ratingline"><Stars n={Math.round(data.average ?? 0)} /> {data.average} out of 5</p> : <p className="muted">No reviews yet. Be the first to share how it looks at home.</p>}
      <ul className="reviewlist">
        {data?.reviews.map((r, i) => (
          <li key={i}>
            <Stars n={r.rating} /> {r.title && <b>{r.title}</b>}
            <p>{r.body}</p>
            <span className="muted">{r.name}{r.verified ? " · Verified buyer" : ""} · {new Date(r.createdAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
      {state && <p className="giftok" role="status">{state === "approved" ? "Thank you! Your review is live." : "Thank you! Your review will appear after a quick check."}</p>}
      {!open && !state && <button className="reviewbtn" onClick={() => setOpen(true)}>Write a review</button>}
      {open && (
        <form onSubmit={submit} className="reviewform">
          <div className="field"><label htmlFor="rv-name">Your name</label><input id="rv-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} required /></div>
          <div className="field"><label htmlFor="rv-rating">Rating</label>
            <select id="rv-rating" value={f.rating} onChange={(e) => setF({ ...f, rating: +e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n} star{n === 1 ? "" : "s"}</option>)}</select></div>
          <div className="field"><label htmlFor="rv-title">Headline (optional)</label><input id="rv-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} /></div>
          <div className="field"><label htmlFor="rv-body">Your review</label><textarea id="rv-body" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={3000} required /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <button className="primary" disabled={busy}>{busy ? "Sending…" : "Submit review"}</button>
        </form>
      )}
    </section>
  );
}
