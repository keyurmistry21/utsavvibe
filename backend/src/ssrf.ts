import dns from "node:dns/promises";
import net from "node:net";

export const privateIp = (ip: string) => {
  if (net.isIPv6(ip)) return /^(::1?|f[cd]|fe[89ab]|::ffff:(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127);
};

/**
 * Outbound URLs chosen by staff (webhooks) must be https and resolve to the public internet, so they can't be pointed at
 * internal services. `WEBHOOK_ALLOW_LOCAL=true` (development only) also allows http and loopback for testing.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  const local = process.env.WEBHOOK_ALLOW_LOCAL === "true" && process.env.NODE_ENV !== "production";
  if (!local && u.protocol !== "https:") throw new Error("The URL must start with https://");
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Unsupported URL");
  if (u.username || u.password) throw new Error("Don't put credentials in the URL");
  if (!local) {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("That address points to a private network");
  }
  return u;
}
