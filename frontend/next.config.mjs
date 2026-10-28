const backend = process.env.BACKEND_URL ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  // Browser calls /api/* (admin + checkout); proxy them to the Express API.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
    ];
  },
};
