"use client";

import { useState } from "react";
import { ProductArt } from "./ProductArt";

export function Gallery({ images, title }: { images: { url: string; thumbUrl: string; alt: string }[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <ProductArt title={title} size="lg" />;
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div className="gallery">
      <div className="main"><img src={cur.url} alt={cur.alt || title} /></div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((img, n) => (
            <button key={img.url} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={`Show image ${n + 1}`}>
              <img src={img.thumbUrl} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
