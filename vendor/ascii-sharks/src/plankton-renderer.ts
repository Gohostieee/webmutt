import type { PlanktonClump, PlanktonField } from "./plankton";

const SIZE = 16;
const DARK_GREENS = ["#73bd46", "#9bcf55", "#4f9d45", "#b4d76a"];
const LIGHT_GREENS = ["#3f782b", "#5b872e", "#316d3c", "#6f8b32"];

interface ClumpLayer {
  canvas: HTMLCanvasElement;
  extent: number;
  spread: number;
  revision: number;
  paintedAt: number;
  refreshAt: number;
}

/** Small ASCII colonies; sixteen shared sprites instead of per-bloom text work. */
export class PlanktonRenderer {
  private sprites: HTMLCanvasElement[] = [];
  private greens: string[];
  private layers = new Map<PlanktonClump, ClumpLayer>();

  constructor(font: string, private dpr: number, light: boolean) {
    const greens = light ? LIGHT_GREENS : DARK_GREENS;
    this.greens = greens;
    for (let variant = 0; variant < 4; variant++) {
      for (let stage = 0; stage < 4; stage++) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = Math.ceil(SIZE * dpr);
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = greens[variant];
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 7px ${font}`;
        if (stage === 0) {
          ctx.fillRect(7.3, 7.3, 1.5, 1.5);
        } else {
          ctx.fillText(stage === 1 ? ":" : "+", 8, 8);
          const arms = stage === 1 ? 2 : stage === 2 ? 4 : 6;
          for (let arm = 0; arm < arms; arm++) {
            const angle = arm / arms * Math.PI * 2 + variant * 0.8;
            const r = stage === 3 ? 4.5 : 3;
            ctx.fillRect(7.4 + Math.cos(angle) * r, 7.4 + Math.sin(angle) * r, 1.4, 1.4);
          }
        }
        this.sprites.push(canvas);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, field: PlanktonField) {
    // Composite a handful of small layers instead of thousands of translucent
    // sprites each frame. Growth scales continuously; bites refresh within 50ms.
    for (let i = 0; i < field.clumps.length; i++) {
      const clump = field.clumps[i];
      let layer = this.layers.get(clump);
      if (!layer) {
        const extent = Math.ceil(Math.max(...clump.strands.flatMap(strand =>
          [Math.abs(strand.ax), Math.abs(strand.ay), Math.abs(strand.bx), Math.abs(strand.by)])) + SIZE);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = Math.ceil(extent * 2 * this.dpr);
        layer = { canvas, extent, spread: clump.spread, revision: -1, paintedAt: -Infinity, refreshAt: 0 };
        this.layers.set(clump, layer);
      }
      if (field.time >= layer.refreshAt || clump.revision !== layer.revision && field.time - layer.paintedAt >= 0.05) {
        this.paintLayer(layer, clump, field, i);
      }
      const extent = layer.extent * clump.spread / layer.spread;
      ctx.drawImage(layer.canvas, clump.x - extent, clump.y - extent, extent * 2, extent * 2);
    }
  }

  private paintLayer(layer: ClumpLayer, clump: PlanktonClump, field: PlanktonField, index: number) {
    const ctx = layer.canvas.getContext("2d")!;
    const center = layer.extent;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, center * 2, center * 2);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = this.greens[index % this.greens.length];
    ctx.globalAlpha = 0.06 + clump.meanGrowth * 0.28;
    ctx.beginPath();
    for (const strand of clump.strands) {
      ctx.moveTo(center + strand.ax * clump.spread, center + strand.ay * clump.spread);
      ctx.lineTo(center + strand.bx * clump.spread, center + strand.by * clump.spread);
    }
    ctx.stroke();
    for (const bloom of field.blooms) {
      if (bloom.clump !== clump) continue;
      const stage = Math.min(3, Math.floor(bloom.growth * 4));
      const size = SIZE * (0.55 + bloom.growth * 0.45);
      const sway = field.time * 0.45 + bloom.phase;
      ctx.globalAlpha = 0.5 + bloom.growth * 0.45;
      ctx.drawImage(this.sprites[bloom.variant * 4 + stage],
        center + bloom.offsetX * clump.spread + Math.sin(sway) * 1.4 - size / 2,
        center + bloom.offsetY * clump.spread + Math.cos(sway * 0.8) - size / 2, size, size);
    }
    layer.spread = clump.spread;
    layer.revision = clump.revision;
    layer.paintedAt = field.time;
    layer.refreshAt = field.time + 0.12 + (index % 4) * 0.013;
  }
}
