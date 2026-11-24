"use client";

import { useState } from "react";
import { ProductArt } from "./ProductArt";
import { usePdpImage } from "./PdpImage";

export function Gallery({ images, title }: { images: { url: string; thumbUrl: string; alt: string }[]; title: string }) {
  const [i, setI] = useState(0);
  const { url, set } = usePdpImage();
  if (!images.length) return <ProductArt title={title} size="lg" />;
  // a picked variant's own image wins until a thumbnail is clicked
  const byVariant = url ? images.findIndex((x) => x.url === url) : -1;
  const cur = images[byVariant >= 0 ? byVariant : Math.min(i, images.length - 1)];
  return (
    <div className="gallery">
      <div className="main"><img src={cur.url} alt={cur.alt || title} width={1000} height={1000} fetchPriority="high" /></div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((img, n) => (
            <button key={img.url} className={img.url === cur.url ? "on" : ""} onClick={() => { setI(n); set(null); }} aria-label={`Show image ${n + 1}`}>
              <img src={img.thumbUrl} alt={img.alt || `${title}, image ${n + 1}`} width={72} height={72} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
