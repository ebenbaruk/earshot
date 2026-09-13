# Contract requests

Requests from workers for things they cannot do inside their own scope.

## scene → build/deps: `@react-three/postprocessing`

**What:** add `@react-three/postprocessing` (and its peer `postprocessing`) to `package.json`.

**Why:** the 3D scene currently fakes its glow with additive sprites and a CSS
`box-shadow` vignette on the canvas wrapper. With an `EffectComposer` we would get:

- `Bloom` (luminanceThreshold ≈ 0.85, intensity ≈ 0.5) on the bag rim, the gripper
  LED and the grasp-point halo — this is the single biggest "wow" upgrade left;
- `Vignette` + a touch of `ChromaticAberration` in-canvas, so the vignette darkens
  the 3D image rather than sitting on top of it as a DOM overlay;
- `SMAA`, which is cheaper and cleaner than the current MSAA at dpr 2.

**Cost:** ~60 kB gzipped, one extra render target. Budget-wise it stays inside the
60 fps target on an M-series MacBook at 1440×900.

**Status:** not installed — the scene worker was told not to touch `package.json`,
so the scene ships without postprocessing. Everything else in `components/Scene/**`
is offline-safe (procedural canvas textures, `RoomEnvironment` IBL from the `three`
package; no HDR download, no external image URLs).
