/**
 * Artificial-life sim for the hero: tiny fish schools and the sharks that hunt them.
 *
 * Fish: Reynolds boids (separation / alignment / cohesion) in Couzin-style
 * zones, with a blind spot behind each fish. Alarm spreads from fish to fish
 * through the school (a "wave of agitation"), so a whole school bolts even
 * when only its edge can see the shark. Fleeing fish break sideways around the
 * shark's path, which gives the fountain effect seen in real bait balls.
 *
 * Sharks: Reynolds steering (wander + pursuit + separation) on a
 * follow-the-leader spine. Hunger builds over time and drops when they eat.
 * They prefer fish in sparse spots, since dense schools confuse predators,
 * so stragglers get picked off. Eaten fish come back later as new schools
 * swimming in from the edges, which keeps the population steady.
 */
import { angleDiff, clamp, current, hash3, rand, randInt, TAU } from "./math";
import { createKoiSpine, resetKoiSpine, steerKoi, stepKoiSpine, type KoiSpine } from "./koi-motion";
import { KOI_SPECIES, pickSpecies, SPECIES } from "./species";
import { createKoiAppetite, PlanktonField, type KoiAppetite, type PlanktonOptions } from "./plankton";

export const SHARK_NODES = 20;

export type SharkKind = "classic" | "hammerhead" | "zebra" | "tiger" | "greathammer" | "mako" | "thresher" | "nurse";

/** Which sharks to put in the water; size is relative to the biggest. */
export type SharkSpec = { kind: SharkKind; size: number };

export interface SharkPopulationOptions {
  /** Maximum active sharks; defaults to the number of supplied specs. */
  maxSharks?: number;
  /** Earliest departure in simulation seconds; unfinished feeding bouts delay rotation. Omit to disable. */
  sharkRotationInterval?: number;
  /** Completed feeding bouts required before departure; at least three. */
  sharkFeedingCycles?: number;
  /** Fish caught in each bout before a shark stops hunting. Defaults to three. */
  sharkFishPerFeeding?: number;
}

// The landing hero: four of the same shark at different depths.
const DEFAULT_SHARKS: SharkSpec[] = [
  { kind: "classic", size: 1 },
  { kind: "classic", size: 0.7 },
  { kind: "classic", size: 0.84 },
  { kind: "classic", size: 0.77 },
];

export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  /** 0 calm → 1 panicking. Spreads to neighbours. */
  alarm: number;
  alive: boolean;
  respawnAt: number;
  /** Tail-beat phase. */
  phase: number;
  /** Smoothed angular velocity (rad/s); hard turns flash silver. */
  turn: number;
  /** 0.55 far → 1 near. */
  depth: number;
  /** Rotation sense shared by a school when it mills into a bait ball. */
  millDir: 1 | -1;
  /** Koi retain body history so their tails follow the path through turns. */
  koi?: KoiSpine;
  /** Only koi graze; buds are ignored until the bloom is ripe. */
  appetite?: KoiAppetite;
}

export interface Shark {
  id: number;
  kind: SharkKind;
  length: number;
  /** Spine positions, snout first: [x0, y0, x1, y1, ...]. */
  nodes: Float32Array;
  heading: number;
  speed: number;
  /** Tail-beat phase; drives the body wave in the renderer. */
  phase: number;
  /** Smoothed angular velocity (rad/s); the shark banks its fins into turns. */
  turn: number;
  hunger: number;
  feeding: "resting" | "hunting";
  /** Completed bouts and catches in the current bout belong to this appearance. */
  feedingCycles: number;
  fishEaten: number;
  nextHungerAt: number;
  lungeUntil: number;
  nextLungeAt: number;
  wander: number;
  orbitDir: 1 | -1;
  orbitRadius: number;
  target: Fish | null;
  retargetAt: number;
  /** 0 far / dim → 1 near / bright. */
  depth: number;
  /** Rotation keeps the same bodies alive until they have completely left the frame. */
  transition: "entering" | "swimming" | "exiting";
  /** Eased sprint effort, shared by movement and the animated body wave. */
  sprint: number;
}

export interface WorldEvent {
  kind: "eat" | "splash";
  x: number;
  y: number;
}

const FISH_SEPARATION_K = 420;
const FISH_ALIGN_K = 1.4;
const FISH_COHESION_K = 1;
const FISH_FLEE_K = 1100;
const SHARK_CHASE_COOLDOWN = 7;
const BLIND_COS = -0.6; // ~127° either side of the heading is visible

