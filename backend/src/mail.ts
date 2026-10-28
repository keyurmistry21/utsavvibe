import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./db.js";

let transporter: Transporter | null = null;

export const mailConfigured = () => !!process.env.SMTP_HOST;
export const storeName = () => process.env.STORE_NAME || "UtsavVibe";

function transport(): Transporter {
  return (transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  }));
}

export type MailKind = "order_confirmation" | "payment_link" | "test";
export type SendResult = { status: "sent" | "failed" | "skipped"; error?: string };

// Never throws: callers (webhooks, admin actions) must not fail because an email did.
// Every attempt is logged so staff can see what was sent, and so confirmations go out only once.
export async function sendMail(m: { to: string; subject: string; html: string; text: string; kind: MailKind; orderId?: string }): Promise<SendResult> {
  const subject = m.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200); // no header injection through names
  const log = (status: SendResult["status"], error?: string) =>
    prisma.emailLog.create({ data: { orderId: m.orderId ?? null, kind: m.kind, toEmail: m.to, subject, status, error: error?.slice(0, 1000) ?? null } }).catch(() => {});

  if (!mailConfigured()) {
    await log("skipped", "SMTP not configured");
    return { status: "skipped", error: "Email is not configured (set SMTP_HOST in backend/.env)" };
  }
  try {
    await transport().sendMail({
      from: process.env.MAIL_FROM || `${storeName()} <no-reply@localhost>`,
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      to: m.to,
      subject,
      html: m.html,
      text: m.text,
    });
    await log("sent");
    return { status: "sent" };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("mail failed:", msg);
    await log("failed", msg);
    return { status: "failed", error: msg };
  }
}
