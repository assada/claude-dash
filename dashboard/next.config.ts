import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitVersion(): string {
  try {
    return execSync("git describe --tags --always", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_AGENT_VERSION: getGitVersion(),
  },
};

export default nextConfig;
