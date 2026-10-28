import assert from "node:assert/strict";
import test from "node:test";
import { PlanktonField, PLANKTON_BUD, PLANKTON_RIPE } from "../vendor/ascii-sharks/src/plankton.ts";
import { World } from "../vendor/ascii-sharks/src/world.ts";
import { resetKoiSpine } from "../vendor/ascii-sharks/src/koi-motion.ts";

const STEP = 1 / 120;

function seedRandom(t, seed = 42) {
  const original = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  t.after(() => { Math.random = original; });
}

function advance(world, seconds) {
  for (let i = 0; i < seconds / STEP; i++) {
    world.step(STEP);
    if (world.events) world.events.length = 0;
  }
}

test("dense clumps keep spawning buds and have a bounded population", (t) => {
  seedRandom(t);
  const field = new PlanktonField(1);
  field.resize(1440, 900);
  const initial = field.blooms.length;
  assert.ok(initial > 2400, "clumps should hold a dense food population");
  field.step(STEP);
  assert.ok(field.blooms.length > initial);
  assert.ok(field.blooms.slice(initial).every((bloom) => bloom.growth === PLANKTON_BUD && !bloom.ripe));
  advance(field, 120);
  assert.equal(field.blooms.length, field.capacity);
  assert.ok(field.blooms.some((bloom) => bloom.bornAt > 90), "fresh plankton must still appear after reaching the cap");
});

test("koi cannot eat growing buds; a ripe bloom survives a bite as a root and regrows", (t) => {
  seedRandom(t);
  const field = new PlanktonField(1);
  field.resize(390, 844);
  for (const bloom of field.blooms) { bloom.growth = PLANKTON_BUD; bloom.ripe = false; }
  const root = field.blooms[0];
  assert.equal(field.findRipe(root.x, root.y), null);
  assert.equal(field.bite(root.x, root.y, 1, 1), 0);
  advance(field, 22);
  assert.ok(root.growth >= PLANKTON_RIPE && root.ripe);
  assert.equal(field.bite(root.x, root.y, 1, 1), 1);
  assert.equal(root.growth, PLANKTON_BUD);
  assert.equal(root.ripe, false);
  assert.ok(field.blooms.includes(root));
  assert.equal(field.bite(root.x, root.y, 1, 1), 0, "the same bud must not be eaten twice");
  field.bite(195, 422, 1000, Infinity);
  advance(field, 22);
  assert.ok(root.ripe, "the root should become food again");
});

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`plankton occupies scattered compact clumps with open water at ${width}x${height}`, (t) => {
    seedRandom(t);
    const field = new PlanktonField(1);
    field.resize(width, height);
    advance(field, 30);
    assert.ok(field.clumps.length >= 3 && field.clumps.length <= 11);
    const occupied = new Set(field.blooms.map(bloom => `${Math.floor(bloom.x / 32)},${Math.floor(bloom.y / 32)}`));
    const coverage = occupied.size / (Math.ceil(width / 32) * Math.ceil(height / 32));
    assert.ok(coverage < 0.22, `clumps cover ${(coverage * 100).toFixed(1)}% of the screen`);
    assert.ok(field.blooms.every(bloom => field.clumps.some(clump =>
      Math.hypot(bloom.x - clump.x, bloom.y - clump.y) <= Math.max(clump.rx, clump.ry) + 1)));
    const positions = field.clumps.map(clump => `${clump.x.toFixed(1)},${clump.y.toFixed(1)}`);
    const other = new PlanktonField(1);
    other.resize(width, height);
    assert.notDeepEqual(other.clumps.map(clump => `${clump.x.toFixed(1)},${clump.y.toFixed(1)}`), positions);
  });
}

test("every koi sprints toward distant food and keeps feeding until all food is cleared", (t) => {
  seedRandom(t);
  const world = new World([], 0, 12, { planktonDensity: 1 });
  world.resize(1440, 900, 10, 15);
  const clump = world.plankton.clumps[0];
  Object.assign(clump, { x: 1100, y: 450 });
  for (let i = 0; i < world.plankton.blooms.length; i++) {
    Object.assign(world.plankton.blooms[i], { x: 1100 + Math.cos(i) * (i % 40), y: 450 + Math.sin(i) * (i % 40),
      offsetX: Math.cos(i) * (i % 40), offsetY: Math.sin(i) * (i % 40), clump, growth: 1, ripe: true, growthRate: 0 });
  }
  world.plankton.resize(1440, 900); // Reindex the isolated test feeding clump.
  world.plankton.capacity = world.plankton.blooms.length;
  for (let i = 0; i < world.fish.length; i++) {
    const koi = world.fish[i];
    Object.assign(koi, { x: 60, y: 390 + i * 10, vx: 26, vy: 0, alarm: 0 });
    resetKoiSpine(koi.koi, koi.x, koi.y, 0);
  }
  advance(world, 2);
  assert.ok(world.plankton.frenzy);
  assert.ok(world.fish.every(koi => koi.appetite.target?.ripe && koi.appetite.sprint > 0.99));
  assert.ok(world.fish.every(koi => Math.hypot(koi.vx, koi.vy) > 130), "the entire school should sprint substantially faster");
  for (let frame = 0; frame < 90 * 120 && world.plankton.frenzy; frame++) world.step(STEP);
  assert.equal(world.plankton.frenzy, false, "the school must clear the last food, not circle forever");
  assert.equal(world.plankton.ripeCount, 0);
  assert.ok(world.plankton.blooms.every(bloom => !bloom.ripe && bloom.growth < PLANKTON_RIPE));
  assert.ok(world.fish.every(koi => koi.appetite.eaten > 0), "all koi should join the meal");
  assert.ok(world.fish.some(koi => koi.appetite.eaten > 20), "individual quotas must not end a frenzy");
  // Even a fully ripe crop must wait through the ten-second shared cooldown.
  for (const bloom of world.plankton.blooms) { bloom.growth = 1; bloom.ripe = true; }
  advance(world, 9.5);
  assert.equal(world.plankton.frenzy, false);
  assert.ok(world.fish.every(koi => koi.appetite.target === null));
  advance(world, 0.6);
  assert.ok(world.plankton.frenzy, "the next frenzy should start after the ten-second cooldown");
});

