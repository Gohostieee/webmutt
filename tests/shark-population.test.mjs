import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../vendor/ascii-sharks/src/world.ts";

const specs = [
  { kind: "hammerhead", size: 1 },
  { kind: "classic", size: 0.84 },
  { kind: "tiger", size: 0.77 },
  { kind: "mako", size: 0.7 },
  { kind: "zebra", size: 0.84 },
  { kind: "greathammer", size: 1 },
  { kind: "thresher", size: 0.77 },
  { kind: "nurse", size: 0.7 },
];

function seedRandom(t, seed = 42) {
  const original = Math.random;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  t.after(() => { Math.random = original; });
}

function fullyOutside(shark, world) {
  // Include fins, head padding, and the renderer's swim wave beyond the spine.
  const margin = shark.length * 0.45;
  const xs = shark.nodes.filter((_, i) => i % 2 === 0);
  const ys = shark.nodes.filter((_, i) => i % 2 === 1);
  return Math.max(...xs) < -margin || Math.min(...xs) > world.width + margin
    || Math.max(...ys) < -margin || Math.min(...ys) > world.height + margin;
}

test("rotating shark species never appear or disappear inside the viewport", (t) => {
  seedRandom(t);
  const world = new World(specs, 0, 0, { maxSharks: 2, sharkRotationInterval: 30 });
  world.resize(1280, 720, 10, 15);
  const seen = new Set(world.sharks.map((shark) => shark.kind));

  for (let frame = 0; frame < 45 * 120; frame++) {
    const previous = new Set(world.sharks);
    const positions = new Map(world.sharks.map((shark) => [shark, [shark.nodes[0], shark.nodes[1]]]));
    world.step(1 / 120);
    for (const shark of previous) {
      if (!world.sharks.includes(shark)) {
        assert.ok(fullyOutside(shark, world), `${shark.kind} vanished on-screen at ${world.time.toFixed(3)}s`);
      }
    }
    for (const shark of world.sharks) {
      seen.add(shark.kind);
      if (!previous.has(shark)) {
        assert.ok(fullyOutside(shark, world), `${shark.kind} appeared on-screen at ${world.time.toFixed(3)}s`);
      } else {
        const [x, y] = positions.get(shark);
        const distance = Math.hypot(shark.nodes[0] - x, shark.nodes[1] - y);
        assert.ok(distance <= shark.speed / 120 + 0.002, "a swimming shark teleported");
      }
    }
    assert.ok(world.sharks.length <= 2, "rotation exceeded the two-shark cap");
  }
  assert.ok(seen.size >= 4, "rotation must actually introduce the next pair");
});

test("departures ease into a faster sprint and quicker tail beats without replacing their bodies", (t) => {
  seedRandom(t);
  const world = new World(specs, 0, 0, { maxSharks: 2, sharkRotationInterval: 30 });
  world.resize(1280, 720, 10, 15);
  for (let i = 0; i < 29 * 120; i++) world.step(1 / 120);
  const sharks = [...world.sharks];
  const before = sharks.map((shark) => ({ speed: shark.speed, phase: shark.phase }));
  for (let i = 0; i < 3 * 120; i++) world.step(1 / 120);

  sharks.forEach((shark, i) => {
    assert.ok(world.sharks.includes(shark), "the original body must swim out");
    assert.equal(shark.transition, "exiting");
    assert.ok(shark.speed > before[i].speed * 2.5, "departure should visibly accelerate");
    assert.ok(shark.sprint > 0.95, "sprint effort should ramp up");
    assert.ok((shark.phase - before[i].phase) / 3 > (2 + before[i].speed / 24) * 1.5,
      "the departure should beat its tail faster than cruising");
  });
});

for (const [width, height] of [[1440, 900], [390, 844], [1920, 600], [700, 700]]) {
  test(`all species swim in and out at ${width}x${height}, preserving fish and koi`, (t) => {
    seedRandom(t, width + height);
    const world = new World(specs, 20, 6, { maxSharks: 2, sharkRotationInterval: 30 });
    world.resize(width, height, 10, 15);
    const fish = [...world.fish];
    const koi = fish.slice(0, 6).map((f) => f.koi);
    const seen = new Set();
    const arrived = new Set();
    let entries = 0;
    const departed = new Set();
    for (let frame = 0; frame < 300 * 120; frame++) {
      const previous = new Set(world.sharks);
      // Exercise viewport changes while the first pair is leaving.
      if (frame === 31 * 120) world.resize(width * 0.9, height * 0.9, 10, 15);
      world.step(1 / 120);
      world.events.length = 0;
      assert.ok(world.sharks.length <= 2);
      for (const shark of previous) {
        if (!world.sharks.includes(shark)) {
          assert.ok(fullyOutside(shark, world), "visible departure removed");
          assert.ok(shark.feedingCycles >= 3, "a shark left before finishing three meals");
          assert.equal(shark.fishEaten, 3, "departure must wait for the full catch quota");
          departed.add(shark.kind);
        }
      }
      for (const shark of world.sharks) {
        seen.add(shark.kind);
        if (!previous.has(shark)) {
          entries++;
          assert.ok(fullyOutside(shark, world), "replacement spawned on-screen");
          assert.equal(shark.transition, "entering");
        }
        if (shark.transition === "swimming") arrived.add(shark.kind);
        assert.ok(shark.nodes.every(Number.isFinite));
      }
      if (departed.size === specs.length) break;
    }
    assert.equal(seen.size, specs.length, "all eight species should cycle");
    assert.equal(arrived.size, specs.length, "every incoming species should reach the swimming area");
    assert.ok(entries >= 6);
    assert.equal(departed.size, specs.length, "every species should complete its feeding visit");
    assert.deepEqual(world.fish, fish, "rotation should preserve the existing ecosystem");
    assert.deepEqual(world.fish.slice(0, 6).map((f) => f.koi), koi);
  });
}

test("omitting rotation keeps the original population swimming", (t) => {
  seedRandom(t);
  const world = new World(specs, 0);
  world.resize(1280, 720, 10, 15);
  const sharks = [...world.sharks];
  for (let frame = 0; frame < 60 * 120; frame++) world.step(1 / 120);
  assert.deepEqual(world.sharks, sharks);
  assert.ok(sharks.every((shark) => shark.transition === "swimming" && shark.sprint === 0));
});
