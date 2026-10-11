import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Project governance is maintained explicitly, not rewritten on dev startup.
  agentRules: false,
};

export default nextConfig;
