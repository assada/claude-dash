"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

// Physics constants — matching robot-components exactly
const PANEL_WIDTH = 320;
const BOUNDARY_MARGIN = 8;
const MAX_VELOCITY = 40;
const BASE_FRICTION = 0.975;
const HIGH_SPEED_FRICTION = 0.94;
const BOUNCE_DAMPING = 0.45;
const BOUNCE_FRICTION_BOOST = 0.85;
const MIN_VELOCITY = 0.15;
const MOMENTUM_THRESHOLD = 1.5;
const VELOCITY_SAMPLE_COUNT = 6;
const DRAG_SCALE = 1.018;
const IDLE_SHADOW = "0 24px 24px -12px rgba(0,0,0,0.25)";
const DRAG_SHADOW = "0 32px 40px -8px rgba(0,0,0,0.55)";

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

function getViewportBounds(panelWidth: number, panelHeight: number) {
  return {
    minX: BOUNDARY_MARGIN,
    maxX: window.innerWidth - panelWidth - BOUNDARY_MARGIN,
    minY: BOUNDARY_MARGIN,
    maxY: Math.max(
      window.innerHeight - panelHeight - BOUNDARY_MARGIN,
      BOUNDARY_MARGIN + 48
    ),
  };
}

function clampVelocity(vx: number, vy: number) {
  return {
    vx: Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vx)),
    vy: Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vy)),
  };
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
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // Physics refs — never trigger re-renders
  const posRef = useRef({ x: position.x, y: position.y });
  const velocitySamplesRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const animFrameRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  const justBouncedRef = useRef({ x: false, y: false });

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

  // Report viewport rect to dot grid
  const syncRect = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    reportRect({
      x: posRef.current.x,
      y: posRef.current.y,
      w: PANEL_WIDTH,
      h: panel.offsetHeight,
    });
  }, [reportRect]);

  // ResizeObserver: keep dot grid in sync with actual panel height
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const ro = new ResizeObserver(syncRect);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [syncRect]);

  // Sync DOM with position (for Arrange or initial load)
  useEffect(() => {
    if (!isDragging && !isAnimatingRef.current) {
      const panel = panelRef.current;
      if (!panel) return;

      // Spring animate to new position
      const startX = posRef.current.x;
      const startY = posRef.current.y;
      const targetX = position.x;
      const targetY = position.y;

      if (Math.abs(startX - targetX) < 1 && Math.abs(startY - targetY) < 1) {
        panel.style.left = targetX + "px";
        panel.style.top = targetY + "px";
        posRef.current = { x: targetX, y: targetY };
        syncRect();
        return;
      }

      // Simple spring animation for Arrange
      let vx = 0;
      let vy = 0;
      let cx = startX;
      let cy = startY;
      const stiffness = 0.08;
      const damp = 0.72;

      const step = () => {
        const fx = (targetX - cx) * stiffness;
        const fy = (targetY - cy) * stiffness;
        vx = (vx + fx) * damp;
        vy = (vy + fy) * damp;
        cx += vx;
        cy += vy;

        panel.style.left = cx + "px";
        panel.style.top = cy + "px";
        posRef.current = { x: cx, y: cy };
        syncRect();

        if (
          Math.abs(vx) > 0.1 ||
          Math.abs(vy) > 0.1 ||
          Math.abs(targetX - cx) > 0.5 ||
          Math.abs(targetY - cy) > 0.5
        ) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          panel.style.left = targetX + "px";
          panel.style.top = targetY + "px";
          posRef.current = { x: targetX, y: targetY };
          syncRect();
          animFrameRef.current = null;
        }
      };

      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(step);
    }
  }, [position.x, position.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // --- Velocity calculation ---
  const calculateVelocity = useCallback(() => {
    const samples = velocitySamplesRef.current;
    if (samples.length < 2) return { x: 0, y: 0 };

    const now = performance.now();
    const maxAge = 80;
    const last = samples[samples.length - 1];
    if (now - last.t > maxAge) return { x: 0, y: 0 };

    let totalWeight = 0;
    let wvx = 0;
    let wvy = 0;

    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];
      const dt = curr.t - prev.t;
      const age = now - curr.t;

      if (age <= maxAge && dt >= 8 && dt < 100) {
        const weight = i / samples.length;
        wvx += ((curr.x - prev.x) / dt) * 16.67 * weight;
        wvy += ((curr.y - prev.y) / dt) * 16.67 * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight === 0) return { x: 0, y: 0 };
    return { x: wvx / totalWeight, y: wvy / totalWeight };
  }, []);

  // --- Momentum animation ---
  const startMomentum = useCallback(
    (startX: number, startY: number, velX: number, velY: number) => {
      const panel = panelRef.current;
      if (!panel) return;

      const clamped = clampVelocity(velX, velY);
      let x = startX;
      let y = startY;
      let vx = clamped.vx;
      let vy = clamped.vy;

      isAnimatingRef.current = true;
      justBouncedRef.current = { x: false, y: false };

      const step = () => {
        const panelHeight = panel.offsetHeight;
        const bounds = getViewportBounds(PANEL_WIDTH, panelHeight);

        // Speed-dependent friction
        const speed = Math.sqrt(vx * vx + vy * vy);
        const speedRatio = Math.min(speed / MAX_VELOCITY, 1);
        const friction =
          BASE_FRICTION - speedRatio * (BASE_FRICTION - HIGH_SPEED_FRICTION);

        const bmx = justBouncedRef.current.x ? BOUNCE_FRICTION_BOOST : 1;
        const bmy = justBouncedRef.current.y ? BOUNCE_FRICTION_BOOST : 1;
        vx *= friction * bmx;
        vy *= friction * bmy;
        justBouncedRef.current = { x: false, y: false };

        x += vx;
        y += vy;

        // Edge bouncing
        if (x < bounds.minX) {
          x = bounds.minX;
          vx = Math.abs(vx) * BOUNCE_DAMPING;
          justBouncedRef.current.x = true;
        } else if (x > bounds.maxX) {
          x = bounds.maxX;
          vx = -Math.abs(vx) * BOUNCE_DAMPING;
          justBouncedRef.current.x = true;
        }
        if (y < bounds.minY) {
          y = bounds.minY;
          vy = Math.abs(vy) * BOUNCE_DAMPING;
          justBouncedRef.current.y = true;
        } else if (y > bounds.maxY) {
          y = bounds.maxY;
          vy = -Math.abs(vy) * BOUNCE_DAMPING;
          justBouncedRef.current.y = true;
        }

        // Direct DOM write — zero latency
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        posRef.current = { x, y };
        syncRect();

        if (Math.sqrt(vx * vx + vy * vy) > MIN_VELOCITY) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          isAnimatingRef.current = false;
          animFrameRef.current = null;
          onPositionChange({ x, y });
        }
      };

      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(step);
    },
    [onPositionChange, syncRect]
  );

  // --- Drag handlers ---
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      // Cancel any running animation
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      isAnimatingRef.current = false;

      const panel = panelRef.current;
      if (!panel) return;

      onBringToFront();
      setIsDragging(true);

      const grabOffsetX = e.clientX - posRef.current.x;
      const grabOffsetY = e.clientY - posRef.current.y;
      let hasMoved = false;

      velocitySamplesRef.current = [];

      // Apply drag style
      panel.style.boxShadow = DRAG_SHADOW;
      panel.style.transform = `scale(${DRAG_SCALE})`;
      panel.style.cursor = "grabbing";
      panel.style.zIndex = "999999";

      const onMove = (me: PointerEvent) => {
        const nx = me.clientX - grabOffsetX;
        const ny = me.clientY - grabOffsetY;

        if (!hasMoved && (Math.abs(nx - posRef.current.x) > 2 || Math.abs(ny - posRef.current.y) > 2)) {
          hasMoved = true;
        }

        if (hasMoved) {
          // Clamp to viewport bounds during drag
          const panelHeight = panel.offsetHeight;
          const bounds = getViewportBounds(PANEL_WIDTH, panelHeight);
          const fx = Math.max(bounds.minX, Math.min(bounds.maxX, nx));
          const fy = Math.max(bounds.minY, Math.min(bounds.maxY, ny));

          // Direct DOM write — instant, zero latency
          panel.style.left = fx + "px";
          panel.style.top = fy + "px";
          posRef.current = { x: fx, y: fy };
          syncRect();

          // Sample for velocity
          const now = performance.now();
          velocitySamplesRef.current.push({ x: fx, y: fy, t: now });
          if (velocitySamplesRef.current.length > VELOCITY_SAMPLE_COUNT) {
            velocitySamplesRef.current.shift();
          }
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        setIsDragging(false);
        panel.style.boxShadow = IDLE_SHADOW;
        panel.style.transform = "";
        panel.style.cursor = "";
        panel.style.zIndex = "";

        // Start momentum
        const vel = calculateVelocity();
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

        if (speed > MOMENTUM_THRESHOLD) {
          startMomentum(posRef.current.x, posRef.current.y, vel.x, vel.y);
        } else {
          onPositionChange(posRef.current);
        }
      };

      // Attach to window for reliable tracking outside panel
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onBringToFront, calculateVelocity, startMomentum, onPositionChange, syncRect]
  );

  return (
    <div
      ref={panelRef}
      className="panel overflow-hidden fixed"
      style={{
        width: PANEL_WIDTH,
        left: position.x,
        top: position.y,
        zIndex,
        boxShadow: IDLE_SHADOW,
        touchAction: "none",
        userSelect: "none",
      }}
      onPointerDown={() => onBringToFront()}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center gap-2 px-4 h-12 select-none transition-colors hover:bg-[rgba(64,64,64,0.3)] cursor-grab"
        onPointerDown={onPointerDown}
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
    </div>
  );
}
