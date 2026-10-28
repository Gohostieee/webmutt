"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { OceanEngine, SharkSpec } from "ascii-sharks";

const SHARKS: SharkSpec[] = [
  { kind: "hammerhead", size: 1 },
  { kind: "classic", size: 0.84 },
  { kind: "tiger", size: 0.77 },
  { kind: "mako", size: 0.7 },
  { kind: "zebra", size: 0.84 },
  { kind: "greathammer", size: 1 },
  { kind: "thresher", size: 0.77 },
  { kind: "nurse", size: 0.7 },
];

export function SharkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext("2d", { alpha: false })) return;

    let disposed = false;
    let engine: OceanEngine | undefined;
    let syncVisibility: (() => void) | undefined;

    // Load the simulation after hydration; the rest of the app stays server-rendered.
    void import("ascii-sharks")
      .then(({ OceanEngine }) => {
        if (disposed) return;

        syncVisibility = () => {
          if (document.hidden) {
            engine?.destroy();
            engine = undefined;
          } else if (!engine) {
            engine = new OceanEngine(canvas, SHARKS, {
              maxSharks: 2,
              sharkRotationInterval: 30,
              sharkFeedingCycles: 3,
              sharkFishPerFeeding: 3,
              cellWidth: 3,
              timeScale: 1,
              fishCount: 0,
              koiCount: Math.round(Math.min(96, Math.max(28, canvas.clientWidth * canvas.clientHeight / 16000))),
              planktonDensity: 1,
              theme: resolvedTheme === "dark" ? "dark" : "light",
              backgroundColor: getComputedStyle(document.body).backgroundColor,
              opacity: resolvedTheme === "dark" ? 0.65 : 0.5,
            });
          }
        };

        document.addEventListener("visibilitychange", syncVisibility);
        syncVisibility();
      })
      .catch((error: unknown) => {
        console.error("Unable to load the ASCII shark background.", error);
      });

    return () => {
      disposed = true;
      if (syncVisibility) {
        document.removeEventListener("visibilitychange", syncVisibility);
      }
      engine?.destroy();
    };
  }, [resolvedTheme]);

  return <canvas ref={canvasRef} className="shark-background" aria-hidden="true" />;
}
