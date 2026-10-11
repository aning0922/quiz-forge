import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the containing Python repository outside this standalone app's build root.
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
