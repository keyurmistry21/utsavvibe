import sharp from "sharp";

const ALLOWED = new Set(["jpeg", "png", "webp", "gif"]);

// Validate by decoding (not by trusting Content-Type or extension), strip metadata, normalise to WebP.
// SVG and anything else is rejected: it would be an XSS/SSRF surface for no benefit here.
export async function processImage(input: Buffer) {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw Object.assign(new Error("not a valid image"), { status: 400 });
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw Object.assign(new Error("only JPEG, PNG, WebP or GIF images are allowed"), { status: 400 });

  const base = sharp(input, { limitInputPixels: 50_000_000 }).rotate(); // apply EXIF orientation, then metadata is dropped on output
  const full = await base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: "cover" }).webp({ quality: 78 }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}
