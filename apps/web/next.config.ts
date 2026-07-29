import type { NextConfig } from "next";

import { parseEnvironment, webEnvironmentSchema } from "@tender/config";

parseEnvironment("web", webEnvironmentSchema, process.env);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@tender/config", "@tender/ui"],
};

export default nextConfig;