export class World {
  width = 0;
  height = 0;
  time = 0;
  fish: Fish[] = [];
  sharks: Shark[] = [];
  events: WorldEvent[] = [];
  pointer = { x: 0, y: 0, active: false };
  readonly plankton: PlanktonField;

  /** Fish neighbourhood radius; the spatial hash bucket size matches it. */
  private perception = 60;
  /** Per-species personal space in px (x, y). */
  private sepX: number[] = [];
  private sepY: number[] = [];
  private foreignSep = 40;
  private bucketCols = 0;
  private bucketRows = 0;
  private bucketHead = new Int32Array(0);
  private bucketCount = new Uint16Array(0);
  private bucketNext = new Int32Array(0);
  private lastSpawn = 0;
  private nextSharkSpec = 0;
  private nextSharkRotation = Infinity;
  private tmp = { x: 0, y: 0 };

  /** fishCount overrides the area-based population (the sidebar wants a single small school). */
  constructor(
    private sharkSpecs: SharkSpec[] = DEFAULT_SHARKS,
    private fishCount?: number,
    private koiCount = 0,
    private sharkOptions: SharkPopulationOptions & PlanktonOptions = {},
  ) {
    this.plankton = new PlanktonField(sharkOptions.planktonDensity);
  }

  resize(width: number, height: number, cellW: number, cellH: number) {
    const first = this.width === 0;
    const scaleX = first ? 1 : width / this.width;
    const scaleY = first ? 1 : height / this.height;
    const lengthScale = first ? 1 : clamp(Math.min(width, height) * 0.44, 170, 430)
      / clamp(Math.min(this.width, this.height) * 0.44, 170, 430);
    const orbitScale = first ? 1 : Math.min(width, height) / Math.min(this.width, this.height);
    this.width = width;
    this.height = height;
    // Spacing is set in grid cells so every fish lands in its own cell.
    this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
    this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
    this.perception = Math.max(cellH * 3, cellW * 5.5);
    this.foreignSep = cellW * 3;
    this.plankton.resize(width, height);

    if (first || this.fish.length === 0) {
      this.seed();
      return;
    }
    for (const f of this.fish) {
      f.x = clamp(f.x * scaleX, 0, width);
      f.y = clamp(f.y * scaleY, 0, height);
      if (f.koi) resetKoiSpine(f.koi, f.x, f.y, Math.atan2(f.vy, f.vx));
    }
    for (const shark of this.sharks) {
      shark.length *= lengthScale;
      shark.orbitRadius *= orbitScale;
      for (let i = 0; i < shark.nodes.length; i += 2) {
        shark.nodes[i] *= scaleX;
        shark.nodes[i + 1] *= scaleY;
      }
    }
  }

