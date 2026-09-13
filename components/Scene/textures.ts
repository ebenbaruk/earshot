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

let eggTex: Texture | null = null;

/** Warm off-white shell with the faint brown speckle of a free-range egg. */
export function eggSpeckle(): Texture {
  if (eggTex) return eggTex;
  const SIZE = 256;
  const [el, ctx] = canvas(SIZE);
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // A very soft mottle so the shell is never flat plastic.
      const mottle = fbm(x * 0.05, y * 0.05) * 0.14 + 0.93;
      const i = (y * SIZE + x) * 4;
      img.data[i] = Math.min(255, 245 * mottle);
      img.data[i + 1] = Math.min(255, 233 * mottle);
      img.data[i + 2] = Math.min(255, 213 * mottle);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Speckles: deterministic positions, varying size and strength.
  for (let n = 0; n < 320; n += 1) {
    const x = hash(n, 11) * SIZE;
    const y = hash(n, 23) * SIZE;
    const r = 0.6 + hash(n, 37) * 2.2;
    const a = 0.14 + hash(n, 51) * 0.34;
    ctx.fillStyle = `rgba(${118 + hash(n, 67) * 40 | 0},${88 + hash(n, 71) * 30 | 0},58,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + hash(n, 83) * 0.8), hash(n, 97) * 3.14, 0, Math.PI * 2);
    ctx.fill();
  }

  eggTex = new CanvasTexture(el);
  eggTex.colorSpace = SRGBColorSpace;
  eggTex.wrapS = RepeatWrapping;
  eggTex.wrapT = RepeatWrapping;
  return eggTex;
}

let splatTex: Texture | null = null;

/** An irregular blob with a soft edge — the yolk on the bag floor. */
export function splatTexture(): Texture {
  if (splatTex) return splatTex;
  const SIZE = 256;
  const [el, ctx] = canvas(SIZE);
  const c = SIZE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.96)");
  g.addColorStop(0.82, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");

  // Wobbly outline so the splat never reads as a perfect disc.
  ctx.save();
  ctx.beginPath();
  const STEPS = 64;
  for (let i = 0; i <= STEPS; i += 1) {
    const a = (i / STEPS) * Math.PI * 2;
    const wob = 0.76 + fbm(Math.cos(a) * 1.7 + 3, Math.sin(a) * 1.7 + 5) * 0.5;
    const r = c * Math.min(1, wob);
    const px = c + Math.cos(a) * r;
    const py = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();

  // A few stray droplets around the rim.
  for (let n = 0; n < 14; n += 1) {
    const a = hash(n, 3) * Math.PI * 2;
    const d = c * (0.72 + hash(n, 9) * 0.26);
    const r = 2 + hash(n, 17) * 5;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + hash(n, 29) * 0.45})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }

  splatTex = new CanvasTexture(el);
  splatTex.colorSpace = SRGBColorSpace;
  splatTex.minFilter = LinearFilter;
  return splatTex;
}
