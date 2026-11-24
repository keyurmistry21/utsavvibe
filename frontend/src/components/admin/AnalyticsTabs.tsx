"use client";

import { useState } from "react";
import { Dashboard } from "./Dashboard";
import { Insights } from "./Insights";

export function AnalyticsTabs() {
  const [tab, setTab] = useState<"earnings" | "insights">("earnings");
  return (
    <div>
      <div className="ep-tabs" role="tablist" aria-label="Analytics">
        <button role="tab" aria-selected={tab === "earnings"} className={tab === "earnings" ? "on" : ""} onClick={() => setTab("earnings")}>Earnings</button>
        <button role="tab" aria-selected={tab === "insights"} className={tab === "insights" ? "on" : ""} onClick={() => setTab("insights")}>Sales insights and traffic</button>
      </div>
      {tab === "earnings" ? <Dashboard /> : <Insights />}
    </div>
  );
}
