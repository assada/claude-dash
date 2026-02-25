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
          initial={{ opacity: 0, scale: 0.5, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: 20 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onClick}
          className="fixed bottom-6 right-6 z-50"
        >
          <motion.div animate={controls} className="relative">
            {/* Stacked cards behind */}
            <div
              className="absolute inset-0 w-14 h-14 rounded-xl bg-zinc-700/60 border border-zinc-600/40"
              style={{ transform: "rotate(6deg) translate(3px, -3px)" }}
            />
            <div
              className="absolute inset-0 w-14 h-14 rounded-xl bg-zinc-700/80 border border-zinc-600/50"
              style={{ transform: "rotate(3deg) translate(1.5px, -1.5px)" }}
            />

            {/* Front card */}
            <div className="relative w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-lg shadow-black/40">
              <Archive size={22} className="text-zinc-300" />
            </div>

            {/* Count badge */}
            <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] rounded-full bg-blue-500 flex items-center justify-center px-1">
              <span className="text-xs font-bold text-white">{count}</span>
            </div>
          </motion.div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
