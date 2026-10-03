import type { NextConfig } from "next";

// Some hosts give a bare "host:port" for private networking; default to http for those.
const rawBackendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
const backendUrl = /^https?:\/\//.test(rawBackendUrl) ? rawBackendUrl : `http://${rawBackendUrl}`;

const nextConfig: NextConfig = {
  output: "standalone",
  // The browser only talks to this origin; /api is proxied to FastAPI so auth cookies stay first-party.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          // Browsers ignore this over plain http, so it's harmless locally.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Private member pages: the token in the URL must not leak or be indexed.
        source: "/p/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
