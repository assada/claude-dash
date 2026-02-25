import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { agentManager } from "@/lib/agent-manager";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbServers = await prisma.server.findMany({ where: { userId } });

  // Merge live status from agent manager
  const liveServers = agentManager.getServersForUser(userId);
  const servers = dbServers.map((s) => {
    const live = liveServers.find((l) => l.id === s.serverId);
    return {
      id: s.serverId,
      name: s.name,
      host: s.host,
      port: s.port,
      online: live?.online || false,
      hostname: live?.hostname,
      os: live?.os,
      dirs: live?.dirs,
      sessions: live?.sessions || [],
    };
  });

  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, name, host, port, token } = body;

  if (!id || !name || !host) {
    return NextResponse.json(
      { error: "id, name, and host are required" },
      { status: 400 }
    );
  }

  const server = await prisma.server.upsert({
    where: { userId_serverId: { userId, serverId: id } },
    create: {
      userId,
      serverId: id,
      name,
      host,
      port: port || 9100,
      token: token || "",
    },
    update: {
      name,
      host,
      port: port || 9100,
      ...(token ? { token } : {}),
    },
  });

  // Refresh agent connections for this user
  const allServers = await prisma.server.findMany({ where: { userId } });
  agentManager.ensureUserConnections(
    userId,
    allServers.map((s) => ({
      id: s.serverId,
      name: s.name,
      host: s.host,
      port: s.port,
      token: s.token,
    }))
  );

  return NextResponse.json({
    ok: true,
    server: { id: server.serverId, name: server.name, host: server.host, port: server.port },
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.server.delete({
    where: { userId_serverId: { userId, serverId: id } },
  });

  // Refresh agent connections for this user
  const allServers = await prisma.server.findMany({ where: { userId } });
  agentManager.ensureUserConnections(
    userId,
    allServers.map((s) => ({
      id: s.serverId,
      name: s.name,
      host: s.host,
      port: s.port,
      token: s.token,
    }))
  );

  return NextResponse.json({ ok: true });
}
