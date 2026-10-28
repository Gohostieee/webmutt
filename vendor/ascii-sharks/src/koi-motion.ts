import { angleDiff, clamp } from "./math";

export const KOI_NODES = 9;
export const KOI_BODY_LENGTH = 28;

export interface KoiSpine {
  nodes: Float32Array;
  length: number;
  scale: number;
  heading: number;
}

export function createKoiSpine(x: number, y: number, heading: number, scale: number): KoiSpine {
  const spine = { nodes: new Float32Array(KOI_NODES * 2), length: KOI_BODY_LENGTH * scale, scale, heading };
  resetKoiSpine(spine, x, y, heading);
  return spine;
}

/** Reset history after spawning or resizing, so the body follows its new head. */
export function resetKoiSpine(spine: KoiSpine, x: number, y: number, heading: number) {
  spine.heading = heading;
  for (let i = 0; i < KOI_NODES; i++) {
    const distance = spine.length * i / (KOI_NODES - 1);
    spine.nodes[i * 2] = x - Math.cos(heading) * distance;
    spine.nodes[i * 2 + 1] = y - Math.sin(heading) * distance;
  }
}

/** Preserve momentum: even a splash cannot reverse the head in one step. */
export function steerKoi(spine: KoiSpine, desiredHeading: number, speed: number, dt: number) {
  const turnRate = Math.min(1.6, speed / (spine.length * 0.95));
  const maxTurn = turnRate * dt;
  spine.heading += clamp(angleDiff(spine.heading, desiredHeading), -maxTurn, maxTurn);
  return spine.heading;
}

/** Follow the head with constrained joints, as the shark simulation does. */
export function stepKoiSpine(spine: KoiSpine, x: number, y: number, heading: number) {
  const { nodes } = spine;
  const segment = spine.length / (KOI_NODES - 1);
  nodes[0] = x;
  nodes[1] = y;
  let previousAngle = heading + Math.PI;
  for (let i = 1; i < KOI_NODES; i++) {
    const px = nodes[(i - 1) * 2];
    const py = nodes[(i - 1) * 2 + 1];
    const targetAngle = Math.atan2(nodes[i * 2 + 1] - py, nodes[i * 2] - px);
    const angle = previousAngle + clamp(angleDiff(previousAngle, targetAngle), -0.22, 0.22);
    nodes[i * 2] = px + Math.cos(angle) * segment;
    nodes[i * 2 + 1] = py + Math.sin(angle) * segment;
    previousAngle = angle;
  }
}
