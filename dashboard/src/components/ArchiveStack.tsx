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
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onClick}
          className="fixed bottom-6 right-6 z-50"
        >
          <motion.div animate={controls} className="relative">
            {/* Stacked cards behind */}
            <div className="absolute inset-0 w-14 h-14 rounded-xl bg-surface-2 border border-border-subtle rotate-[6deg] translate-x-[3px] -translate-y-[3px]" />
            <div className="absolute inset-0 w-14 h-14 rounded-xl bg-surface-2 border border-border-subtle rotate-[3deg] translate-x-[1.5px] -translate-y-[1.5px]" />

            {/* Front card */}
            <div className="btn-skin relative w-14 h-14 !rounded-xl flex items-center justify-center shadow-[var(--shadow-panel)]">
              <Archive size={20} className="text-text-secondary" />
            </div>

            {/* Count badge */}
            <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] rounded-full bg-accent flex items-center justify-center px-1 shadow-[0_4px_12px_rgba(37,99,235,0.4)]">
              <span className="text-[11px] font-semibold text-white">{count}</span>
            </div>
          </motion.div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
