import { clamp, rand, randInt } from "./math";

export const PLANKTON_BUD = 0.06;
export const PLANKTON_RIPE = 0.82;
const CELL = 96;

export interface PlanktonOptions {
  /** Blooms per 340 CSS square pixels, concentrated along rootlike clumps; zero disables them. */
  planktonDensity?: number;
}

export interface Plankton {
  x: number;
  y: number;
  growth: number;
  ripe: boolean;
  growthRate: number;
  bornAt: number;
  phase: number;
  variant: number;
  grazedCycle: number;
  clump: PlanktonClump;
  offsetX: number;
  offsetY: number;
}

export interface KoiAppetite {
  target: Plankton | null;
  searchAt: number;
  biteAt: number;
  eaten: number;
  frenzyId: number;
  sprint: number;
}

export function createKoiAppetite(): KoiAppetite {
  return { target: null, searchAt: 0, biteAt: 0, eaten: 0, frenzyId: 0, sprint: 0 };
}

export interface PlanktonClump {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  phase: number;
  growthRate: number;
  initialGrowth: number;
  strands: PlanktonStrand[];
  spread: number;
  meanGrowth: number;
  biomass: number;
  population: number;
  revision: number;
}

export interface PlanktonStrand {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Persistent food, indexed separately from fish so thousands of buds stay cheap. */
export class PlanktonField {
  blooms: Plankton[] = [];
  capacity = 0;
  time = 0;
  clumps: PlanktonClump[] = [];
  frenzy = false;
  frenzyId = 0;
  ripeCount = 0;
  private nextFrenzyAt = 0;
  private width = 0;
  private height = 0;
  private cols = 0;
  private rows = 0;
  private cells: Plankton[][] = [];
  private spawnAt = 0;
  private recycle = 0;

  constructor(private density = 0) {}

  resize(width: number, height: number) {
    const first = this.width === 0;
    const sx = first ? 1 : width / this.width;
    const sy = first ? 1 : height / this.height;
    this.width = width;
    this.height = height;
    this.capacity = this.density > 0 ? clamp(Math.round(width * height * this.density / 340), 480, 6400) : 0;
    if (first && this.capacity > 0) this.seedClumps();
    else for (const clump of this.clumps) {
      clump.x *= sx;
      clump.y *= sy;
      clump.rx *= sx;
      clump.ry *= sy;
      for (const strand of clump.strands) {
        strand.ax *= sx;
        strand.bx *= sx;
        strand.ay *= sy;
        strand.by *= sy;
      }
    }
    // Retain roots and their growth history through viewport changes.
    for (const bloom of this.blooms) {
      bloom.x = clamp(bloom.x * sx, 0, width);
      bloom.y = clamp(bloom.y * sy, 0, height);
      bloom.offsetX *= sx;
      bloom.offsetY *= sy;
    }
    for (let i = this.capacity; i < this.blooms.length; i++) this.blooms[i].ripe = false;
    this.blooms.length = Math.min(this.blooms.length, this.capacity);
    this.cols = Math.max(1, Math.ceil(width / CELL));
    this.rows = Math.max(1, Math.ceil(height / CELL));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    for (const bloom of this.blooms) this.cells[this.cellOf(bloom.x, bloom.y)].push(bloom);
    if (first) {
      // An established pond on arrival, with room for new buds to keep appearing.
      const initial = Math.round(this.capacity * 0.72);
      for (let i = 0; i < initial; i++) this.spawn();
    }
  }

