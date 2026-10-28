import Link from "next/link";

export function NoAccess() {
  return (
    <div className="card" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
      <h2>You don't have access to this page</h2>
      <p className="muted">Your role doesn't include it. Ask a store owner to change your role in Settings → Users.</p>
      <Link className="btn-link" href="/admin">Back to home</Link>
    </div>
  );
}
