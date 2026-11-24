import { Router, raw } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { actor } from "../auth.js";
import { saveFile, removeFiles } from "../storage.js";
import { processImage } from "../images.js";

// Admin: file library. Upload an image or PDF once, copy its address, paste it into a page, blog post or email.
export const filesRouter = Router();

// Only types that cannot run code in the browser. No HTML, SVG or scripts.
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", mp4: "video/mp4" };
const MAX = 20 * 1024 * 1024;
const bad = (m: string, status = 400) => Object.assign(new Error(m), { status });
const fileName = (id: string, ext: string) => `f-${id}.${ext}`;

filesRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await prisma.fileAsset.findMany({ where: q ? { name: { contains: q } } : {}, orderBy: { createdAt: "desc" }, take: 300 });
  res.json(rows.map((f) => ({ ...f, url: `/uploads/${fileName(f.id, f.ext)}`, isImage: f.mime.startsWith("image/") })));
});

// Raw body: the file itself; its name in x-file-name (URL-encoded).
filesRouter.post("/", raw({ type: () => true, limit: MAX }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad("empty upload");
  const original = decodeURIComponent(req.header("x-file-name") ?? "file").replace(/[\\/]/g, "_").slice(0, 190) || "file";
  const ext = (original.split(".").pop() ?? "").toLowerCase();
  const mime = TYPES[ext];
  if (!mime) throw bad("That file type is not allowed. Use JPG, PNG, WebP, GIF, PDF, TXT, CSV, JSON or MP4");
  const buf = req.body as Buffer;
  // check the content, not just the name
  if (mime.startsWith("image/")) await processImage(buf); // throws for anything that is not a real image
  else if (ext === "pdf" && buf.subarray(0, 5).toString() !== "%PDF-") throw bad("That is not a PDF file");
  else if (ext === "json") { try { JSON.parse(buf.toString("utf8")); } catch { throw bad("That is not valid JSON"); } }
  else if (ext === "mp4" && buf.subarray(4, 8).toString() !== "ftyp") throw bad("That is not an MP4 video");
  const row = await prisma.fileAsset.create({ data: { name: original, ext, mime, size: buf.length, createdBy: actor(req)?.email ?? "" } });
  try { await saveFile(fileName(row.id, ext), buf); } catch (e) { await prisma.fileAsset.delete({ where: { id: row.id } }); throw e; }
  await audit(req, "file_uploaded", original);
  res.status(201).json({ ...row, url: `/uploads/${fileName(row.id, ext)}`, isImage: mime.startsWith("image/") });
});

filesRouter.patch("/:id", async (req, res) => {
  const d = z.object({ name: z.string().trim().min(1).max(190).optional(), alt: z.string().trim().max(200).optional() }).parse(req.body);
  res.json(await prisma.fileAsset.update({ where: { id: req.params.id }, data: d }));
});

filesRouter.delete("/:id", async (req, res) => {
  const f = await prisma.fileAsset.findUnique({ where: { id: req.params.id } });
  if (!f) throw bad("not found", 404);
  await prisma.fileAsset.delete({ where: { id: f.id } });
  await removeFiles([fileName(f.id, f.ext)]);
  await audit(req, "file_deleted", f.name);
  res.json({ deleted: true });
});
