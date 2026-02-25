"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TerminalView } from "@/components/TerminalView";
import { useSessionState } from "@/hooks/useSessionState";
import type { SessionState } from "@/lib/types";

export default function SessionPage({
  params,
}: {
  params: Promise<{ serverId: string; sessionId: string }>;
}) {
  const { serverId, sessionId } = use(params);
  const router = useRouter();
  const { servers } = useSessionState();
  const [resolved, setResolved] = useState<{
    sessionName: string;
    serverName: string;
    sessionState: SessionState;
  } | null>(null);

  useEffect(() => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;
    const session = server.sessions.find((s) => s.id === sessionId);
    setResolved({
      sessionName: session?.name || sessionId,
      serverName: server.name,
      sessionState: session?.state || "dead",
    });
  }, [servers, serverId, sessionId]);

  const handleBack = useCallback(() => {
    router.push("/");
  }, [router]);

  if (!resolved) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0d1117]">
        <span className="text-[13px] text-text-muted animate-pulse">Connecting...</span>
      </div>
    );
  }

  return (
    <TerminalView
      serverId={serverId}
      sessionId={sessionId}
      sessionName={resolved.sessionName}
      serverName={resolved.serverName}
      sessionState={resolved.sessionState}
      onBack={handleBack}
    />
  );
}
