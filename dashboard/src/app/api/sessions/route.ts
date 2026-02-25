import { NextResponse } from "next/server";
import { agentManager } from "@/lib/agent-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  agentManager.init();
  const servers = agentManager.getServers();
  return NextResponse.json({ servers });
}
