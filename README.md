# WebMutt

A [Next.js](https://nextjs.org) app with a living ASCII pond: flexible koi,
rotating shark species, and dense plankton that grows along branching roots.
Koi swarm ripe food in coordinated feeding frenzies, then wait through a
10-second cooldown while their food regrows. Includes light and dark themes,
reduced-motion support, and a reusable shadcn/ui component library.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font/local`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to self-host the Silver font from `app/fonts/silver.ttf`.
Headings use Chakra Petch, self-hosted through `next/font/google`. Use the
`font-heading` class for other large text. Silver remains the body and UI font.
The theme uses warm browns, a sky-blue accent, and sharp corners (`--radius: 0rem`).
The homepage has no foreground content yet; start building in `app/page.tsx`.

## ASCII shark background

[ascii-sharks](https://github.com/stackedlol/ascii-sharks) runs behind every route
through `components/shark-background.tsx`. An attributed local copy lives in
`vendor/ascii-sharks`, based on upstream commit
`a0074c16a106f0abc665fe9712ca445f8f98ad8e`. Its MIT license is included there and
served at `/licenses/ascii-sharks.txt`. No additional runtime dependencies are required.

Edit the `SHARKS` array to change species or relative sizes, and the engine options
in `components/shark-background.tsx` to adjust detail, speed, or opacity. The canvas
uses the existing light/dark palette and lets clicks pass through to page content.
Only two sharks are active at a time. Each shark gets hungry at least three times
per appearance. During each feeding bout it sprints after fish, leads moving prey,
and lunges in short bursts until it catches three fish. Fish and koi accelerate,
scatter sideways, and steer toward open water to escape. Full sharks rest for
seven simulation seconds between bouts; eaten fish return later in edge-spawned schools.
After at least 30 seconds of simulation time, once both sharks have finished their
three feeding bouts, the current pair accelerates into a sprint, with faster and
stronger tail beats, and
continues off-screen. Once both sharks have completely cleared the edges, the next
pair swims in from varied edges, cycling through hammerhead, classic, tiger, mako,
zebra, great hammerhead, thresher, and nurse before repeating. Fish and koi keep
swimming through each change. The initial pair starts around a random part of the
page, with varied headings and clockwise or counterclockwise swim directions.
Adjust `maxSharks` and `sharkRotationInterval` in the engine options to change the
population and earliest rotation time. `sharkFeedingCycles` sets the minimum meals
per visit (at least three), and `sharkFishPerFeeding` sets the catch quota per meal.
Run `npm run test:sharks` to check feeding quotas, lunges, fish escapes, continuous
departures, edge arrivals, and species rotation across desktop and mobile viewports.
The engine handles viewport resizing, pointer reactions, and a still frame for
`prefers-reduced-motion`. It is disposed while the tab is hidden and on unmount.
Engine options set fine 3 px ASCII artwork and `timeScale: 1` (original speed).
Simulation substeps run at 120 Hz while rendering follows the display refresh rate.
Detailed shark artwork is cached and bent along animated spines, with subpixel
movement; theme colors are painted directly to avoid expensive full-screen filters.
The background also adds 28–96 small koi, scaled to the starting viewport. Their
cached ASCII sprites have ivory, orange, red, gold, and black markings with animated
fan tails. Flexible spines carry a swim wave through the whole body and follow
turns, with the tail attached to the moving rear body. They school, react to the
pointer and sharks, and respawn as koi. Their heading changes at a bounded rate,
with a minimum turning radius, so startled koi steer through an arc.

Green plankton grows densely along branching, rootlike strands in 3–11 clumps
scattered randomly across the pond, leaving open water between them. The
strands expand outward as colonies grow. Fresh buds spawn along the strands;
once enough food matures, all koi sprint into a shared feeding frenzy and keep
eating until every ripe colony is cleared. Eaten colonies shrink to buds and
keep growing, staying below maturity until that frenzy ends. Koi then have a
10-second frenzy cooldown while the next crop matures. The field scales with
the viewport and caps at
6,400 colonies. Frenzied koi sprint at roughly six times cruising speed over
open water, slowing to eat within the clumps. Adjust `planktonDensity` in the
background's engine options to change the amount. Run `npm run test:plankton`
to check clump coverage, spawning, maturity, root growth, regrowth, coordinated
sprints, complete food clearance, predator priority, population bounds, and
viewport resizing.

## UI components

[shadcn/ui](https://ui.shadcn.com/docs) is configured with the Radix Nova preset,
Lucide icons, and Tailwind CSS v4. All 63 installable UI components are in
`components/ui`, with shared hooks in `hooks` and the `cn` utility in `lib/utils.ts`.
The registry's legacy `form` entry has no component files, and `toast` is unavailable
for this preset; use `field` and `sonner` instead.

Import components directly:

```tsx
import { Button } from "@/components/ui/button";
```

The root layout includes system-aware light/dark themes, a tooltip provider, and
the Sonner toast host. Use `toast` from `sonner` inside client components to show
notifications. Theme tokens are defined in `app/globals.css`, and CLI configuration
is in `components.json`.

To add or update a component later, run `npx shadcn add <component>`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
