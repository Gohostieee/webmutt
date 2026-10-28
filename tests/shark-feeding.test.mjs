import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../vendor/ascii-sharks/src/world.ts";
import { resetKoiSpine } from "../vendor/ascii-sharks/src/koi-motion.ts";
import { SPECIES } from "../vendor/ascii-sharks/src/species.ts";

const STEP = 1 / 120;

function createWorld(t, fishCount = 12, options = {}, koiCount = 0) {
  let seed = 42;
  const random = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  t.after(() => { Math.random = random; });
  const world = new World([{ kind: "mako", size: 0.7 }, { kind: "tiger", size: 0.8 }],
    fishCount, koiCount, { maxSharks: 1, ...options });
  world.resize(1280, 720, 10, 15);
  return world;
}

function startHunt(world) {
  const shark = world.sharks[0];
  shark.nextHungerAt = world.time;
  world.step(STEP);
  assert.equal(shark.feeding, "hunting");
  return shark;
}

function advance(world, seconds) {
  for (let i = 0; i < seconds / STEP; i++) {
    world.step(STEP);
    world.events.length = 0;
  }
}

function putInMouth(world, fish) {
  const shark = world.sharks[0];
  fish.alive = true;
  fish.x = shark.nodes[0];
  fish.y = shark.nodes[1];
  fish.vx = Math.cos(shark.heading) * 30;
  fish.vy = Math.sin(shark.heading) * 30;
}

test("a partial meal keeps the shark sprinting, and only the catch quota ends the bout", (t) => {
  const world = createWorld(t);
  // Isolate each bite, including the no-live-prey gap between bites.
  for (const fish of world.fish) { fish.alive = false; fish.respawnAt = Infinity; }
  const shark = startHunt(world);
  advance(world, 2);
  assert.equal(shark.feeding, "hunting", "a hunt cannot time out when prey is unavailable");
  assert.ok(shark.sprint > 0.99);

  for (let bite = 1; bite <= 3; bite++) {
    putInMouth(world, world.fish[bite - 1]);
    world.step(STEP);
    assert.equal(world.fish[bite - 1].alive, false);
    assert.equal(shark.fishEaten, bite);
    assert.equal(shark.feeding, bite < 3 ? "hunting" : "resting");
    assert.equal(shark.feedingCycles, bite < 3 ? 0 : 1);
    if (bite < 3) {
      advance(world, 1);
      assert.ok(shark.sprint > 0.99, "a partial meal must not stop the sprint");
    }
  }
  const fedAt = world.time;
  assert.ok(Math.abs(shark.nextHungerAt - fedAt - 7) < 1e-9,
    "a full meal must start a seven-second chase cooldown");
  advance(world, 1);
  assert.ok(shark.sprint < 0.1, "a full meal should ease back into a cruise");
  assert.equal(shark.target, null);
  advance(world, 6 - STEP);
  assert.ok(world.time < fedAt + 7);
  assert.equal(shark.feeding, "resting", "chasing must stay disabled for the full seven seconds");
  assert.equal(shark.target, null);
  world.step(STEP * 2);
  assert.equal(shark.feeding, "hunting", "chasing should resume once the cooldown expires");
  assert.equal(shark.fishEaten, 0);
});

test("an overdue rotation waits for three complete feeding bouts", (t) => {
  const world = createWorld(t, 12, { sharkRotationInterval: 0.1, sharkFeedingCycles: 1 });
  for (const fish of world.fish) { fish.alive = false; fish.respawnAt = Infinity; }
  const shark = world.sharks[0];
  for (let meal = 1; meal <= 3; meal++) {
    shark.nextHungerAt = world.time;
    world.step(STEP);
    assert.equal(shark.feeding, "hunting");
    advance(world, 0.2);
    for (let bite = 0; bite < 3; bite++) {
      putInMouth(world, world.fish[(meal - 1) * 3 + bite]);
      world.step(STEP);
      assert.equal(shark.transition, "swimming", "rotation interrupted a meal");
    }
    assert.equal(shark.feedingCycles, meal);
    world.step(STEP);
    assert.equal(shark.transition, meal < 3 ? "swimming" : "exiting");
  }
});

