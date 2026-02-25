"use client";

import { useRef, useEffect } from "react";

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Constants matching robot-components exactly
const GRID_SIZE = 40;
const MAX_DIST = 400;
const PUSH_STRENGTH = 25;
const SPRING_STIFFNESS = 0.08;
const DAMPING = 0.75;
const BRIGHTNESS_RADIUS = 110;
const BASE_OPACITY = 0.18;
const BRIGHTNESS_BOOST = 0.8;

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  targetSize: number;
}

/**
 * Distance from a point to the nearest edge of a rectangle.
 * Returns the closest point on the rect and the distance.
 */
function distToRect(
  px: number,
  py: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const cx = Math.max(left, Math.min(px, right));
  const cy = Math.max(top, Math.min(py, bottom));
  const dx = px - cx;
  const dy = py - cy;
  return { dx, dy, dist: Math.sqrt(dx * dx + dy * dy) };
}

export function DotGridCanvas({
  panelRectsRef,
}: {
  panelRectsRef: React.RefObject<Record<string, PanelRect>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const dotsRef = useRef<Map<string, Dot>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let running = true;

    const initDots = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      dotsRef.current.clear();
      for (let gx = -GRID_SIZE; gx < w + GRID_SIZE * 2; gx += GRID_SIZE) {
        for (let gy = -GRID_SIZE; gy < h + GRID_SIZE * 2; gy += GRID_SIZE) {
          dotsRef.current.set(`${gx},${gy}`, {
            x: gx,
            y: gy,
            vx: 0,
            vy: 0,
            size: 1,
            targetSize: 1,
          });
        }
      }
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initDots();
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.clearRect(0, 0, w, h);

      // Panels are position:fixed — rects are already in viewport coords
      const panels: PanelRect[] = [];
      if (panelRectsRef.current) {
        for (const r of Object.values(panelRectsRef.current)) {
          panels.push(r);
        }
      }

      for (const [key, dot] of dotsRef.current) {
        // Parse base grid position from key
        const commaIdx = key.indexOf(",");
        const baseX = parseInt(key.substring(0, commaIdx));
        const baseY = parseInt(key.substring(commaIdx + 1));

        // Accumulate push from all panels
        let totalPushX = 0;
        let totalPushY = 0;
        let minDist = Infinity;

        for (const p of panels) {
          const { dx, dy, dist } = distToRect(
            baseX,
            baseY,
            p.x,
            p.y,
            p.x + p.w,
            p.y + p.h
          );

          minDist = Math.min(minDist, dist);

          if (dist > 0 && dist < MAX_DIST) {
            const normalizedDist = dist / MAX_DIST;
            const pushAmount =
              Math.pow(1 - normalizedDist, 2) * PUSH_STRENGTH;
            totalPushX += (dx / dist) * pushAmount;
            totalPushY += (dy / dist) * pushAmount;
          }
        }

        // Target position = base + displacement
        const targetX = baseX + totalPushX;
        const targetY = baseY + totalPushY;

        // Spring physics: dot springs toward target
        const forceX = (targetX - dot.x) * SPRING_STIFFNESS;
        const forceY = (targetY - dot.y) * SPRING_STIFFNESS;
        dot.vx = (dot.vx + forceX) * DAMPING;
        dot.vy = (dot.vy + forceY) * DAMPING;
        dot.x += dot.vx;
        dot.y += dot.vy;

        // Skip offscreen dots
        if (dot.x < -20 || dot.x > w + 20 || dot.y < -20 || dot.y > h + 20)
          continue;

        // Size: sine curve on normalized distance
        const normalizedDist = Math.min(minDist / MAX_DIST, 1);
        const ripple = Math.sin(normalizedDist * Math.PI);
        dot.targetSize = 0.8 + ripple * 2;
        dot.size += (dot.targetSize - dot.size) * 0.15;

        // Brightness: tight 110px radius, quadratic falloff
        const brightDist = Math.min(minDist / BRIGHTNESS_RADIUS, 1);
        const brightFalloff = brightDist * brightDist;
        const opacity = BASE_OPACITY + (1 - brightFalloff) * BRIGHTNESS_BOOST;

        // Color: 130 (far) to 255 (near)
        const colorVal = Math.round(130 + (1 - brightFalloff) * 125);

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.5, dot.size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorVal},${colorVal},${colorVal},${Math.max(0, opacity)})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [panelRectsRef]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
