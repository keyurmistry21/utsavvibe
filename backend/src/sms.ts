// SMS through Twilio's REST API (no SDK). Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Twilio number) in backend/.env.
// Not tested against the live service from this repo: send one to yourself first.
export const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
const E164 = /^\+[1-9]\d{7,14}$/;
export const smsNumber = (raw: string | null | undefined) => { const n = (raw ?? "").replace(/[\s().-]/g, ""); return E164.test(n) ? n : null; };

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!smsConfigured()) return { ok: false, error: "SMS is not set up (add TWILIO_* to backend/.env)" };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body.slice(0, 1000) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? "error"}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
