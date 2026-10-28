# ascii-sharks

Vendored from https://github.com/stackedlol/ascii-sharks at commit
`a0074c16a106f0abc665fe9712ca445f8f98ad8e`, under the included MIT license.

Local changes expose optional `cellWidth` and `timeScale` engine settings, use
120 Hz simulation substeps, and render fine grids with a single shape sample per
cell. Fine shark artwork is cached in body coordinates and bent along the live
spine with subpixel transforms rather than rerasterized every frame. The wake
field retains its coarse grid independently of artwork detail. Small glyphs
use proportional insets and baselines. Fish spacing remains
independent of visual grid density. Resizing scales the existing ecosystem into
the new viewport. Theme options paint the page background and adapt cached artwork
directly, avoiding viewport-sized CSS filters. Upstream defaults remain available
when no options are passed.

The optional `maxSharks` caps the active population, and
`sharkRotationInterval` allows that group's departure after the given number of
simulation seconds and after each shark finishes at least three feeding bouts.
`sharkFeedingCycles` raises that minimum; `sharkFishPerFeeding` sets the fish caught
per bout (default three). Hungry sharks maintain a sprint, pursue even distant or
rearward prey, and make faster lunges when lined up with a nearby fish. A partial
meal never stops the hunt. Full sharks cruise for a seven-second chase cooldown before hunger returns;
after completing their visit they wait for their partner. Without rotation they
continue feeding indefinitely. Worlds with no fish still rotate on schedule.
Fish and koi react sooner to hunting sharks, sprint and scatter out of their path,
and choose the side with more room near an edge. Eaten fish respawn as schools;
the snout sweeps its movement path to avoid missing catches during a fast lunge.
Departing sharks ease into a sprint with stronger, quicker body waves
and hold their course through the edge. Only after every outgoing body, fin, and
tail is off-screen does the next group swim in from randomized edges. Rotation
leaves fish and koi intact and pauses with the simulation. Omit these options for
the upstream population. The initial group starts at a random angle around the
viewport, with spaced-apart positions and randomized swim directions and headings.

The optional `koiCount` adds ornamental fish with a persistent species identity,
schooling behavior, and cached patterned ASCII artwork. Each koi has a constrained
follow-the-leader spine, a traveling body wave, and a tail attached to the flexible
body. The simulation preserves that spine through turns and resets it on respawn
or resize.
Koi heading changes are limited to 1.6 radians per second and a turning radius
of at least 95% of body length, including splash and predator reactions.
Their renderer blends cached swim poses and corrects the turn between cached
curves continuously, so the entire school can flex without rebuilding every
body texture each frame.

`planktonDensity` enables a green food field (zero by default). A density of one
targets one colony per 340 CSS square pixels, bounded to 480–6,400 colonies.
Food is concentrated along branching, rootlike strands in 3–11 dense clumps at
random, separated positions, leaving most of the screen as open water. Roots
extend outward as their colonies grow; their visual strands and physical food
positions expand together. The pond starts at 72% of its food population and
adds five new buds every 0.3 simulation seconds within those
clumps. Uneaten old colonies renew at the cap. Colonies mature over roughly
12–24 seconds and become edible at 82% growth.

Once 30% of the colonies are ripe, all koi join a shared frenzy. They sprint
toward ripe food anywhere on screen at roughly six times cruising speed over
open water, with faster tail beats and reduced school separation, and keep
eating until no ripe food remains. There are no
individual meal quotas. A bite leaves the same root at 6% growth. Grazed roots
continue growing but stay below maturity during the current frenzy, allowing
the school to clear the food. After clearing it, koi cruise for at least ten
seconds while roots mature for the next frenzy. Predator and pointer alarms
still take priority. The food has its own spatial index and sixteen cached
ASCII sprites composited into small cached clump layers, stays green in both
themes, and preserves surviving roots and growth on resize.