test("hungry sharks find distant prey behind them and lunge when aligned", (t) => {
  const world = createWorld(t, 1);
  const shark = world.sharks[0];
  shark.nodes[0] = 1000;
  shark.nodes[1] = 360;
  shark.heading = 0;
  const fish = world.fish[0];
  Object.assign(fish, { x: 100, y: 360, vx: -30, vy: 0 });
  startHunt(world);
  assert.equal(shark.target, fish, "the forward cone must not strand a hungry shark");

  Object.assign(fish, { x: 1140, y: 360, vx: 30, vy: 0 });
  shark.heading = 0;
  shark.retargetAt = 0;
  world.step(STEP);
  assert.ok(shark.lungeUntil > world.time);
  assert.ok(shark.nextLungeAt > shark.lungeUntil, "lunges need recovery between bursts");
  advance(world, 0.2);
  assert.ok(shark.speed > (30 + shark.length * 0.04) * 3, "lunge should visibly accelerate");
});

for (const koi of [false, true]) {
  test(`${koi ? "koi" : "school fish"} accelerate and steer away from an attacking shark`, (t) => {
    const world = createWorld(t, koi ? 0 : 1, {}, koi ? 1 : 0);
    const fish = world.fish[0];
    const shark = world.sharks[0];
    const sp = SPECIES[fish.species];
    Object.assign(fish, { x: 640, y: 360, vx: sp.cruise, vy: 0, alarm: 0 });
    if (fish.koi) resetKoiSpine(fish.koi, fish.x, fish.y, 0);
    shark.heading = 0;
    shark.nodes.forEach((_, index) => { shark.nodes[index] = index % 2 ? 350 : 560 - index / 2 * 10; });
    shark.feeding = "hunting";
    shark.target = fish;
    // Hold the pursuer here to measure the fish's independent escape response.
    world.stepSharks = () => {};
    advance(world, 0.5);
    assert.equal(fish.alarm, 1);
    assert.ok(Math.hypot(fish.vx, fish.vy) > sp.cruise * 1.8);
    assert.ok(Math.hypot(fish.x - 560, fish.y - 350) > 100, "fish should open a gap");
    assert.ok(fish.y > 370, "fish should break sideways out of the attack path");
    if (fish.koi) assert.ok(fish.koi.nodes.every(Number.isFinite));
  });
}

test("a configurable catch quota is exact and resting sharks cannot eat", (t) => {
  const world = createWorld(t, 8, { sharkFishPerFeeding: 2 });
  const shark = world.sharks[0];
  for (const fish of world.fish) putInMouth(world, fish);
  world.step(STEP);
  assert.equal(world.fish.filter((fish) => !fish.alive).length, 0);
  shark.nextHungerAt = world.time;
  world.step(STEP);
  assert.equal(world.fish.filter((fish) => !fish.alive).length, 2);
  assert.equal(shark.feedingCycles, 1);
  assert.equal(shark.fishEaten, 2);
  assert.equal(shark.feeding, "resting");
});

test("temporary prey exhaustion recovers through respawning without replacing koi", (t) => {
  const world = createWorld(t, 0, {}, 1);
  const koi = world.fish[0];
  const spine = koi.koi;
  koi.alive = false;
  koi.respawnAt = 0;
  const shark = startHunt(world);
  advance(world, 10);
  assert.ok(koi.alive || koi.respawnAt > 0);
  assert.equal(koi.koi, spine);
  assert.ok(spine.nodes.every(Number.isFinite));
  assert.equal(shark.feeding, "hunting");
  assert.ok(shark.sprint > 0.99);
});
