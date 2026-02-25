"use client";

import { motion } from "framer-motion";
import type { SessionState } from "@/lib/types";

const stateConfig: Record<
  SessionState,
  { color: string; label: string; pulse: boolean }
> = {
  idle: { color: "#22c55e", label: "Idle", pulse: false },
  working: { color: "#eab308", label: "Working", pulse: true },
  needs_attention: { color: "#ef4444", label: "Needs You", pulse: true },
  starting: { color: "#9ca3af", label: "Starting", pulse: true },
  dead: { color: "#374151", label: "Exited", pulse: false },
};

export function StatusIndicator({
  state,
  size = 10,
}: {
  state: SessionState;
  size?: number;
}) {
  const config = stateConfig[state] || stateConfig.idle;

  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {config.pulse && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: config.color, opacity: 0.4 }}
          animate={{
            scale: [1, 1.8, 1],
            opacity: [0.4, 0, 0.4],
          }}
          transition={{
            duration: state === "needs_attention" ? 1 : 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      )}
      <span
        className="relative inline-flex rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: config.color,
        }}
      />
    </span>
  );
}

export function StateLabel({ state }: { state: SessionState }) {
  const config = stateConfig[state] || stateConfig.idle;
  return (
    <span className="text-xs font-medium" style={{ color: config.color }}>
      {config.label}
    </span>
  );
}

export function getStateColor(state: SessionState): string {
  return stateConfig[state]?.color || stateConfig.idle.color;
}
