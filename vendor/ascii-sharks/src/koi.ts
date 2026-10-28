import { clamp, hash3 } from "./math";
import { KOI_BODY_LENGTH, KOI_NODES } from "./koi-motion";
import { KOI_SPECIES } from "./species";
import type { Fish } from "./world";

interface KoiSprite {
  strips: { canvas: HTMLCanvasElement; offset: number; width: number }[];
  tail: HTMLCanvasElement;
}

type KoiContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const BODY_WIDTH = 36;
const BODY_HEIGHT = 22;
const BODY_HEAD_X = 31;
const TAIL_WIDTH = 12;
const TAIL_HEIGHT = 18;
const CELL = 1.5;
const GLYPHS = ":;%+st";
const FRAME_WIDTH = 56;
const FRAME_HEIGHT = 64;
const FRAME_HEAD_X = 44;
const FRAME_HEAD_Y = 32;
const POSE_PHASES = 16;
const BEND_LIMIT = 1.2;
const BEND_STEP = 0.2;
const BEND_POSES = 13;

/** Tiny patterned ASCII fish, cached once and animated with subpixel transforms. */
export class KoiRenderer {
  private sprites = new Map<number, KoiSprite>();
  private spine = new Float32Array(KOI_NODES * 2);
  // The finite grid bounds this cache to 6 * BEND_POSES * POSE_PHASES images.
  private poses = new Map<number, ImageBitmap | HTMLCanvasElement>();

  constructor(private fontFamily: string, private dpr: number, private light: boolean) {}

  draw(ctx: CanvasRenderingContext2D, fish: Fish[]) {
    const opacity = ctx.globalAlpha;
    const base = ctx.getTransform();
    ctx.save();
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      if (!f.alive || f.species !== KOI_SPECIES || !f.koi) continue;
      const { nodes, scale } = f.koi;
      const heading = f.koi.heading ?? Math.atan2(f.vy, f.vx);
      const cosine = Math.cos(heading);
      const sine = Math.sin(heading);
      const tail = (KOI_NODES - 1) * 2;
      const tailY = (-sine * (nodes[tail] - f.x) + cosine * (nodes[tail + 1] - f.y)) / scale;
      // The physical spine supplies the turn arc; interpolate cached artwork
      // in both curvature and swim phase instead of rebuilding every fish.
      const bend = clamp(-2 * tailY / KOI_BODY_LENGTH, -BEND_LIMIT, BEND_LIMIT);
      const curve = (bend + BEND_LIMIT) / BEND_STEP;
      const curveIndex = Math.min(BEND_POSES - 1, Math.round(curve));
      const residualBend = bend - (curveIndex * BEND_STEP - BEND_LIMIT);
      const phase = ((f.phase * 0.7) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
        * POSE_PHASES / (Math.PI * 2);
      const phaseA = Math.floor(phase);
      const phaseB = (phaseA + 1) % POSE_PHASES;
      const phaseMix = phase - phaseA;
      const alpha = opacity * (0.7 + f.depth * 0.3);
      let drawnWeight = 0;
      // A small continuous shear corrects the residual turn between cached
      // curves, keeping the tail on its arc without extra blended layers.
      this.transform(ctx, base, cosine * scale, sine * scale, f.x, f.y, residualBend / 2);
      for (let k = 0; k < 2; k++) {
        const phaseIndex = k === 0 ? phaseA : phaseB;
        const weight = k === 0 ? 1 - phaseMix : phaseMix;
        if (weight < 0.0001) continue;
        const pose = this.getPose(i % 6, curveIndex, phaseIndex);
        drawnWeight += weight;
        ctx.globalAlpha = alpha * weight / Math.max(0.0001, 1 - alpha + alpha * drawnWeight);
        ctx.drawImage(pose, -FRAME_HEAD_X, -FRAME_HEAD_Y, FRAME_WIDTH, FRAME_HEIGHT);
      }
    }
    ctx.restore();
  }

