"use client";

import Link from "next/link";
import { accountCall, getMe, rememberMarket } from "./account";

// Picking a market is a deliberate choice: remember it on this device and, for signed-in shoppers, on their account.
export function MarketSwitcher({ current, markets }: { current: { code: string; currency: string }; markets: { id: string; code: string; name: string; currency: string; on: boolean }[] }) {
  const choose = async (code: string) => {
    rememberMarket(code);
    if (await getMe()) await accountCall("/me", "PUT", { preferredMarket: code.toUpperCase() }).catch(() => {});
  };
  return (
    <details className="mkt">
      <summary>{current.code} · {current.currency}</summary>
      <ul>
        {markets.map((m) => (
          <li key={m.code}><Link href={`/${m.code.toLowerCase()}`} className={m.on ? "on" : ""} onClick={() => void choose(m.code)}>{m.name} ({m.currency})</Link></li>
        ))}
      </ul>
    </details>
  );
}
