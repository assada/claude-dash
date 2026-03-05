"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom" | "left" | "right";

/**
 * Global tooltip provider — mount once in layout.
 * Any element with data-tooltip="text" gets a styled tooltip on hover.
 * Optional data-tooltip-pos="top|bottom|left|right" to force placement.
 * Uses event delegation (single listener), portal rendering, zero wrappers.
 * Auto-clamps to viewport edges so tooltip never overflows.
 */
export function TooltipProvider() {
  const [tip, setTip] = useState<{
    text: string;
    x: number;
    y: number;
    placement: Placement;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const targetRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // After tooltip renders, measure and clamp horizontally via direct DOM update
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!tip || !el) return;

    const rect = el.getBoundingClientRect();
    const pad = 8;

    let shift = 0;
    if (rect.left < pad) {
      shift = pad - rect.left;
    } else if (rect.right > window.innerWidth - pad) {
      shift = window.innerWidth - pad - rect.right;
    }

    if (shift !== 0) {
      el.style.left = `${tip.x + shift}px`;
    }
  }, [tip]);

  useEffect(() => {
    const show = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.(
        "[data-tooltip]"
      ) as HTMLElement | null;
      if (!el || el === targetRef.current) return;

      clearTimeout(timerRef.current);
      setTip(null);
      targetRef.current = el;

      timerRef.current = setTimeout(() => {
        const text = el.dataset.tooltip;
        if (!text) return;

        const rect = el.getBoundingClientRect();
        const forced = el.dataset.tooltipPos as Placement | undefined;
        const placement = forced || pickPlacement(rect);

        const coords = calcCoords(rect, placement);
        setTip({ text, ...coords, placement });
      }, 400);
    };

    const hide = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.(
        "[data-tooltip]"
      ) as HTMLElement | null;
      const related = (e.relatedTarget as HTMLElement)?.closest?.(
        "[data-tooltip]"
      );
      if (el === targetRef.current && related !== targetRef.current) {
        clearTimeout(timerRef.current);
        targetRef.current = null;
        setTip(null);
      }
    };

    const dismiss = () => {
      clearTimeout(timerRef.current);
      targetRef.current = null;
      setTip(null);
    };

    document.addEventListener("mouseover", show);
    document.addEventListener("mouseout", hide);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("pointerdown", dismiss);

    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("mouseout", hide);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("pointerdown", dismiss);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!tip) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className={`tooltip-popup tooltip-${tip.placement}`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>,
    document.body
  );
}

const MARGIN = 48;

function pickPlacement(rect: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer top, then bottom, then right, then left
  if (rect.top > MARGIN) return "top";
  if (vh - rect.bottom > MARGIN) return "bottom";
  if (vw - rect.right > 120) return "right";
  return "left";
}

function calcCoords(
  rect: DOMRect,
  placement: Placement
): { x: number; y: number } {
  switch (placement) {
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "left":
      return { x: rect.left, y: rect.top + rect.height / 2 };
  }
}
