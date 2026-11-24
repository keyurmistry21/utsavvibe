"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type StockMarket } from "@/lib/api";
import { useAdminMarket } from "@/lib/adminMarket";
import { ArrowLeft } from "../Icons";
import { Select } from "../Select";

type Result = { product: string; variant: string; sku: string | null; location: string; quantity: number; total: number };
type Entry = { id: number; ok: boolean; text: string };

/**
 * Scan stock in or out. A USB/Bluetooth scanner types the code and presses Enter; a phone can use its camera.
 * The market starts as the one you work in (USA -> US stock), and every scan adds or removes there.
 */
export function StockScan() {
  const { market } = useAdminMarket();
  const [locs, setLocs] = useState<StockMarket[]>([]);
  const [loc, setLoc] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [qty, setQty] = useState("1");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef({ code: "", at: 0 });

  useEffect(() => { api<StockMarket[]>("/products/stock/markets").then(setLocs).catch(() => {}); }, []);
  // start at the market you work in
  const suggested = useMemo(() => (locs.find((l) => l.code === market) ?? locs[0])?.id ?? "", [locs, market]);
  useEffect(() => { if (!loc && suggested) setLoc(suggested); }, [suggested, loc]);

  const n = Math.max(1, parseInt(qty) || 1);
  const submit = async (raw: string) => {
    const c = raw.trim();
    if (!c || busy || !loc) return;
    setBusy(true);
    try {
      const r = await api<Result>("/products/stock/scan", { method: "POST", json: { code: c, marketId: loc, delta: mode === "add" ? n : -n } });
      const name = `${r.product}${r.variant !== "Default" ? ` (${r.variant})` : ""}`;
      setLog((l) => [{ id: Date.now(), ok: true, text: `${mode === "add" ? "Added" : "Removed"} ${n} · ${name} · ${r.location} now ${r.quantity} (all locations ${r.total})` }, ...l].slice(0, 30));
    } catch (e) {
      setLog((l) => [{ id: Date.now(), ok: false, text: (e as Error).message }, ...l].slice(0, 30));
    }
    setCode(""); setBusy(false); input.current?.focus();
  };

  // camera: BarcodeDetector (Chrome/Edge/Android/Safari 17+). Same code twice within 3 s counts once.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!camera) return;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setCamErr("This browser can't read codes with the camera. Use a scanner, or type the code."); setCamera(false); return; }
    let stop = false, stream: MediaStream | null = null;
    const det = new BD({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "code_128"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
      const tick = async () => {
        if (stop) return;
        try {
          const found = video.current ? await det.detect(video.current) : [];
          const v = found[0]?.rawValue;
          if (v && !(v === last.current.code && Date.now() - last.current.at < 3000)) { last.current = { code: v, at: Date.now() }; await submitRef.current(v); }
        } catch { /* frame not ready */ }
        setTimeout(tick, 300);
      };
      void tick();
    }).catch(() => { setCamErr("Camera access was blocked."); setCamera(false); });
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera]);

  return (
    <>
      <div className="pagehead"><h2>Scan stock</h2><div className="headtools"><Link className="btn-link" href="/admin/products"><ArrowLeft /> Products</Link></div></div>
      <div className="card" style={{ maxWidth: 640 }}>
        {!locs.length ? <p className="muted">No active markets yet.</p> : (
          <>
            <div className="row">
              <div className="field"><label>Market</label>
                <Select value={loc} onChange={(e) => setLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</Select></div>
              <div className="field"><label>Quantity per scan</label><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            </div>
            <div className="seg" role="group" aria-label="Add or remove" style={{ marginBottom: 12 }}>
              <button type="button" className={mode === "add" ? "primary" : ""} onClick={() => setMode("add")}>Add to stock</button>{" "}
              <button type="button" className={mode === "remove" ? "primary" : ""} onClick={() => setMode("remove")}>Remove from stock</button>
            </div>
            <div className="field"><label htmlFor="scan-code">Scan or type a SKU / barcode</label>
              <input id="scan-code" ref={input} autoFocus autoComplete="off" value={code} placeholder="Point the scanner here and scan" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(code); } }} /></div>
            <button type="button" onClick={() => { setCamErr(""); setCamera((c) => !c); }}>{camera ? "Stop camera" : "Scan with camera"}</button>
            {camErr && <p className="muted" role="alert" style={{ color: "#b42318" }}>{camErr}</p>}
            {camera && <video ref={video} muted playsInline style={{ width: "100%", maxHeight: 320, marginTop: 12, borderRadius: 10, background: "#000" }} />}
          </>
        )}
      </div>
      {log.length > 0 && (
        <div className="card" style={{ maxWidth: 640 }} aria-live="polite">
          <h3>Recent scans</h3>
          {log.map((e) => <div key={e.id} style={{ padding: "6px 0", color: e.ok ? undefined : "#b42318" }}>{e.ok ? "✓" : "✕"} {e.text}</div>)}
        </div>
      )}
    </>
  );
}
