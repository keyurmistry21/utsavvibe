import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <h1>Page not found</h1>
      <p style={{ color: "#666" }}>That page doesn't exist or is no longer available.</p>
      <Link href="/uk">Back to the shop</Link>
    </div>
  );
}
