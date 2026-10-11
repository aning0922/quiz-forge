import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Project governance is maintained explicitly, not rewritten on dev startup.
  agentRules: false,
  // Local runtime state is provisioned separately; it must never become a deployment input.
  outputFileTracingExcludes: {
    "/*": [
      "./.cache/**/*",
      "./.env*",
      "./test-results/**/*",
      "./playwright-report/**/*",
    ],
  },
};

export default nextConfig;
