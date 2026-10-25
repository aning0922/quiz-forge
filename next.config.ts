import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { join } from "node:path";

// The build is run from this checkout; only server code receives these literals.
// Runtime environment variables and request data cannot select a media root.
const checkoutRoot = realpathSync(process.cwd());

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Project governance is maintained explicitly, not rewritten on dev startup.
  agentRules: false,
  // Keep the qualified native password KDF in the Node server runtime.
  serverExternalPackages: ["argon2"],
  compiler: {
    defineServer: {
      __QUIZFORGE_MEDIA_CHECKOUT_ROOT__: checkoutRoot,
      __QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__: join(checkoutRoot, ".next"),
    },
  },
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
