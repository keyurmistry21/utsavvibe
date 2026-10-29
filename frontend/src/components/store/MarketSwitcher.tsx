"use client";

import Link from "next/link";

// Picking a market is a deliberate choice: remember it on this device so "/" opens it next time.
const remember = (code: string) => { try { document.cookie = `uv_market=${code.toLowerCase()}; path=/; max-age=31536000; samesite=lax`; } catch {} };

export function MarketSwitcher({ current, markets }: { current: { code: string; currency: string }; markets: { id: string; code: string; name: string; currency: string; on: boolean }[] }) {
  return (
    <details className="mkt">
      <summary>{current.code} · {current.currency}</summary>
      <ul>
        {markets.map((m) => (
          <li key={m.code}><Link href={`/${m.code.toLowerCase()}`} className={m.on ? "on" : ""} onClick={() => remember(m.code)}>{m.name} ({m.currency})</Link></li>
        ))}
      </ul>
    </details>
  );
}
