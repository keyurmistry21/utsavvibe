import { NextResponse, type NextRequest } from "next/server";

const backend = process.env.BACKEND_URL ?? "http://localhost:4000";

// Every API call carries `Authorization: Bearer <jwt>`. The token stays in an httpOnly cookie that page scripts can't read
// (so an XSS bug can't steal it); this proxy copies it into the header on the server side before forwarding to the API.
// Only staff calls (/api/admin, /api/auth) have a session: the storefront has no sign-in.
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const cookie = path.startsWith("/api/admin") || path.startsWith("/api/auth") ? "uv_session" : null;
  const token = cookie ? req.cookies.get(cookie)?.value : null;
  if (!token || req.headers.has("authorization")) return NextResponse.next(); // no session, or the caller (e.g. an API key) brought its own
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  return NextResponse.rewrite(new URL(path + req.nextUrl.search, backend), { request: { headers } });
}

export const config = { matcher: "/api/:path*" };
