"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import {
  GripVertical,
  ChevronUp,
  Plus,
  Wifi,
  WifiOff,
  Loader2,
  CircleCheck,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import type { ServerStatus, SessionInfo, SessionState } from "@/lib/types";
import type { PanelPosition } from "@/hooks/usePanelPositions";
import type { PanelRect } from "./DotGridCanvas";

const PANEL_WIDTH = 320;
const FRICTION = 0.975;
const FRICTION_FAST = 0.94;
const BOUNCE_DAMPING = 0.45;
const MAX_VELOCITY = 40;
const MIN_VELOCITY = 0.5;
const VELOCITY_WINDOW_MS = 80;
const EDGE_MARGIN = 8;

function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function shortName(name: string): string {
  const match = name.match(/^cc-\d+-(.+)$/);
  return match ? match[1] : name;
}

function stateIcon(state: SessionState) {
  switch (state) {
    case "working":
      return <Loader2 size={14} className="text-yellow-500 animate-spin" />;
    case "needs_attention":
      return <AlertCircle size={14} className="text-warn" />;
    case "idle":
      return <CircleCheck size={14} className="text-ok" />;
    case "dead":
      return <div className="w-3.5 h-3.5 rounded-full bg-neutral-700" />;
    default:
      return <StatusIndicator state={state} size={10} />;
  }
}

function stateLabel(state: SessionState): string {
  switch (state) {
    case "idle": return "Idle";
    case "working": return "Working";
    case "needs_attention": return "Needs You";
    case "starting": return "Starting";
    case "dead": return "Exited";
    default: return state;
  }
}

