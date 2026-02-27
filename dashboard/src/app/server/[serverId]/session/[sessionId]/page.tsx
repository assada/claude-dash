"use client";

import { use, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TerminalView } from "@/components/TerminalView";
import { useSessionStateContext } from "@/hooks/useSessionState";

export default function SessionPage({
  params,
}: {
  params: Promise<{ serverId: string; sessionId: string }>;
}) {
  const { serverId, sessionId } = use(params);
  const router = useRouter();
  const { servers } = useSessionStateContext();

  // Allow pinch-to-zoom on terminal page (override layout viewport)
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta?.getAttribute("content") || "";
    meta?.setAttribute("content", "width=device-width, initial-scale=1");
    return () => {
      if (meta && original) meta.setAttribute("content", original);
    };
  }, []);

  const resolved = useMemo(() => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return null;
    const session = server.sessions.find((s) => s.id === sessionId);
    return {
      sessionName: session?.name || sessionId,
      serverName: server.name,
      sessionState: session?.state || ("dead" as const),
    };
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
