"use client";

/**
 * Stand-in for the r3f canvas. The integrator replaces this element with
 * `<SceneNoSSR />` from `components/Scene` — same box, same absolute fill.
 */
export function ScenePlaceholder() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0a0908]">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(78% 70% at 50% 55%, black, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(78% 70% at 50% 55%, black, transparent 100%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[12px] tracking-[0.3em] text-white/15 uppercase">
          scene
        </span>
      </div>
    </div>
  );
}
