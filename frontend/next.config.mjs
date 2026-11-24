const backend = process.env.BACKEND_URL ?? "http://localhost:4000";
const dev = process.env.NODE_ENV !== "production";

// Next injects inline bootstrap scripts, so script-src needs 'unsafe-inline' (no nonce pipeline here). Everything else is locked down:
// no framing, no plugins, forms only to ourselves or Stripe Checkout, XHR only to our own origin (the /api proxy).
// Google Analytics 4 is allowed only when NEXT_PUBLIC_GA_ID is set.
const ga = !!process.env.NEXT_PUBLIC_GA_ID;
const px = !!process.env.NEXT_PUBLIC_META_PIXEL_ID; // Meta Pixel: allowed only when configured
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com${dev ? " 'unsafe-eval'" : ""}${ga ? " https://www.googletagmanager.com" : ""}${px ? " https://connect.facebook.net" : ""}`,
  `connect-src 'self' https://api.stripe.com https://*.stripe-terminal-local-reader.net https://js.stripe.com${dev ? " ws: wss:" : ""}${ga ? " https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com" : ""}${px ? " https://www.facebook.com https://connect.facebook.net" : ""}`,
  "font-src 'self' data:",
  "frame-src https://js.stripe.com", // Stripe Terminal (card reader) SDK
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

const security = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  poweredByHeader: false,
  experimental: {
    agentUpgrade: "security",
  },
  distDir: process.env.NEXT_DIST_DIR || ".next", // lets a second build/dev server run beside the main one
  // Browser calls /api/* (admin + checkout); proxy them to the Express API.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      // the admin and the API must never show up in search results
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};