  seed() {
    const { width: W, height: H } = this;
    this.nextSharkSpec = 0;
    this.spawnSharks();

    const total = (this.fishCount ?? clamp(Math.round((W * H) / 4400), 85, 340)) + this.koiCount;
    this.fish = [];
    while (this.fish.length < total) {
      const spawningKoi = this.fish.length < this.koiCount;
      const species = spawningKoi ? KOI_SPECIES : pickSpecies();
      const sp = SPECIES[species];
      const remaining = (spawningKoi ? this.koiCount : total) - this.fish.length;
      const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), remaining);
      const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const cx = rand(W * 0.06, W * 0.94);
      const cy = rand(H * 0.08, H * 0.92);
      // Mostly level headings: fish cruise sideways far more than up or down.
      const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
      for (let k = 0; k < size; k++) {
        this.fish.push({
          x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
          y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
          vx: Math.cos(dir) * sp.cruise,
          vy: Math.sin(dir) * sp.cruise,
          species,
          alarm: 0,
          alive: true,
          respawnAt: 0,
          phase: rand(0, TAU),
          turn: 0,
          depth: rand(0.55, 1),
          millDir,
        });
        if (species === KOI_SPECIES) {
          const index = this.fish.length - 1;
          const fish = this.fish[index];
          const scale = (0.8 + fish.depth * 0.35) * (0.85 + hash3(index, 0, 23) * 0.3);
          fish.koi = createKoiSpine(fish.x, fish.y, dir, scale);
          if (this.plankton.capacity > 0) fish.appetite = createKoiAppetite();
        }
      }
    }
    this.bucketNext = new Int32Array(this.fish.length);
  }

  private spawnSharks(fromEdges = false) {
    const { width: W, height: H } = this;
    const minSide = Math.min(W, H);
    const baseLength = clamp(minSide * 0.44, 170, 430);
    const sharkCount = clamp(Math.round(this.sharkOptions.maxSharks ?? this.sharkSpecs.length), 0, this.sharkSpecs.length);
    // Rotate the whole group around the page while keeping its sharks spaced apart.
    const spawnAngle = rand(0, TAU);

    this.sharks = [];
    for (let i = 0; i < sharkCount; i++) {
      const { kind, size } = this.sharkSpecs[this.nextSharkSpec];
      this.nextSharkSpec = (this.nextSharkSpec + 1) % this.sharkSpecs.length;
      const length = baseLength * size;
      const orbitRadius = minSide * rand(0.28, 0.4);
      const a = spawnAngle + (i / sharkCount) * TAU + rand(-0.4, 0.4);
      const orbitDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      let x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
      let y = H / 2 + Math.sin(a) * orbitRadius;
      let heading = a + (orbitDir * Math.PI) / 2 + rand(-Math.PI / 6, Math.PI / 6);
      if (fromEdges) {
        // Opposite/random edges keep arrivals varied, with the entire body hidden.
        const side = (Math.floor(spawnAngle / TAU * 4) + Math.floor(i * 4 / sharkCount)) % 4;
        const margin = length * 0.6 + 12;
        x = side === 0 ? -margin : side === 1 ? W + margin : rand(W * 0.18, W * 0.82);
        y = side === 2 ? -margin : side === 3 ? H + margin : rand(H * 0.18, H * 0.82);
        heading = Math.atan2(rand(H * 0.3, H * 0.7) - y, rand(W * 0.3, W * 0.7) - x);
      }
      const nodes = new Float32Array(SHARK_NODES * 2);
      const seg = length / (SHARK_NODES - 1);
      for (let n = 0; n < SHARK_NODES; n++) {
        nodes[n * 2] = x - Math.cos(heading) * seg * n;
        nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
      }
      this.sharks.push({
        id: i + 1,
        kind,
        length,
        nodes,
        heading,
        speed: 30,
        phase: rand(0, TAU),
        turn: 0,
        hunger: 0,
        feeding: "resting",
        feedingCycles: 0,
        fishEaten: 0,
        nextHungerAt: this.time + rand(1.5, 3),
        lungeUntil: 0,
        nextLungeAt: 0,
        wander: 0,
        orbitDir,
        orbitRadius,
        target: null,
        retargetAt: 0,
        depth: size,
        transition: fromEdges ? "entering" : "swimming",
        sprint: 0,
      });
    }
    // Smaller (farther) sharks draw first so the big one swims over them.
    this.sharks.sort((a, b) => a.length - b.length);

    const interval = this.sharkOptions.sharkRotationInterval ?? 0;
    this.nextSharkRotation = interval > 0 && sharkCount > 0 && sharkCount < this.sharkSpecs.length
      ? this.time + interval
      : Infinity;
  }

  splash(x: number, y: number) {
    this.events.push({ kind: "splash", x, y });
    const r = 240;
    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 1e-3) continue;
      // Flash expansion: everybody nearby bolts straight out.
      const k = (1 - d / r) * 260;
      f.vx += (dx / d) * k;
      f.vy += (dy / d) * k;
      f.alarm = 1;
    }
  }

  step(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    this.plankton.step(dt);
    const feedingCycles = Math.max(3, Math.round(this.sharkOptions.sharkFeedingCycles ?? 3));
    // A deadline never cancels a meal. Empty worlds can still rotate normally.
    const readyToLeave = this.fish.length === 0 || this.sharks.every((shark) =>
      shark.feedingCycles >= feedingCycles && shark.feeding === "resting");
    if (this.time >= this.nextSharkRotation && readyToLeave) {
      for (const shark of this.sharks) {
        shark.transition = "exiting";
        shark.target = null;
      }
      this.nextSharkRotation = Infinity;
    }
    this.rebuildHash();
    this.stepFish(dt);
    this.stepSharks(dt);
    // Never replace a visible body. Wait for both tails and fins to clear the edge.
    if (this.sharks.some((shark) => shark.transition === "exiting")) {
      this.sharks = this.sharks.filter((shark) => !this.hasSharkExited(shark));
      if (this.sharks.length === 0) this.spawnSharks(true);
    }
    this.respawn();
  }

  private hasSharkExited(shark: Shark) {
    if (shark.transition !== "exiting") return false;
    const margin = shark.length * 0.6 + 12;
    let left = true, right = true, above = true, below = true;
    for (let i = 0; i < shark.nodes.length; i += 2) {
      left &&= shark.nodes[i] < -margin;
      right &&= shark.nodes[i] > this.width + margin;
      above &&= shark.nodes[i + 1] < -margin;
      below &&= shark.nodes[i + 1] > this.height + margin;
    }
    return left || right || above || below;
  }

  private rebuildHash() {
    const size = this.perception;
    const pad = 2;
    this.bucketCols = Math.ceil(this.width / size) + pad * 2;
    this.bucketRows = Math.ceil(this.height / size) + pad * 2;
    const n = this.bucketCols * this.bucketRows;
    if (this.bucketHead.length !== n) {
      this.bucketHead = new Int32Array(n);
      this.bucketCount = new Uint16Array(n);
    }
    this.bucketHead.fill(-1);
    this.bucketCount.fill(0);
    if (this.bucketNext.length !== this.fish.length) {
      this.bucketNext = new Int32Array(this.fish.length);
    }
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      if (!f.alive) continue;
      const b = this.bucketOf(f.x, f.y);
      this.bucketNext[i] = this.bucketHead[b];
      this.bucketHead[b] = i;
      this.bucketCount[b]++;
    }
  }

  private bucketOf(x: number, y: number) {
    const size = this.perception;
    const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
    const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
    return r * this.bucketCols + c;
  }

  private stepFish(dt: number) {
    const { fish, sharks, pointer, width: W, height: H, time } = this;
    const R = this.perception;
    const R2 = R * R;
    const foreignSep = this.foreignSep;
    const size = this.perception;
    const cols = this.bucketCols;
    const rows = this.bucketRows;
    const head = this.bucketHead;
    const next = this.bucketNext;
    const cur = this.tmp;
    const calmDecay = Math.exp(-dt * 0.7);
    const contagion = Math.min(1, dt * 6);

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      if (!f.alive) continue;
      const sp = SPECIES[f.species];
      // Alarmed fish want more room: the school flashes apart around a
      // shark and closes back up once the threat fades.
      const spread = 1 + 1.8 * f.alarm;
      const sepX = this.sepX[f.species] * spread;
      const sepY = this.sepY[f.species] * spread;

      const speed = Math.hypot(f.vx, f.vy) || 1;
      const hx = f.vx / speed;
      const hy = f.vy / speed;

      let ax = 0;
      let ay = 0;
      let sx = 0;
      let sy = 0;
      let avx = 0;
      let avy = 0;
      let cx = 0;
      let cy = 0;
      let n = 0;
      let neighbourAlarm = 0;

      const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
      const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
      for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
        for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
          let j = head[r * cols + c];
          while (j !== -1) {
            if (j !== i) {
              const o = fish[j];
              const dx = o.x - f.x;
              const dy = o.y - f.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < R2 && d2 > 1e-6) {
                const d = Math.sqrt(d2);
                // Blind zone directly behind the fish.
                if ((dx * hx + dy * hy) / d > BLIND_COS) {
                  // Elliptical personal space: wide along x, tight along y.
                  const qx = dx / sepX;
                  const qy = dy / sepY;
                  const q2 = qx * qx + qy * qy;
                  if (q2 < 1) {
                    const q = Math.sqrt(q2) || 1e-3;
                    const k = (1 - q) / q;
                    sx -= qx * k;
                    sy -= qy * k;
                  }
                  if (o.species === f.species) {
                    avx += o.vx;
                    avy += o.vy;
                    cx += dx;
                    cy += dy;
                    n++;
                  } else if (d < foreignSep) {
                    // Different species keep their own schools.
                    const k = ((1 - d / foreignSep) / d) * 0.6;
                    sx -= dx * k;
                    sy -= dy * k;
                  }
                  if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                }
              }
            }
            j = next[j];
          }
        }
      }

      const joiningFrenzy = !!f.appetite && this.plankton.frenzy && f.alarm < 0.35;
      const separation = FISH_SEPARATION_K * (joiningFrenzy ? 0.18 : 1);
      ax += sx * separation;
      ay += sy * separation;
      if (n > 0) {
        const grazingWeight = joiningFrenzy ? 0.08 : 1;
        const alignK = FISH_ALIGN_K * sp.align * (1 - 0.7 * f.alarm) * grazingWeight;
        const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm) * grazingWeight;
        ax += (avx / n - f.vx) * alignK + (cx / n) * cohesionK;
        ay += (avy / n - f.vy) * alignK + (cy / n) * cohesionK;
        if (sp.mill > 0) {
          // Circle the local centre: the school spins into a bait ball.
          const cl = Math.hypot(cx, cy) || 1;
          ax += (-cy / cl) * f.millDir * sp.mill * (1 - f.alarm);
          ay += (cx / cl) * f.millDir * sp.mill * (1 - f.alarm);
        }
      }

      // Predators. Distance is measured to the nearest point along the front
      // half of the shark, so fish also give the flanks a wide berth.
      let fear = 0;
      for (const sh of sharks) {
        const hunted = sh.transition === "swimming" && sh.feeding === "hunting";
        const targeted = hunted && sh.target === f;
        const fearR = (sh.length * 0.6 + 60) * (hunted ? 1.35 : 1);
        let best = Infinity;
        let bx = 0;
        let by = 0;
        for (let k = 0; k <= 12; k += 3) {
          const nx = sh.nodes[k * 2];
          const ny = sh.nodes[k * 2 + 1];
          const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
          if (d2 < best) {
            best = d2;
            bx = nx;
            by = ny;
          }
        }
        const d = Math.sqrt(best);
        if (d >= fearR || d < 1e-3) continue;
        let w = 1 - d / fearR;
        w *= w;
        const awayX = (f.x - bx) / d;
        const awayY = (f.y - by) / d;
        // Fountain effect: break to whichever side of the shark's path you're on.
        const shx = Math.cos(sh.heading);
        const shy = Math.sin(sh.heading);
        let side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
        // Break toward open water instead of repeatedly sprinting into a corner.
        const escapeX = f.x + (awayX * 0.7 - shy * side * 0.9) * 100;
        const escapeY = f.y + (awayY * 0.7 + shx * side * 0.9) * 100;
        const otherX = f.x + (awayX * 0.7 + shy * side * 0.9) * 100;
        const otherY = f.y + (awayY * 0.7 - shx * side * 0.9) * 100;
        const room = Math.min(escapeX, W - escapeX, escapeY, H - escapeY);
        if (room < 24 && Math.min(otherX, W - otherX, otherY, H - otherY) > room + 24) side *= -1;
        const effort = FISH_FLEE_K * (hunted ? 1.6 : 1) * (targeted ? Math.max(0.16, w) : w);
        ax += (awayX * 0.7 - shy * side * 0.9) * effort;
        ay += (awayY * 0.7 + shx * side * 0.9) * effort;
        fear = Math.max(fear, hunted && (targeted || d < fearR * 0.65) ? 1 : Math.sqrt(w));
      }

      if (pointer.active) {
        const pr = 130;
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < pr && d > 1e-3) {
          const w = (1 - d / pr) ** 2;
          ax += (dx / d) * FISH_FLEE_K * w;
          ay += (dy / d) * FISH_FLEE_K * w;
          fear = Math.max(fear, Math.sqrt(w) * 0.8);
        }
      }

      // Alarm: direct threat sets it, neighbours pass it along (slightly
      // weaker each hop), and it fades on its own.
      let alarm = Math.max(f.alarm * calmDecay, fear);
      const relayed = neighbourAlarm * 0.86;
      if (relayed > alarm) alarm += (relayed - alarm) * contagion;
      f.alarm = alarm;

      // The whole school shares one feeding frenzy, ending only when food is cleared.
      const appetite = f.appetite;
      let foraging = false;
      if (appetite) appetite.sprint += ((this.plankton.frenzy && alarm < 0.35 ? 1 : 0) - appetite.sprint) * Math.min(1, dt * 4);
      if (appetite && alarm < 0.35 && this.plankton.frenzy) {
        if (appetite.frenzyId !== this.plankton.frenzyId) {
          appetite.frenzyId = this.plankton.frenzyId;
          appetite.target = null;
          appetite.searchAt = 0;
        }
        if (appetite.target && !appetite.target.ripe) {
          appetite.target = null;
          appetite.searchAt = 0;
        }
        if (time >= appetite.searchAt) {
          appetite.target = this.plankton.findRipe(f.x, f.y);
          appetite.searchAt = time + rand(0.35, 0.65);
        }
        if (appetite.target) {
          const dx = appetite.target.x - f.x;
          const dy = appetite.target.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const approach = Math.min(sp.cruise * 6.8, Math.max(24, d * 2.4));
          ax += (dx / d * approach - f.vx) * 10;
          ay += (dy / d * approach - f.vy) * 10;
          foraging = true;
        }
      } else if (appetite) {
        appetite.target = null;
      }

      // Soft walls.
      const m = 36;
      if (f.x < m) ax += (m - f.x) * 7;
      else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
      if (f.y < m) ay += (m - f.y) * 7;
      else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;

      // Ambient current and a little individual restlessness.
      current(f.x, f.y, time, cur);
      ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
      ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
      // Swim level, except when bolting from danger.
      ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);

      // Relax toward a preferred speed that rises with panic.
      const preferred = sp.cruise * (1 + 2.4 * f.alarm) * (foraging ? 4.6 : 1);
      const acceleration = 1.6 + fear * 2;
      ax += (preferred - speed) * hx * acceleration;
      ay += (preferred - speed) * hy * acceleration;

      const before = f.koi?.heading ?? Math.atan2(f.vy, f.vx);
      f.vx += ax * dt;
      f.vy += ay * dt;
      const maxSpeed = sp.maxSpeed * (1 + Math.max(1.8 * f.alarm, (appetite?.sprint ?? 0) * 2.4));
      const s = Math.hypot(f.vx, f.vy);
      if (s > maxSpeed) {
        f.vx *= maxSpeed / s;
        f.vy *= maxSpeed / s;
      } else if (s < sp.minSpeed && s > 1e-3) {
        f.vx *= sp.minSpeed / s;
        f.vy *= sp.minSpeed / s;
      }
      if (f.koi) {
        const speed = Math.hypot(f.vx, f.vy);
        const heading = steerKoi(f.koi, Math.atan2(f.vy, f.vx), speed, dt);
        f.vx = Math.cos(heading) * speed;
        f.vy = Math.sin(heading) * speed;
      }
      f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
      f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12) * (1 + (appetite?.sprint ?? 0) * 1.1);
      f.x = clamp(f.x + f.vx * dt, -60, W + 60);
      f.y = clamp(f.y + f.vy * dt, -60, H + 60);
      if (f.koi) stepKoiSpine(f.koi, f.x, f.y, Math.atan2(f.vy, f.vx));
      if (appetite && foraging && time >= appetite.biteAt) {
        const eaten = this.plankton.bite(f.x, f.y, Math.max(20, f.koi!.length), 8);
        if (eaten > 0) {
          appetite.eaten += eaten;
          appetite.biteAt = time + rand(0.1, 0.16);
        }
      }
    }
  }

  private stepSharks(dt: number) {
    const { sharks, width: W, height: H, time } = this;
    const minSide = Math.min(W, H);
    const cxW = W / 2;
    const cyW = H / 2;

    for (const sh of sharks) {
      const L = sh.length;
      const nodes = sh.nodes;
      const hx = nodes[0];
      const hy = nodes[1];

      const entryMargin = minSide * 0.16;
      if (sh.transition === "entering" && hx > entryMargin && hx < W - entryMargin
        && hy > entryMargin && hy < H - entryMargin) {
        sh.transition = "swimming";
      }
      const requiredCycles = Math.max(3, Math.round(this.sharkOptions.sharkFeedingCycles ?? 3));
      const catchesPerMeal = Math.max(1, Math.round(this.sharkOptions.sharkFishPerFeeding ?? 3));
      // After fulfilling its visit, a shark rests while the other finishes, so
      // staggered appetites cannot indefinitely postpone the group's departure.
      const finishedVisit = Number.isFinite(this.nextSharkRotation) && sh.feedingCycles >= requiredCycles;
      if (sh.transition === "swimming" && sh.feeding === "resting" && !finishedVisit && this.fish.length > 0) {
        sh.hunger = clamp(1 - (sh.nextHungerAt - time) / SHARK_CHASE_COOLDOWN, 0, 1);
        if (time >= sh.nextHungerAt) {
          sh.feeding = "hunting";
          sh.fishEaten = 0;
          sh.hunger = 1;
          sh.retargetAt = 0;
        }
      }
      const hunting = sh.transition === "swimming" && sh.feeding === "hunting";
      let closing = 0;

      if (sh.transition === "swimming") {
        // Momentum.
        let dx = Math.cos(sh.heading);
        let dy = Math.sin(sh.heading);

        // Wander: a slowly drifting offset on a circle ahead of the snout.
        sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
        dx += Math.cos(sh.heading + sh.wander) * (hunting ? 0.1 : 0.45);
        dy += Math.sin(sh.heading + sh.wander) * (hunting ? 0.1 : 0.45);

        // Hunt.
        if (hunting && (!sh.target?.alive || time >= sh.retargetAt && time >= sh.lungeUntil)) {
          sh.target = this.findPrey(sh);
          sh.retargetAt = time + 0.35;
        }
        const t = sh.target;
        if (hunting && t && t.alive) {
          // Pursuit: aim at where the fish is about to be.
          const distance = Math.hypot(t.x - hx, t.y - hy);
          const lead = clamp(distance / Math.max(sh.speed, 100), 0.08, 0.5);
          const tx = t.x + t.vx * lead - hx;
          const ty = t.y + t.vy * lead - hy;
          const d = Math.hypot(tx, ty) || 1;
          const w = 6;
          dx += (tx / d) * w;
          dy += (ty / d) * w;
          closing = clamp(1 - d / (L * 0.9), 0, 1);
          if (time >= sh.nextLungeAt && distance < L * 0.7 + 60
            && Math.abs(angleDiff(sh.heading, Math.atan2(ty, tx))) < 0.55) {
            sh.lungeUntil = time + 0.65;
            sh.nextLungeAt = time + 1.35;
          }
        } else {
          // Patrol: a lazy circuit around the headline.
          const rx = (hx - cxW) / (W / minSide);
          const ry = hy - cyW;
          const r = Math.hypot(rx, ry) || 1;
          const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
          const radial = clamp((radius - r) / radius, -1, 1);
          dx += ((-ry / r) * sh.orbitDir + (rx / r) * radial * 0.9) * 0.55;
          dy += ((rx / r) * sh.orbitDir + (ry / r) * radial * 0.9) * 0.55;
        }

        // Give other sharks room.
        for (const other of sharks) {
          if (other === sh) continue;
          for (let k = 0; k < SHARK_NODES; k += 4) {
            const ox = hx - other.nodes[k * 2];
            const oy = hy - other.nodes[k * 2 + 1];
            const d = Math.hypot(ox, oy);
            const range = (L + other.length) * 0.45;
            if (d < range && d > 1e-3) {
              const w = (1 - d / range) * (hunting ? 1 : 3);
              dx += (ox / d) * w;
              dy += (oy / d) * w;
            }
          }
        }

        // Keep the headline mostly clear: a soft elliptical no-swim zone.
        const ex = (hx - cxW) / (W * 0.3);
        const ey = (hy - cyW) / (H * 0.16);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1 - e) * (hunting ? 0.25 : 2.5);
          dx += (ex / e) * w;
          dy += (ey / e) * w;
        }

        // Turn back once the snout leaves the frame, so bodies dip off-screen
        // now and then but the sharks never wander away for good.
        const over = Math.max(-hx, hx - W, -hy, hy - H);
        if (over > -L * 0.05) {
          const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * (hunting ? 2 : 3.5);
          const toX = cxW - hx;
          const toY = cyW - hy;
          const d = Math.hypot(toX, toY) || 1;
          dx += (toX / d) * w;
          dy += (toY / d) * w;
        }

        const desired = Math.atan2(dy, dx);
        // Sharks can't pivot on the spot: the turning circle grows with speed.
        const agility = Math.min(hunting ? 3 + closing : 0.8, sh.speed / (L * (hunting ? 0.14 : 0.22)));
        const maxTurn = agility * dt;
        const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
        sh.heading += turned;
        sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);
      } else {
        // Arrivals travel inward; departures hold their current course through the edge.
        // Hunting, patrol, and the boundary's turn-back force must not pull them back.
        sh.turn *= Math.exp(-dt * 3);
      }

      const cruise = 30 + L * 0.04;
      const exiting = sh.transition === "exiting";
      const lunging = hunting && time < sh.lungeUntil;
      sh.sprint += ((exiting || hunting ? 1 : 0) - sh.sprint) * Math.min(1, dt * 2.5);
      const targetSpeed = exiting ? cruise * 3.6 : hunting ? cruise * (lunging ? 6.2 : 4.2) : cruise;
      sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * (lunging ? 7 : hunting ? 3 : exiting ? 1.8 : 1.1));
      sh.phase += dt * (2 + sh.speed / 24) * (1 + sh.sprint * 0.45);

      nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
      nodes[1] += Math.sin(sh.heading) * sh.speed * dt;

      // Follow-the-leader spine, with a stiffness limit per joint so the
      // body bends into a C at most and never folds back on itself.
      const seg = L / (SHARK_NODES - 1);
      const maxBend = 0.16;
      let prevAngle = sh.heading + Math.PI;
      for (let k = 1; k < SHARK_NODES; k++) {
        const px = nodes[(k - 1) * 2];
        const py = nodes[(k - 1) * 2 + 1];
        let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
        angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
        nodes[k * 2] = px + Math.cos(angle) * seg;
        nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
        prevAngle = angle;
      }

      // Feed.
      if (hunting) {
        const mouthR = L * 0.05 + 8;
        const mx = nodes[0];
        const my = nodes[1];
        const moveX = mx - hx;
        const moveY = my - hy;
        const moved2 = moveX * moveX + moveY * moveY;
        for (const f of this.fish) {
          if (!f.alive) continue;
          // Sweep the snout's path so a fast lunge cannot skip over a fish.
          const along = moved2 > 0 ? clamp(((f.x - hx) * moveX + (f.y - hy) * moveY) / moved2, 0, 1) : 0;
          if ((f.x - hx - moveX * along) ** 2 + (f.y - hy - moveY * along) ** 2 < mouthR * mouthR) {
            f.alive = false;
            f.respawnAt = time + rand(3, 8);
            sh.fishEaten++;
            // Partial meals never turn off sprinting or targeting.
            sh.hunger = Math.max(0.35, 1 - sh.fishEaten / catchesPerMeal);
            this.events.push({ kind: "eat", x: f.x, y: f.y });
            if (sh.fishEaten >= catchesPerMeal) {
              sh.feedingCycles++;
              sh.feeding = "resting";
              sh.hunger = 0;
              sh.target = null;
              sh.lungeUntil = 0;
              sh.nextHungerAt = time + SHARK_CHASE_COOLDOWN;
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Prefer close, forward stragglers, but search the whole world so losing
   * sight of a school or having fish behind the shark never ends a hunt.
   */
  private findPrey(sh: Shark): Fish | null {
    const hx = sh.nodes[0];
    const hy = sh.nodes[1];
    const fx = Math.cos(sh.heading);
    const fy = Math.sin(sh.heading);
    let best: Fish | null = null;
    let bestScore = Infinity;
    let currentScore = Infinity;

    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - hx;
      const dy = f.y - hy;
      const d = Math.hypot(dx, dy);
      const cos = d > 1e-3 ? (dx * fx + dy * fy) / d : 1;
      const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];
      const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
      if (f === sh.target) currentScore = score;
    }
    // Stick with the current target unless something is clearly better.
    if (sh.target && currentScore < bestScore * 1.3) return sh.target;
    return best;
  }

  private respawn() {
    const { time, width: W, height: H } = this;
    const due: Fish[] = [];
    for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
    if (due.length === 0) return;
    if (due.length < 6 && time - this.lastSpawn < 9) return;
    this.lastSpawn = time;

    // A new school swims in from a random edge.
    const side = randInt(0, 3);
    const along = rand(0.15, 0.85);
    const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
    const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
    const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
    const species = pickSpecies();
    const sp = SPECIES[species];
    const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    for (const f of due.slice(0, sp.schoolSize[1])) {
      const nextSpecies = f.species === KOI_SPECIES ? KOI_SPECIES : species;
      const nextSpec = SPECIES[nextSpecies];
      f.alive = true;
      f.species = nextSpecies;
      f.alarm = 0;
      f.turn = 0;
      f.millDir = millDir;
      f.x = x + rand(-1, 1) * this.perception;
      f.y = y + rand(-1, 1) * this.perception;
      f.vx = Math.cos(inward) * nextSpec.cruise * 1.4;
      f.vy = Math.sin(inward) * nextSpec.cruise * 1.4;
      if (f.koi) resetKoiSpine(f.koi, f.x, f.y, inward);
      if (f.appetite) Object.assign(f.appetite, createKoiAppetite());
    }
  }
}