  private getPose(variant: number, curveIndex: number, phaseIndex: number) {
    const key = (variant * BEND_POSES + curveIndex) * POSE_PHASES + phaseIndex;
    const cached = this.poses.get(key);
    if (cached) return cached;
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    let context: KoiContext | null;
    if (typeof OffscreenCanvas === "function") {
      canvas = new OffscreenCanvas(FRAME_WIDTH * this.dpr, FRAME_HEIGHT * this.dpr);
      context = canvas.getContext("2d");
    } else {
      canvas = document.createElement("canvas");
      canvas.width = FRAME_WIDTH * this.dpr;
      canvas.height = FRAME_HEIGHT * this.dpr;
      context = canvas.getContext("2d");
    }
    if (!context) throw new Error("2D canvas unavailable");
    const bend = curveIndex * BEND_STEP - BEND_LIMIT;
    const phase = phaseIndex / POSE_PHASES * Math.PI * 2;
    for (let k = 0; k < KOI_NODES; k++) {
      const s = k / (KOI_NODES - 1);
      const angle = bend * s;
      const x = Math.abs(bend) < 0.0001 ? -KOI_BODY_LENGTH * s : -KOI_BODY_LENGTH * Math.sin(angle) / bend;
      const y = Math.abs(bend) < 0.0001 ? 0 : -KOI_BODY_LENGTH * (1 - Math.cos(angle)) / bend;
      const wave = KOI_BODY_LENGTH * 0.095 * (0.1 + 0.9 * Math.pow(s, 1.7)) * Math.sin(phase - s * 4.5);
      this.spine[k * 2] = x - Math.sin(angle) * wave;
      this.spine[k * 2 + 1] = y + Math.cos(angle) * wave;
    }
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.translate(FRAME_HEAD_X, FRAME_HEAD_Y);
    this.drawBody(context, context.getTransform(), this.getSprite(variant), 1, phase);
    const pose = "transferToImageBitmap" in canvas ? canvas.transferToImageBitmap() : canvas;
    this.poses.set(key, pose);
    return pose;
  }

  private drawBody(ctx: KoiContext, base: DOMMatrix, sprite: KoiSprite, scale: number, phase: number) {
    const tail = (KOI_NODES - 1) * 2;
    const tailAngle = Math.atan2(
      this.spine[tail - 1] - this.spine[tail + 1],
      this.spine[tail - 2] - this.spine[tail],
    ) + Math.sin(phase - 4.5) * 0.12;
    this.transform(ctx, base, Math.cos(tailAngle) * scale, Math.sin(tailAngle) * scale,
      this.spine[tail], this.spine[tail + 1]);
    ctx.drawImage(sprite.tail, -TAIL_WIDTH + 1, -TAIL_HEIGHT / 2, TAIL_WIDTH, TAIL_HEIGHT);

    const segment = KOI_BODY_LENGTH / (KOI_NODES - 1);
    for (let k = 0; k < KOI_NODES - 1; k++) {
      const x = this.spine[k * 2];
      const y = this.spine[k * 2 + 1];
      const dx = x - this.spine[(k + 1) * 2];
      const dy = y - this.spine[(k + 1) * 2 + 1];
      const length = Math.hypot(dx, dy) || 1;
      const stretch = length / segment;
      const strip = sprite.strips[k];
      this.transform(ctx, base, dx / length, dy / length, x, y);
      ctx.drawImage(
        strip.canvas, strip.offset * stretch,
        -BODY_HEIGHT / 2 * scale, strip.width * stretch, BODY_HEIGHT * scale,
      );
    }
  }

  private transform(ctx: KoiContext, base: DOMMatrix, cosine: number, sine: number, x: number, y: number, shear = 0) {
    const a = cosine - sine * shear;
    const b = sine + cosine * shear;
    ctx.setTransform(
      base.a * a + base.c * b, base.b * a + base.d * b,
      base.c * cosine - base.a * sine, base.d * cosine - base.b * sine,
      base.a * x + base.c * y + base.e, base.b * x + base.d * y + base.f,
    );
  }

