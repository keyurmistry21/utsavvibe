import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Local disk storage behind a tiny interface so it can be swapped for S3/R2 later.
// Served publicly at /uploads/<name> (see index.ts); filenames are random ids, so URLs are immutable.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

export async function saveFile(name: string, data: Buffer) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, path.basename(name)), data);
}

export async function removeFiles(names: string[]) {
  await Promise.all(names.map((n) => rm(path.join(UPLOAD_DIR, path.basename(n)), { force: true })));
}

export const imageUrls = (id: string) => ({ url: `/uploads/${id}.webp`, thumbUrl: `/uploads/${id}-thumb.webp` });
export const imageFiles = (id: string) => [`${id}.webp`, `${id}-thumb.webp`];