  step(dt: number) {
    if (dt <= 0 || this.capacity === 0) return;
    this.time += dt;
    this.ripeCount = 0;
    for (const clump of this.clumps) { clump.biomass = 0; clump.population = 0; }
    for (const bloom of this.blooms) {
      // Eaten roots keep growing, but cannot restart the same feeding frenzy.
      const cap = this.frenzy && bloom.grazedCycle === this.frenzyId ? PLANKTON_RIPE - 0.06 : 1;
      bloom.growth = Math.min(cap, bloom.growth + dt * bloom.growthRate);
      bloom.ripe = bloom.growth >= PLANKTON_RIPE;
      if (bloom.ripe) this.ripeCount++;
      bloom.clump.biomass += bloom.growth;
      bloom.clump.population++;
    }
    for (const clump of this.clumps) {
      clump.meanGrowth = clump.biomass / Math.max(1, clump.population);
      const spread = 0.42 + 0.58 * Math.sqrt(clump.meanGrowth);
      clump.spread += (spread - clump.spread) * Math.min(1, dt * 0.8);
    }
    // Growth physically extends the strands, so food and its artwork stay aligned.
    for (const cell of this.cells) cell.length = 0;
    for (const bloom of this.blooms) {
      bloom.x = clamp(bloom.clump.x + bloom.offsetX * bloom.clump.spread, 6, Math.max(6, this.width - 6));
      bloom.y = clamp(bloom.clump.y + bloom.offsetY * bloom.clump.spread, 6, Math.max(6, this.height - 6));
      this.cells[this.cellOf(bloom.x, bloom.y)].push(bloom);
    }
    if (this.frenzy && this.ripeCount === 0) this.finishFrenzy();
    if (!this.frenzy && this.time >= this.nextFrenzyAt && this.ripeCount >= Math.max(6, this.blooms.length * 0.3)) {
      this.frenzy = true;
      this.frenzyId++;
    }
    if (this.time < this.spawnAt) return;
    this.spawnAt = this.time + 0.3;
    for (let i = 0; i < 5; i++) {
      if (this.blooms.length < this.capacity) {
        this.spawn(PLANKTON_BUD);
      } else {
        // Renew old, untouched blooms at the cap; grazed roots always get to regrow.
        const index = this.recycle++ % this.blooms.length;
        const old = this.blooms[index];
        if (this.time - old.bornAt < 65 || old.growth < 1) continue;
        const cell = this.cells[this.cellOf(old.x, old.y)];
        cell.splice(cell.indexOf(old), 1);
        if (old.ripe) this.ripeCount--;
        old.clump.revision++;
        old.ripe = false; // Invalidate any koi's reference before replacing it.
        this.blooms[index] = this.newBloom(PLANKTON_BUD);
      }
    }
  }

  findRipe(x: number, y: number, radius = Math.hypot(this.width, this.height) + 120): Plankton | null {
    let best: Plankton | null = null;
    let bestScore = Infinity;
    this.visit(x, y, radius, (bloom) => {
      if (!bloom.ripe) return;
      const d2 = (bloom.x - x) ** 2 + (bloom.y - y) ** 2;
      const score = d2 / (0.5 + bloom.growth);
      if (d2 <= radius * radius && score < bestScore) {
        best = bloom;
        bestScore = score;
      }
    });
    return best;
  }

  bite(x: number, y: number, radius: number, limit: number): number {
    let eaten = 0;
    this.visit(x, y, radius, (bloom) => {
      if (eaten >= limit || !bloom.ripe || (bloom.x - x) ** 2 + (bloom.y - y) ** 2 > radius * radius) return;
      bloom.growth = PLANKTON_BUD;
      bloom.ripe = false;
      bloom.bornAt = this.time;
      bloom.grazedCycle = this.frenzyId;
      bloom.clump.revision++;
      this.ripeCount = Math.max(0, this.ripeCount - 1);
      eaten++;
    });
    if (this.frenzy && this.ripeCount === 0) this.finishFrenzy();
    return eaten;
  }

  private finishFrenzy() {
    this.frenzy = false;
    this.nextFrenzyAt = this.time + 10;
  }

  private seedClumps() {
    const count = clamp(Math.round(this.width * this.height / 170000), 3, 11);
    const radius = clamp(Math.sqrt(this.width * this.height / count) * 0.29, 42, 150);
    for (let i = 0; i < count; i++) {
      const rx = radius * rand(0.8, 1.15);
      const ry = rx * rand(0.55, 0.85);
      const margin = rx + 24;
      let x = this.width / 2, y = this.height / 2, bestGap = -Infinity;
      for (let attempt = 0; attempt < 50; attempt++) {
        const cx = rand(Math.min(margin, this.width * 0.3), Math.max(this.width - margin, this.width * 0.7));
        const cy = rand(Math.min(margin, this.height * 0.3), Math.max(this.height - margin, this.height * 0.7));
        const gap = this.clumps.reduce((nearest, other) => Math.min(nearest,
          Math.hypot(cx - other.x, cy - other.y) - rx - other.rx), Infinity);
        if (gap > bestGap) { x = cx; y = cy; bestGap = gap; }
        if (gap > 75) break;
      }
      const clump: PlanktonClump = { x, y, rx, ry, angle: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
        growthRate: 1 / rand(14, 20), initialGrowth: rand(0.12, 0.55), strands: [], spread: 0.6,
        meanGrowth: 0.3, biomass: 0, population: 0, revision: 0 };
      this.growStrands(clump);
      this.clumps.push(clump);
    }
  }

