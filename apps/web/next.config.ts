import type { NextConfig } from "next";

import { parseEnvironment, webEnvironmentSchema } from "@tender/config";

parseEnvironment("web", webEnvironmentSchema, process.env);

function originFrom(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originFrom(process.env.NEXT_PUBLIC_API_URL);
const storageOrigin = originFrom(process.env.NEXT_PUBLIC_STORAGE_ORIGIN);
const isDevelopment = process.env.NODE_ENV === "development";
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(isDevelopment ? ["'unsafe-eval'"] : []),
];
const connectSources = [
  "'self'",
  ...(apiOrigin === null ? [] : [apiOrigin]),
  ...(storageOrigin === null || storageOrigin === apiOrigin
    ? []
    : [storageOrigin]),
];

export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSources.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([
      {
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
        source: "/:path*",
      },
    ]);
  },
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@tender/config", "@tender/ui"],
};

export default nextConfig;
