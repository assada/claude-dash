import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { agentManager } from "@/lib/agent-manager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { serverId } = await req.json();
  if (!serverId) {
    return NextResponse.json({ error: "serverId required" }, { status: 400 });
  }

  agentManager.updateAgent(userId, serverId);
  return NextResponse.json({ ok: true });
}