  private growStrands(clump: PlanktonClump) {
    const cosine = Math.cos(clump.angle), sine = Math.sin(clump.angle);
    const add = (ax: number, ay: number, bx: number, by: number) => {
      const distance = Math.hypot(bx, by);
      if (distance > 1) { bx /= distance; by /= distance; }
      clump.strands.push({
        ax: ax * clump.rx * cosine - ay * clump.ry * sine,
        ay: ax * clump.rx * sine + ay * clump.ry * cosine,
        bx: bx * clump.rx * cosine - by * clump.ry * sine,
        by: bx * clump.rx * sine + by * clump.ry * cosine,
      });
      return { x: bx, y: by };
    };
    const roots = randInt(5, 7);
    for (let root = 0; root < roots; root++) {
      let x = 0, y = 0;
      let heading = root / roots * Math.PI * 2 + rand(-0.3, 0.3);
      for (let joint = 0; joint < 4; joint++) {
        heading += rand(-0.4, 0.4);
        const length = rand(0.2, 0.3) * (1 - joint * 0.08);
        const end = add(x, y, x + Math.cos(heading) * length, y + Math.sin(heading) * length);
        x = end.x; y = end.y;
        if (joint === 1 || joint === 2) {
          const side = heading + (Math.random() < 0.5 ? -1 : 1) * rand(0.65, 1.15);
          const branch = rand(0.18, 0.3);
          const fork = add(x, y, x + Math.cos(side) * branch, y + Math.sin(side) * branch);
          add(fork.x, fork.y, fork.x + Math.cos(side + rand(-0.5, 0.5)) * 0.15,
            fork.y + Math.sin(side + rand(-0.5, 0.5)) * 0.15);
        }
      }
    }
  }

  private cellOf(x: number, y: number) {
    return clamp(Math.floor(y / CELL), 0, this.rows - 1) * this.cols
      + clamp(Math.floor(x / CELL), 0, this.cols - 1);
  }

  private visit(x: number, y: number, radius: number, visit: (bloom: Plankton) => void) {
    for (let row = Math.max(0, Math.floor((y - radius) / CELL)); row <= Math.min(this.rows - 1, Math.floor((y + radius) / CELL)); row++) {
      for (let col = Math.max(0, Math.floor((x - radius) / CELL)); col <= Math.min(this.cols - 1, Math.floor((x + radius) / CELL)); col++) {
        for (const bloom of this.cells[row * this.cols + col]) visit(bloom);
      }
    }
  }

  private spawn(growth?: number) {
    this.blooms.push(this.newBloom(growth));
  }

  private newBloom(growth?: number): Plankton {
    const clump = this.clumps[randInt(0, this.clumps.length - 1)];
    const strand = clump.strands[randInt(0, clump.strands.length - 1)];
    const along = Math.random();
    const dx = strand.ax + (strand.bx - strand.ax) * along + rand(-2.5, 2.5);
    const dy = strand.ay + (strand.by - strand.ay) * along + rand(-2.5, 2.5);
    const initial = growth ?? clamp(clump.initialGrowth + rand(-0.1, 0.1), PLANKTON_BUD, 1);
    const bloom: Plankton = {
      x: clamp(clump.x + dx * clump.spread, 6, Math.max(6, this.width - 6)),
      y: clamp(clump.y + dy * clump.spread, 6, Math.max(6, this.height - 6)),
      growth: initial,
      ripe: initial >= PLANKTON_RIPE,
      growthRate: clump.growthRate * rand(0.85, 1.15),
      bornAt: this.time,
      phase: rand(0, Math.PI * 2),
      variant: randInt(0, 3),
      grazedCycle: -1,
      clump,
      offsetX: dx,
      offsetY: dy,
    };
    this.cells[this.cellOf(bloom.x, bloom.y)].push(bloom);
    clump.revision++;
    return bloom;
  }
}
