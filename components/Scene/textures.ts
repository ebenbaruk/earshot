/**
 * Procedural canvas textures. Everything is generated at runtime — the demo must
 * work with no network, so there are no image URLs anywhere in the scene.
 *
 * Textures are module-level singletons: they are built once on first use and
 * shared by every material that wants them.
 */

import {
  CanvasTexture,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement("canvas");
  el.width = size;
  el.height = size;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  return [el, ctx];
}

/** Deterministic value noise so the grain is identical on every reload. */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < 4; i += 1) {
    sum += valueNoise(fx, fy) * amp;
    fx *= 2.03;
    fy *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

let woodColor: Texture | null = null;
let woodRough: Texture | null = null;

function buildWood(): void {
  const SIZE = 512;
  const [colorEl, colorCtx] = canvas(SIZE);
  const [roughEl, roughCtx] = canvas(SIZE);
  const colorImg = colorCtx.createImageData(SIZE, SIZE);
  const roughImg = roughCtx.createImageData(SIZE, SIZE);

  // Light warm MDF / beech: long grain along u, faint cathedral figure.
  const base = { r: 208, g: 178, b: 142 };

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      const v = y / SIZE;
      // Stretched noise = grain running along x.
      const warp = fbm(u * 3.2, v * 22) * 1.4;
      const rings = Math.sin((v * 34 + warp * 6) * Math.PI) * 0.5 + 0.5;
      const fine = fbm(u * 90, v * 260) * 0.5;
      const speck = valueNoise(x * 0.9, y * 0.9);

      // Keep the contrast low: a *faint* grain, not a cartoon plank.
      const shade = 0.86 + rings * 0.12 + fine * 0.13 - speck * 0.06;
      const i = (y * SIZE + x) * 4;
      colorImg.data[i] = Math.min(255, base.r * shade);
      colorImg.data[i + 1] = Math.min(255, base.g * shade);
      colorImg.data[i + 2] = Math.min(255, base.b * shade);
      colorImg.data[i + 3] = 255;

      // Grain lines read as slightly rougher fibres.
      const r = 210 + rings * 26 - fine * 40;
      roughImg.data[i] = r;
      roughImg.data[i + 1] = r;
      roughImg.data[i + 2] = r;
      roughImg.data[i + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  woodColor = new CanvasTexture(colorEl);
  woodColor.colorSpace = SRGBColorSpace;
  woodColor.wrapS = RepeatWrapping;
  woodColor.wrapT = RepeatWrapping;
  woodColor.anisotropy = 4;

  woodRough = new CanvasTexture(roughEl);
  woodRough.wrapS = RepeatWrapping;
  woodRough.wrapT = RepeatWrapping;
}

export function woodTextures(): { map: Texture; roughnessMap: Texture } {
  if (!woodColor || !woodRough) buildWood();
  return { map: woodColor as Texture, roughnessMap: woodRough as Texture };
}

let glowTex: Texture | null = null;

/** Soft radial falloff, used for the grasp-point glow and the light pool. */
export function glowTexture(): Texture {
  if (glowTex) return glowTex;
  const SIZE = 256;
  const [el, ctx] = canvas(SIZE);
  const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(0.7, "rgba(255,255,255,0.13)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  glowTex = new CanvasTexture(el);
  glowTex.colorSpace = SRGBColorSpace;
  glowTex.minFilter = LinearFilter;
  return glowTex;
}

let ringTex: Texture | null = null;

/** An annulus with soft inner and outer edges — the "grasp here" halo. */
export function haloTexture(): Texture {
  if (ringTex) return ringTex;
  const SIZE = 256;
  const [el, ctx] = canvas(SIZE);
  const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  g.addColorStop(0, "rgba(255,255,255,0.16)");
  g.addColorStop(0.42, "rgba(255,255,255,0.05)");
  g.addColorStop(0.62, "rgba(255,255,255,1)");
  g.addColorStop(0.76, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ringTex = new CanvasTexture(el);
  ringTex.colorSpace = SRGBColorSpace;
  ringTex.minFilter = LinearFilter;
  return ringTex;
}

let spongeTex: Texture | null = null;

/** Open-cell cellulose: dense pitting, used as a bump/roughness break-up. */
export function spongeRoughness(): Texture {
  if (spongeTex) return spongeTex;
  const SIZE = 256;
  const [el, ctx] = canvas(SIZE);
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cells = valueNoise(x * 0.34, y * 0.34);
      const grit = valueNoise(x * 1.7, y * 1.7);
      const v = 150 + cells * 90 + grit * 40;
      const i = (y * SIZE + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  spongeTex = new CanvasTexture(el);
  spongeTex.wrapS = RepeatWrapping;
  spongeTex.wrapT = RepeatWrapping;
  return spongeTex;
}
