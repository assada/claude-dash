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
};

export default nextConfig;
