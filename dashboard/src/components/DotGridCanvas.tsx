"use client";

import { useRef, useEffect } from "react";

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SPACING = 40;
const PUSH_RADIUS = 300;
const PUSH_STRENGTH = 20;
const GLOW_RADIUS = 150;
const BASE_BRIGHTNESS = 0.07;
const BASE_SIZE = 1;
const LERP_SPEED = 0.08; // spring-like smooth following

export function DotGridCanvas({
  panelRectsRef,
}: {
  panelRectsRef: React.RefObject<Record<string, PanelRect>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  // Persistent dot offsets for smooth spring-like displacement
  const offsetsRef = useRef<Float32Array | null>(null);
  const gridDimsRef = useRef({ cols: 0, rows: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Rebuild offset arrays
      const cols = Math.ceil(window.innerWidth / SPACING) + 1;
      const rows = Math.ceil(window.innerHeight / SPACING) + 1;
      const count = cols * rows;
      gridDimsRef.current = { cols, rows };

      // ox, oy per dot
      offsetsRef.current = new Float32Array(count * 2);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scrollY = window.scrollY;
      const { cols, rows } = gridDimsRef.current;
      const offsets = offsetsRef.current;
      if (!offsets) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // Gather panel rects (viewport-relative)
      const panels: PanelRect[] = [];
      if (panelRectsRef.current) {
        for (const r of Object.values(panelRectsRef.current)) {
          panels.push({
            x: r.x,
            y: r.y - scrollY,
            w: r.w,
            h: r.h,
          });
        }
      }

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = (row * cols + col) * 2;
          const gx = col * SPACING + SPACING / 2;
          const gy = row * SPACING + SPACING / 2;

          // Calculate target displacement from panels
          let targetOx = 0;
          let targetOy = 0;
          let brightness = BASE_BRIGHTNESS;
          let size = BASE_SIZE;

          for (const p of panels) {
            const cx = p.x + p.w / 2;
            const cy = p.y + p.h / 2;
            const dx = gx - cx;
            const dy = gy - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Push force
            if (dist < PUSH_RADIUS && dist > 1) {
              const t = 1 - dist / PUSH_RADIUS;
              const strength = PUSH_STRENGTH * t * t;
              targetOx += (dx / dist) * strength;
              targetOy += (dy / dist) * strength;
            }

            // Glow: brightness + size
            if (dist < GLOW_RADIUS) {
              const t = 1 - dist / GLOW_RADIUS;
              brightness = Math.max(brightness, BASE_BRIGHTNESS + t * 0.55);
              size = Math.max(size, BASE_SIZE + t * 1.8);
            }
          }

          // Smooth lerp toward target (spring-like)
          offsets[idx] += (targetOx - offsets[idx]) * LERP_SPEED;
          offsets[idx + 1] += (targetOy - offsets[idx + 1]) * LERP_SPEED;

          const drawX = gx + offsets[idx];
          const drawY = gy + offsets[idx + 1];

          // Skip dots outside visible area (with margin)
          if (drawX < -10 || drawX > w + 10 || drawY < -10 || drawY > h + 10)
            continue;

          ctx.beginPath();
          ctx.arc(drawX, drawY, size, 0, Math.PI * 2);

          // Color: white far away, slightly blue near panels
          const blue = brightness > 0.15 ? 40 : 0;
          ctx.fillStyle = `rgba(${200 + blue}, ${200 + blue}, ${220 + blue}, ${brightness})`;
          ctx.fill();
        }
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
