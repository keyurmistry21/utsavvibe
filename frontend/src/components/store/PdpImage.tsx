"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// The image chosen by picking a variant; the gallery shows it.
const Ctx = createContext<{ url: string | null; set: (u: string | null) => void }>({ url: null, set: () => {} });
export const usePdpImage = () => useContext(Ctx);
export function PdpImageProvider({ initial, children }: { initial?: string | null; children: ReactNode }) {
  const [url, set] = useState<string | null>(initial ?? null);
  return <Ctx.Provider value={{ url, set }}>{children}</Ctx.Provider>;
}