function SessionRow({
  session,
  onOpen,
  onKill,
}: {
  session: SessionInfo;
  onOpen: () => void;
  onKill: () => void;
}) {
  const isAttention = session.state === "needs_attention";
  const isDead = session.state === "dead";
  const isWorking = session.state === "working";

  return (
    <div
      onClick={onOpen}
      className={`group flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors rounded-[5px] ${
        isAttention
          ? "bg-red-950/30 hover:bg-red-950/50"
          : "hover:bg-[rgba(64,64,64,0.3)]"
      } ${isDead ? "opacity-40" : ""}`}
    >
      <div className="shrink-0 w-5 flex items-center justify-center">
        {stateIcon(session.state)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-[13px] font-medium truncate ${
              isAttention ? "text-warn" : "text-text-primary"
            } ${isWorking ? "animate-shimmer" : ""}`}
          >
            {shortName(session.name)}
          </span>
          <span className="text-[11px] text-text-muted shrink-0">
            {stateLabel(session.state)}
          </span>
        </div>
        {session.last_line && (
          <div
            className="text-[11px] text-text-faint truncate mt-0.5"
            style={{
              fontFamily: "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace",
            }}
          >
            {session.last_line}
          </div>
        )}
      </div>
      <span className="text-[11px] text-text-faint shrink-0">
        {timeSince(session.state_changed_at)}
      </span>
      {!isDead && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Kill this session?")) onKill();
          }}
          className="opacity-0 group-hover:opacity-100 btn-danger p-1 shrink-0"
          title="Kill"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

export function ServerPanel({
  server,
  position,
  onPositionChange,
  onOpenTerminal,
  onKillSession,
  onNewSession,
  onBringToFront,
  reportRect,
  zIndex,
}: {
  server: ServerStatus;
  position: PanelPosition;
  onPositionChange: (pos: PanelPosition) => void;
  onOpenTerminal: (sessionId: string) => void;
  onKillSession: (sessionId: string) => void;
  onNewSession: () => void;
  onBringToFront: () => void;
  reportRect: (rect: PanelRect) => void;
  zIndex: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // Motion values for smooth positioning
  const mx = useMotionValue(position.x);
  const my = useMotionValue(position.y);

  // Physics refs
  const dragOffset = useRef({ x: 0, y: 0 });
  const posRef = useRef({ x: position.x, y: position.y });
  const velocityRef = useRef({ x: 0, y: 0 });
  const samplesRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const rafRef = useRef(0);
  const physicsRunning = useRef(false);

  const attentionCount = server.sessions.filter(
    (s) => s.state === "needs_attention"
  ).length;
  const activeCount = server.sessions.filter(
    (s) => s.state !== "dead"
  ).length;

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [server.sessions.length]);

  // Report rect to dot grid whenever position changes
  const updateRect = useCallback(() => {
    const h = panelRef.current?.offsetHeight || 200;
    reportRect({
      x: posRef.current.x,
      y: posRef.current.y,
      w: PANEL_WIDTH,
      h,
    });
  }, [reportRect]);

  // Sync motion values when position prop changes (from Arrange)
  useEffect(() => {
    if (!dragging && !physicsRunning.current) {
      animate(mx, position.x, { type: "spring", stiffness: 400, damping: 28 });
      animate(my, position.y, { type: "spring", stiffness: 400, damping: 28 });
      posRef.current = { x: position.x, y: position.y };
      updateRect();
    }
  }, [position.x, position.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set position directly (during drag / physics)
  const setPos = useCallback(
    (x: number, y: number) => {
      posRef.current = { x, y };
      mx.set(x);
      my.set(y);
      updateRect();
    },
    [mx, my, updateRect]
  );

  // --- Physics: momentum + edge bouncing ---
  const startPhysics = useCallback(() => {
    // Calculate velocity from recent samples
    const samples = samplesRef.current;
    const cutoff = Date.now() - VELOCITY_WINDOW_MS;
    const recent = samples.filter((s) => s.t > cutoff);

    if (recent.length >= 2) {
      const first = recent[0];
      const last = recent[recent.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0) {
        velocityRef.current = {
          x: Math.max(
            -MAX_VELOCITY,
            Math.min(MAX_VELOCITY, (last.x - first.x) / dt / 60)
          ),
          y: Math.max(
            -MAX_VELOCITY,
            Math.min(MAX_VELOCITY, (last.y - first.y) / dt / 60)
          ),
        };
      }
    }

    const speed = Math.sqrt(
      velocityRef.current.x ** 2 + velocityRef.current.y ** 2
    );
    if (speed < MIN_VELOCITY) {
      onPositionChange(posRef.current);
      return;
    }

    physicsRunning.current = true;

    const step = () => {
      const vel = velocityRef.current;
      const pos = posRef.current;

      // Apply velocity
      pos.x += vel.x;
      pos.y += vel.y;

      // Friction
      const spd = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      const friction = spd > 10 ? FRICTION_FAST : FRICTION;
      vel.x *= friction;
      vel.y *= friction;

      // Edge bouncing
      const maxX = window.innerWidth - PANEL_WIDTH - EDGE_MARGIN;
      const maxY = Math.max(
        window.innerHeight + window.scrollY - 48,
        window.scrollY + 100
      );

      if (pos.x < EDGE_MARGIN) {
        pos.x = EDGE_MARGIN;
        vel.x = -vel.x * BOUNCE_DAMPING;
      }
      if (pos.x > maxX) {
        pos.x = maxX;
        vel.x = -vel.x * BOUNCE_DAMPING;
      }
      if (pos.y < EDGE_MARGIN) {
        pos.y = EDGE_MARGIN;
        vel.y = -vel.y * BOUNCE_DAMPING;
      }
      if (pos.y > maxY) {
        pos.y = maxY;
        vel.y = -vel.y * BOUNCE_DAMPING;
      }

      setPos(pos.x, pos.y);

      if (Math.abs(vel.x) > MIN_VELOCITY || Math.abs(vel.y) > MIN_VELOCITY) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        physicsRunning.current = false;
        onPositionChange(posRef.current);
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [setPos, onPositionChange]);

  // Cleanup physics on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // --- Drag handlers ---
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      cancelAnimationFrame(rafRef.current);
      physicsRunning.current = false;

      setDragging(true);
      onBringToFront();
      dragOffset.current = {
        x: e.clientX - posRef.current.x,
        y: e.clientY - posRef.current.y,
      };
      samplesRef.current = [];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onBringToFront]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const nx = e.clientX - dragOffset.current.x;
      const ny = e.clientY - dragOffset.current.y;
      setPos(nx, ny);

      // Sample for velocity
      const now = Date.now();
      samplesRef.current.push({ x: nx, y: ny, t: now });
      const cutoff = now - VELOCITY_WINDOW_MS * 2;
      samplesRef.current = samplesRef.current.filter((s) => s.t > cutoff);
    },
    [dragging, setPos]
  );

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    startPhysics();
  }, [dragging, startPhysics]);

  return (
    <motion.div
      ref={panelRef}
      style={{
        x: mx,
        y: my,
        position: "absolute",
        width: PANEL_WIDTH,
        zIndex: dragging ? 999999 : zIndex,
        left: 0,
        top: 0,
      }}
      className={`panel overflow-hidden ${dragging ? "shadow-[var(--shadow-lifted)]" : ""}`}
      onPointerDown={() => onBringToFront()}
    >
      {/* Header — drag handle */}
      <div
        className={`flex items-center gap-2 px-4 h-12 select-none transition-colors hover:bg-[rgba(64,64,64,0.3)] ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical
          size={14}
          className="text-text-faint shrink-0 pointer-events-none"
        />

        <span className="text-[13px] font-medium text-text-secondary truncate flex-1 pointer-events-none">
          {server.name}
        </span>

        {attentionCount > 0 && (
          <span className="animate-shimmer px-1.5 py-0.5 rounded bg-warn/20 text-warn text-[10px] font-semibold pointer-events-none">
            {attentionCount}
          </span>
        )}

        {server.online ? (
          <span className="flex items-center gap-1 text-[10px] text-ok pointer-events-none">
            <Wifi size={10} />
            <span>{activeCount}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-warn pointer-events-none">
            <WifiOff size={10} />
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
          className="btn-ghost p-1 shrink-0"
          title="New session"
        >
          <Plus size={13} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="btn-ghost p-1 shrink-0"
        >
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <ChevronUp size={13} className="text-text-faint" />
          </motion.div>
        </button>
      </div>

      {/* Session list — collapsible */}
      <motion.div
        animate={{
          height: expanded ? contentHeight || "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{
          height: { type: "spring", stiffness: 400, damping: 28 },
          opacity: { duration: 0.15 },
        }}
        className="overflow-hidden"
      >
        <div ref={contentRef} className="pb-2 pt-1">
          {server.online ? (
            <>
              {server.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onOpen={() => onOpenTerminal(session.id)}
                  onKill={() => onKillSession(session.id)}
                />
              ))}
              {server.sessions.length === 0 && (
                <div className="px-4 py-3 text-[11px] text-text-faint italic">
                  No sessions
                </div>
              )}
            </>
          ) : (
            <div className="px-4 py-3 text-[11px] text-text-faint italic">
              Offline
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