test("dense colonies follow branching strands that extend as the clumps grow", (t) => {
  seedRandom(t);
  const field = new PlanktonField(1);
  field.resize(1440, 900);
  const spread = field.clumps.map(clump => clump.spread);
  advance(field, 15);
  assert.ok(field.clumps.every((clump, i) => clump.spread > spread[i] * 1.3), "roots should visibly expand outward");
  assert.ok(field.clumps.every(clump => clump.strands.length >= 30));
  for (const bloom of field.blooms) {
    const clump = bloom.clump;
    const nearStrand = clump.strands.some(strand => {
      const ax = clump.x + strand.ax * clump.spread;
      const ay = clump.y + strand.ay * clump.spread;
      const dx = (strand.bx - strand.ax) * clump.spread;
      const dy = (strand.by - strand.ay) * clump.spread;
      const along = Math.max(0, Math.min(1, ((bloom.x - ax) * dx + (bloom.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(bloom.x - ax - along * dx, bloom.y - ay - along * dy) < 4;
    });
    assert.ok(nearStrand, "food must grow along the roots, leaving gaps between branches");
  }
});

test("grazed roots keep growing but cannot restart an unfinished frenzy", (t) => {
  seedRandom(t);
  const field = new PlanktonField(1);
  field.resize(720, 540);
  for (const bloom of field.blooms) { bloom.growth = 1; bloom.ripe = true; }
  field.step(STEP);
  assert.ok(field.frenzy);
  const root = field.blooms[0];
  field.bite(root.x, root.y, 1, 1);
  advance(field, 30);
  assert.ok(root.growth > PLANKTON_BUD && root.growth < PLANKTON_RIPE);
  assert.equal(root.ripe, false);
  assert.ok(field.frenzy, "untouched ripe food should keep the frenzy running");
  field.bite(360, 270, 1000, Infinity);
  assert.equal(field.frenzy, false);
  advance(field, 22);
  assert.ok(root.ripe, "clearing the food releases roots into the next cycle");
});

test("fleeing interrupts grazing even with ripe food directly at the koi's mouth", (t) => {
  seedRandom(t);
  const world = new World([], 0, 1, { planktonDensity: 1 });
  world.resize(720, 540, 10, 15);
  const koi = world.fish[0];
  const bloom = world.plankton.blooms[0];
  bloom.growth = 1;
  bloom.ripe = true;
  Object.assign(koi, { x: bloom.x, y: bloom.y, alarm: 1 });
  Object.assign(koi.appetite, { target: bloom });
  world.step(STEP);
  assert.equal(koi.appetite.target, null);
  assert.equal(bloom.growth, 1);
  assert.equal(koi.appetite.eaten, 0);
});

for (const [width, height] of [[390, 844], [1440, 900], [3840, 2160]]) {
  test(`growth and koi remain finite and bounded at ${width}x${height}, including resize`, (t) => {
    seedRandom(t, width);
    const world = new World([], 0, 28, { planktonDensity: 1 });
    world.resize(width, height, 10, 15);
    advance(world, 45);
    assert.ok(world.plankton.blooms.some((bloom) => bloom.bornAt > 10 && bloom.growth < 0.7), "koi should leave regrowing buds");
    const root = world.plankton.blooms[0];
    const growth = root.growth;
    world.resize(390, 844, 8, 12);
    assert.equal(world.plankton.blooms[0], root);
    assert.equal(root.growth, growth);
    advance(world, 15);
    assert.ok(world.plankton.blooms.length <= world.plankton.capacity);
    assert.ok(world.plankton.blooms.every((bloom) => bloom.x >= 0 && bloom.x <= 390 && bloom.y >= 0 && bloom.y <= 844
      && bloom.growth >= PLANKTON_BUD && bloom.growth <= 1));
    assert.ok(world.fish.every((fish) => Number.isFinite(fish.x) && Number.isFinite(fish.y) && fish.koi.nodes.every(Number.isFinite)));
  });
}

test("omitting plankton preserves the existing food-free simulation", () => {
  const world = new World([], 0, 1);
  world.resize(720, 540, 10, 15);
  advance(world, 1);
  assert.equal(world.plankton.blooms.length, 0);
  assert.equal(world.fish[0].appetite, undefined);
});
