"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { ean13Svg } from "@/lib/codes";
import { Modal } from "./Modal";

const download = (name: string, href: string) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); };

// Shows the barcode (EAN-13 / UPC-A) and a QR code for a variant so staff can check them, save them or print labels.
export function CodePreview({ title, sku, barcode, onClose }: { title: string; sku: string; barcode: string; onClose: () => void }) {
  const bar = barcode.trim() ? ean13Svg(barcode) : null;
  const qrText = sku.trim() || barcode.trim();
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!qrText) return setQr("");
    QRCode.toDataURL(qrText, { margin: 2, width: 360, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(""));
  }, [qrText]);

  const print = () => {
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    w.document.write(`<!doctype html><title>${esc(title)}</title><body style="font:14px sans-serif;text-align:center;margin:24px"><div style="font-weight:600;margin-bottom:8px">${esc(title)}</div>${sku ? `<div>${esc(sku)}</div>` : ""}${bar ?? ""}${qr ? `<div><img src="${qr}" width="180" height="180"></div>` : ""}<script>onload=()=>{print();close()}<\/script>`);
    w.document.close();
  };

  return (
    <Modal title="Barcode and QR code" onClose={onClose} footer={<><button onClick={print} disabled={!bar && !qr}>Print label</button><button className="primary" onClick={onClose}>Done</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{title}</p>
      <div className="codegrid">
        <div>
          <h4>Barcode</h4>
          {bar ? (
            <>
              <div className="codebox" dangerouslySetInnerHTML={{ __html: bar }} />
              <button className="link" onClick={() => download(`barcode-${barcode.trim()}.svg`, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bar)}`)}>Download SVG</button>
            </>
          ) : <p className="muted">{barcode.trim() ? "Only 12-digit (UPC-A) and 13-digit (EAN-13) barcodes can be drawn here. The QR code still works." : "No barcode yet. Use Generate to make one."}</p>}
        </div>
        <div>
          <h4>QR code{sku.trim() ? " (SKU)" : barcode.trim() ? " (barcode)" : ""}</h4>
          {qr ? (
            <>
              <div className="codebox"><img src={qr} alt={`QR code for ${qrText}`} width={180} height={180} /></div>
              <button className="link" onClick={() => download(`qr-${qrText}.png`, qr)}>Download PNG</button>
            </>
          ) : <p className="muted">Add a SKU or barcode to get a QR code.</p>}
        </div>
      </div>
    </Modal>
  );
}
