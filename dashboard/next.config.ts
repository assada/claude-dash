import type { NextConfig } from "next";
import { execSync } from "child_process";

function getAgentVersion(): string {
  // Docker: passed as build arg → env var
  if (process.env.NEXT_PUBLIC_AGENT_VERSION && process.env.NEXT_PUBLIC_AGENT_VERSION !== "dev") {
    return process.env.NEXT_PUBLIC_AGENT_VERSION;
  }
  // Local: read from git tags
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_AGENT_VERSION: getAgentVersion(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent clickjacking — no reason to embed dashboard in iframes
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME type sniffing attacks
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Control referrer leakage — send origin only cross-origin
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable DNS prefetching for external links
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // Disable APIs we don't use
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