  private createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * this.dpr);
    canvas.height = Math.ceil(height * this.dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `600 ${CELL * 1.15}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    return { canvas, ctx };
  }

  private getSprite(variant: number): KoiSprite {
    const cached = this.sprites.get(variant);
    if (cached) return cached;
    const body = this.createCanvas(BODY_WIDTH, BODY_HEIGHT);
    const tail = this.createCanvas(TAIL_WIDTH, TAIL_HEIGHT);
    if (!body || !tail) throw new Error("2D canvas unavailable");

    const ivory = this.light ? "#c9b38f" : "#eee6d5";
    const orange = this.light ? "#c25b24" : "#f0933c";
    const red = this.light ? "#ad3824" : "#e45b3d";
    const ink = this.light ? "#3a302a" : "#343741";
    const gold = this.light ? "#b18a35" : "#e9c66b";
    const fin = this.light ? "#b7a288" : "#c9c1af";

    for (let y = 0; y < BODY_HEIGHT; y += CELL) {
      for (let x = 0; x < BODY_WIDTH; x += CELL) {
        const px = x + CELL / 2;
        const py = y + CELL / 2 - BODY_HEIGHT / 2;
        const u = (px - 3) / 28;
        if (u < 0 || u > 1) continue;
        const halfWidth = 0.8 + Math.pow(Math.sin(u * Math.PI), 0.7) * 4.3;
        const bodyCell = Math.abs(py) < halfWidth;
        const finCell = u > 0.32 && u < 0.65
          && Math.abs(py) < halfWidth + Math.sin((u - 0.32) / 0.33 * Math.PI) * 3.4;
        if (!bodyCell && !finCell) continue;

        const v = py / halfWidth;
        const orangePatch = ((u - 0.62) / 0.17) ** 2 + ((v + 0.2) / 1.1) ** 2 < 1
          || ((u - 0.24) / 0.13) ** 2 + ((v - 0.35) / 0.9) ** 2 < 1;
        const darkPatch = (variant === 1 || variant === 2 || variant === 5)
          && ((u - 0.43) / 0.13) ** 2 + ((v - 0.1) / 0.85) ** 2 < 1;
        let color = variant === 3 ? gold : ivory;
        if (orangePatch && variant !== 4) color = variant === 2 ? red : orange;
        if (darkPatch) color = ink;
        if (variant === 4 && u > 0.77) color = red;
        if (!bodyCell) color = fin;

        const key = Math.floor(hash3(Math.round(x), Math.round(y), variant) * GLYPHS.length);
        body.ctx.globalAlpha = bodyCell ? 0.9 : 0.55;
        body.ctx.fillStyle = color;
        body.ctx.fillRect(x + 0.08, y + 0.08, CELL - 0.12, CELL - 0.12);
        body.ctx.globalAlpha = 0.35;
        body.ctx.fillStyle = color === ink ? ivory : ink;
        body.ctx.fillText(GLYPHS[key], px, y + CELL / 2);
      }
    }
    body.ctx.globalAlpha = 0.9;
    body.ctx.fillStyle = ink;
    body.ctx.fillRect(28, BODY_HEIGHT / 2 - 2.4, 1, 1);
    body.ctx.fillRect(28, BODY_HEIGHT / 2 + 1.4, 1, 1);

    for (let y = 0; y < TAIL_HEIGHT; y += CELL) {
      for (let x = 0; x < TAIL_WIDTH; x += CELL) {
        const u = (x + CELL / 2) / TAIL_WIDTH;
        const v = Math.abs(y + CELL / 2 - TAIL_HEIGHT / 2);
        if (v > (1 - u) * 7 + 0.5 || (u < 0.25 && v < 1.4)) continue;
        tail.ctx.globalAlpha = 0.72;
        tail.ctx.fillStyle = variant === 3 ? gold : u > 0.5 ? orange : ivory;
        tail.ctx.fillText(GLYPHS[Math.floor(u * 5)], x + CELL / 2, y + CELL / 2);
      }
    }

    // Pre-cut immutable textures avoid repeated source clipping during animation.
    const strips: KoiSprite["strips"] = [];
    const segment = KOI_BODY_LENGTH / (KOI_NODES - 1);
    for (let k = 0; k < KOI_NODES - 1; k++) {
      const headPadding = k === 0 ? BODY_WIDTH - BODY_HEAD_X : 0;
      const tailPadding = k === KOI_NODES - 2 ? BODY_HEAD_X - KOI_BODY_LENGTH : 0;
      const start = Math.floor(Math.max(0, BODY_HEAD_X - (k + 1) * segment - tailPadding - 0.35) * this.dpr) / this.dpr;
      const end = Math.ceil(Math.min(BODY_WIDTH, BODY_HEAD_X - k * segment + headPadding + 0.35) * this.dpr) / this.dpr;
      const strip = this.createCanvas(end - start, BODY_HEIGHT);
      if (!strip) throw new Error("2D canvas unavailable");
      strip.ctx.drawImage(body.canvas, start * this.dpr, 0, (end - start) * this.dpr, body.canvas.height,
        0, 0, end - start, BODY_HEIGHT);
      strips.push({ canvas: strip.canvas, offset: start - (BODY_HEAD_X - k * segment), width: end - start });
    }
    const sprite = { strips, tail: tail.canvas };
    this.sprites.set(variant, sprite);
    return sprite;
  }
}
