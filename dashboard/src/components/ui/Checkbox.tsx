"use client";

import { Check } from "lucide-react";

const COLOR_MAP: Record<string, { bg: string; border: string }> = {
  accent: { bg: "bg-accent", border: "border-accent" },
  "orange-500": { bg: "bg-orange-500", border: "border-orange-500" },
};

export function Checkbox({
  checked,
  onChange,
  label,
  color = "accent",
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Tailwind color token — "accent", "orange-500", etc. */
  color?: string;
  className?: string;
}) {
  const colorClasses = COLOR_MAP[color] ?? COLOR_MAP.accent;

  return (
    <label
      className={`flex items-center gap-2.5 cursor-pointer select-none group ${className}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-4 h-4 rounded-[5px] border transition-all duration-150 flex items-center justify-center shrink-0 ${
          checked
            ? `${colorClasses.bg} ${colorClasses.border}`
            : "bg-transparent border-text-faint group-hover:border-text-muted"
        }`}
      >
        {checked && (
          <Check size={11} strokeWidth={3} className="text-white" />
        )}
      </button>
      {label && (
        <span className="text-[12px] text-text-muted">{label}</span>
      )}
    </label>
  );
}
