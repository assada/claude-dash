"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { Archive } from "lucide-react";

export function ArchiveStack({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const controls = useAnimation();
  const prevCountRef = useRef(count);

  useEffect(() => {
    if (count > prevCountRef.current) {
      controls.start({
        scale: [1, 1.15, 1],
        transition: { duration: 0.3, ease: "easeInOut" },
      });
    }
    prevCountRef.current = count;
  }, [count, controls]);

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          transition={{
            opacity: { duration: 0.15 },
            scale: { type: "spring", stiffness: 500, damping: 25 },
          }}
          whileHover={{
            scale: 1.1,
            boxShadow: "0 32px 40px -8px rgba(0, 0, 0, 0.55)",
          }}
          whileTap={{ scale: 0.95 }}
          onClick={onClick}
          className="fixed bottom-6 right-6 z-50"
        >
          <motion.div animate={controls} className="relative">
            {/* Stacked cards behind */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: 56,
                height: 56,
                borderRadius: 12,
                background: "linear-gradient(135deg, #3a3a3a 0%, #2f2f2f 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
                transform: "rotate(6deg) translate(3px, -3px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: 56,
                height: 56,
                borderRadius: 12,
                background: "linear-gradient(135deg, #3a3a3a 0%, #2f2f2f 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                transform: "rotate(3deg) translate(1.5px, -1.5px)",
              }}
            />

            {/* Front card */}
            <div
              className="btn-skin relative flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                border: "1px solid #404040",
                boxShadow: "0 24px 24px -12px rgba(0, 0, 0, 0.25)",
              }}
            >
              <Archive size={20} style={{ color: "#e5e5e5" }} />
            </div>

            {/* Count badge */}
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                background: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 5px",
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.4)",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>
                {count}
              </span>
            </div>
          </motion.div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
