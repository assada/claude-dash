import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { agentManager } from "@/lib/agent-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  agentManager.init();
  const servers = agentManager.getServers();
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, name, host, port, token } = body;

  if (!id || !name || !host) {
    return NextResponse.json(
      { error: "id, name, and host are required" },
      { status: 400 }
    );
  }

  const config = loadConfig();
  const existing = config.servers.findIndex((s) => s.id === id);

  const server = {
    id,
    name,
    host,
    port: port || 9100,
    token: token || "",
  };

  if (existing >= 0) {
    config.servers[existing] = server;
  } else {
    config.servers.push(server);
  }

  saveConfig(config);
  agentManager.refreshConnections();

  return NextResponse.json({ ok: true, server });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const config = loadConfig();
  config.servers = config.servers.filter((s) => s.id !== id);
  saveConfig(config);
  agentManager.refreshConnections();

  return NextResponse.json({ ok: true });
}
