"use client";

import { useAdminMarket } from "@/lib/adminMarket";
import { Select } from "../Select";

// "Working in": the market (currency) this staff member works in, saved on their account.
// Staff an admin limited to one market see it locked; with several they can switch between those only.
export function MarketPicker() {
  const { market, markets, allowed, setMarket } = useAdminMarket();
  if (allowed && markets.length <= 1) {
    const m = markets[0];
    return m ? (
      <div className="mktpick" title="An admin decides which market you work in">
        <label>Working in</label>
        <div className="readonly locked"><span>{m.name} ({m.currency})</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg></div>
      </div>
    ) : null;
  }
  if (markets.length < 2) return null;
  return (
    <div className="mktpick">
      <label htmlFor="adm-market">Working in</label>
      <Select id="adm-market" value={market ?? ""} onChange={(e) => setMarket(e.target.value || null)}>
        {!allowed && <option value="">All markets</option>}
        {markets.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.currency})</option>)}
      </Select>
    </div>
  );
}
