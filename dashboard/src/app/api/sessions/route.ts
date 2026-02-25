import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { agentManager } from "@/lib/agent-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const servers = agentManager.getServersForUser(userId);
  return NextResponse.json({ servers });
}
