"use client";

import { useEffect, useRef } from "react";

/** A procedural light field, independent of the robot and its simulation clock. */
export function SensoryField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1;
    let height = 1;
    let frame = 0;
    let visible = true;
    let lastFrame = 0;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const rays = Array.from({ length: 180 }, (_, i) => ({
      angle: i * 2.399963,
      spread: 0.3 + ((i * 73) % 101) / 101,
      phase: i * 0.93,
      weight: i % 9 === 0 ? 1.6 : 0.45,
    }));

    function draw(time: number) {
      if (!context) return;
      pointer.x += (pointer.targetX - pointer.x) * 0.035;
      pointer.y += (pointer.targetY - pointer.y) * 0.035;
      const cx = width * 0.5 + pointer.x * 24;
      const cy = height * 0.48 + pointer.y * 18;
      const radius = Math.max(width, height) * 0.87;
      const t = motion.matches ? 0 : time * 0.00012;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#030509";
      context.fillRect(0, 0, width, height);
      const halo = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.65);
      halo.addColorStop(0, "rgba(62,106,220,.27)");
      halo.addColorStop(0.25, "rgba(28,48,104,.12)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "screen";
      for (const ray of rays) {
        const angle = ray.angle + Math.sin(t + ray.phase) * 0.028;
        const inner = 24 + ray.spread * 45;
        const outer = radius * ray.spread;
        const bend = Math.sin(ray.phase + t) * 0.09;
        const x = cx + Math.cos(angle) * outer;
        const y = cy + Math.sin(angle) * outer;
        const light = context.createLinearGradient(cx, cy, x, y);
        light.addColorStop(0, "rgba(218,231,255,0)");
        light.addColorStop(0.1, `rgba(170,196,255,${0.13 + ray.spread * 0.14})`);
        light.addColorStop(0.42, "rgba(94,132,219,.17)");
        light.addColorStop(1, "rgba(55,80,140,0)");
        context.strokeStyle = light;
        context.lineWidth = ray.weight;
        context.beginPath();
        context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        context.bezierCurveTo(
          cx + Math.cos(angle + bend) * outer * 0.28,
          cy + Math.sin(angle + bend) * outer * 0.28,
          cx + Math.cos(angle - bend) * outer * 0.64,
          cy + Math.sin(angle - bend) * outer * 0.64, x, y,
        );
        context.stroke();
      }
      // An elliptical interference pattern gives the field a physical centre.
      for (let i = 0; i < 42; i++) {
        const r = 60 + i * 2.2;
        context.strokeStyle = `rgba(151,183,252,${0.035 + Math.sin(i * 0.6 + t) * 0.02})`;
        context.lineWidth = 0.65;
        context.beginPath();
        context.ellipse(cx, cy, r, r * 0.72, -0.5 + i * 0.025 + t * 0.08, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalCompositeOperation = "source-over";
    }

    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(0);
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(canvas);
    const onPointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - bounds.left) / width - 0.5) * 2;
      pointer.targetY = ((event.clientY - bounds.top) / height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    const animate = (time: number) => {
      if (visible && !motion.matches && time - lastFrame > 32) {
        draw(time);
        lastFrame = time;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="sensory-field" aria-hidden="true" />;
}
