"use client";

import { useRef, useState } from "react";
import { api, type ProductImage } from "@/lib/api";
import { Plus } from "../Icons";

export type Pending = { key: string; file: File; preview: string };
const MAX = 10;
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Existing images are edited immediately (the product exists); new files wait until the product is saved.
export function ImageManager({ productId, images, onImages, pending, onPending }: {
  productId?: string;
  images: ProductImage[];
  onImages: (i: ProductImage[]) => void;
  pending: Pending[];
  onPending: (p: Pending[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);

  const add = (files: FileList | File[]) => {
    setErr("");
    const next: Pending[] = [];
    for (const f of Array.from(files)) {
      if (!TYPES.includes(f.type)) { setErr(`${f.name}: only JPEG, PNG, WebP or GIF images are allowed`); continue; }
      if (f.size > MAX_BYTES) { setErr(`${f.name} is larger than 12 MB`); continue; }
      if (images.length + pending.length + next.length >= MAX) { setErr(`Maximum ${MAX} images`); break; }
      next.push({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, preview: URL.createObjectURL(f) });
    }
    if (next.length) onPending([...pending, ...next]);
  };

  const guard = async (fn: () => Promise<void>) => { setErr(""); try { await fn(); } catch (e) { setErr((e as Error).message); } };

  const move = (i: number, dir: -1 | 1) => guard(async () => {
    const j = i + dir;
    if (j < 0 || j >= images.length || !productId) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    await api(`/products/${productId}/images/order`, { method: "PUT", json: { ids: next.map((x) => x.id) } });
    onImages(next.map((x, p) => ({ ...x, position: p })));
  });

  const remove = (img: ProductImage) => guard(async () => {
    if (!productId || !confirm("Delete this image?")) return;
    await api(`/products/${productId}/images/${img.id}`, { method: "DELETE" });
    onImages(images.filter((x) => x.id !== img.id).map((x, p) => ({ ...x, position: p })));
  });

  const saveAlt = (img: ProductImage, alt: string) => guard(async () => {
    if (!productId || alt === img.alt) return;
    await api(`/products/${productId}/images/${img.id}`, { method: "PATCH", json: { alt } });
    onImages(images.map((x) => (x.id === img.id ? { ...x, alt } : x)));
  });

  return (
    <div className="card">
      <h3>Images</h3>
      <div className="imgs">
        {images.map((img, i) => (
          <div key={img.id} className="imgtile">
            <div className="thumb">
              <img src={img.thumbUrl} alt={img.alt} />
              {i === 0 && <span className="cover">Cover</span>}
            </div>
            <input placeholder="Alt text" defaultValue={img.alt} onBlur={(e) => saveAlt(img, e.target.value)} />
            <div className="tools">
              <button title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
              <button title="Move later" disabled={i === images.length - 1} onClick={() => move(i, 1)}>→</button>
              <button title="Delete" onClick={() => remove(img)}>✕</button>
            </div>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.key} className="imgtile pending">
            <div className="thumb"><img src={p.preview} alt="" /><span className="cover">{images.length === 0 && pending[0] === p ? "Cover · " : ""}Not saved yet</span></div>
            <div className="tools"><button title="Remove" onClick={() => onPending(pending.filter((x) => x.key !== p.key))}>✕</button></div>
          </div>
        ))}
        {images.length + pending.length < MAX && (
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          >
            <b><Plus />Add images</b>
            <span>or drop files here</span>
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      {err && <div className="error">{err}</div>}
      <p className="muted">JPEG, PNG, WebP or GIF up to 12 MB, max {MAX}. Images are resized and converted to WebP. The first image is the cover.{!productId && " They upload when you save the product."}</p>
    </div>
  );
}
