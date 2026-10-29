// The blaster show for a finished attack (lib/attack AttackFx), as a
// frame at time t: bolts in flight, impact flashes, how far each defender
// jolts, and the minis that drop. Board inches; the 2D canvas and the 3D
// view both draw from this, so the two match.

import { seededRandom, type AttackFx, type ShotKind } from "./attack";

export type FxBolt = {
  /** Tail and head of the bolt, inches. */
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  fromId: string;
  toId: string;
  kind: ShotKind;
  /** 0..1 along its flight, for a muzzle flash at the start. */
  p: number;
};
export type FxFlash = { x: number; y: number; r: number; alpha: number; color: string; kind: ShotKind | "muzzle" | "down"; id?: string };
export type FxJerk = { dx: number; dy: number; tilt: number; dirX: number; dirY: number };
/** A mini that was defeated: shown until its last hit lands, then falls. */
export type FxGhost = { id: string; x: number; y: number; size: number; color: string; label: string; portrait?: string; fall: number; alpha: number };

export type FxFrame = {
  bolts: FxBolt[];
  flashes: FxFlash[];
  jerks: Record<string, FxJerk>;
  ghosts: FxGhost[];
};

type Timed = {
  kind: ShotKind; fromId: string; toId: string;
  ax: number; ay: number; bx: number; by: number;
  fire: number; arrive: number; len: number; dirX: number; dirY: number;
};

const AMP: Partial<Record<ShotKind, number>> = { crit: 0.42, hit: 0.28, block: 0.1, armor: 0.07 };
const FLASH_MS = 260;
const JERK_MS = 650;
const FALL_MS = 850;
const FADE_MS = 1500;

const plan = new WeakMap<AttackFx, Timed[]>();

function timeline(fx: AttackFx, seed: string): Timed[] {
  const have = plan.get(fx);
  if (have) return have;
  const rnd = seededRandom(seed + ":fx");
  const n = fx.shots.length;
  const gap = n ? Math.min(210, 2200 / n) : 0;
  const out = fx.shots.map((s, i): Timed => {
    const a = fx.from[s.from] ?? fx.from[0]!;
    const t = fx.to[s.to] ?? fx.to[0]!;
    // Spread the shots over the target's base.
    const jx = (rnd() - 0.5) * t.size * 0.5, jy = (rnd() - 0.5) * t.size * 0.5;
    let bx = t.x + jx, by = t.y + jy;
    const d = Math.hypot(bx - a.x, by - a.y) || 1;
    const dirX = (bx - a.x) / d, dirY = (by - a.y) / d;
    const side = rnd() < 0.5 ? -1 : 1;
    if (s.kind === "miss" || s.kind === "dodge") {
      // Past the target, wide of it (a dodge only just).
      const wide = (s.kind === "dodge" ? 0.45 : 0.7 + rnd() * 0.8) * t.size * side;
      bx = t.x - dirY * wide + dirX * 6;
      by = t.y + dirX * wide + dirY * 6;
    } else if (s.kind === "cover") {
      // Stops in the cover in front of the target.
      bx = t.x - dirX * (t.size / 2 + 0.6 + rnd() * 0.6);
      by = t.y - dirY * (t.size / 2 + 0.6 + rnd() * 0.6);
    } else if (s.kind === "block" || s.kind === "armor") {
      bx = t.x - dirX * t.size * 0.35 + jx * 0.4;
      by = t.y - dirY * t.size * 0.35 + jy * 0.4;
    }
    const flight = Math.hypot(bx - a.x, by - a.y);
    const travel = fx.melee ? 140 : Math.max(180, Math.min(650, flight * 30));
    const fire = i * gap + rnd() * gap * 0.4;
    return {
      kind: s.kind, fromId: a.id, toId: t.id, ax: a.x, ay: a.y, bx, by,
      fire, arrive: fire + travel, len: fx.melee ? Math.min(0.8, flight) : Math.min(2.2, Math.max(0.6, flight * 0.18)),
      dirX, dirY,
    };
  });
  plan.set(fx, out);
  return out;
}

/** How long the show runs, ms. */
export function fxDuration(fx: AttackFx, seed: string): number {
  const t = timeline(fx, seed);
  const last = t.reduce((m, s) => Math.max(m, s.arrive), 0);
  return last + (fx.to.some((m) => m.defeated) ? FALL_MS + FADE_MS : JERK_MS + 200);
}

export function fxFrame(fx: AttackFx, seed: string, t: number): FxFrame {
  const shots = timeline(fx, seed);
  const bolts: FxBolt[] = [];
  const flashes: FxFlash[] = [];
  const jerks: Record<string, FxJerk> = {};

  for (const s of shots) {
    if (t < s.fire) continue;
    const flight = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const p = Math.min(1, (t - s.fire) / (s.arrive - s.fire));
    // The bolt's tail keeps going after the head lands, so it shrinks in.
    const tail = Math.max(0, (t - s.fire) / (s.arrive - s.fire) - s.len / flight);
    if (tail < 1) {
      const hp = Math.min(1, p);
      bolts.push({
        x1: s.ax + (s.bx - s.ax) * tail, y1: s.ay + (s.by - s.ay) * tail,
        x2: s.ax + (s.bx - s.ax) * hp, y2: s.ay + (s.by - s.ay) * hp,
        color: fx.color, fromId: s.fromId, toId: s.toId, kind: s.kind, p,
      });
    }
    const sinceFire = t - s.fire;
    if (sinceFire < 90 && !fx.melee) {
      flashes.push({ x: s.ax + s.dirX * 0.4, y: s.ay + s.dirY * 0.4, r: 0.35, alpha: 1 - sinceFire / 90, color: fx.color, kind: "muzzle", id: s.fromId });
    }
    if (t >= s.arrive) {
      const age = t - s.arrive;
      if (s.kind !== "miss" && s.kind !== "dodge" && age < FLASH_MS) {
        const big = s.kind === "crit" ? 1.4 : s.kind === "hit" ? 1 : 0.75;
        const color = s.kind === "block" || s.kind === "armor" ? "#7fd0ff" : s.kind === "cover" ? "#d9b27a" : s.kind === "crit" ? "#fff2a0" : "#ffb070";
        flashes.push({ x: s.bx, y: s.by, r: (0.3 + 0.5 * (age / FLASH_MS)) * big, alpha: 1 - age / FLASH_MS, color, kind: s.kind, id: s.toId });
      }
      const amp = AMP[s.kind] ?? 0;
      if (amp && age < JERK_MS) {
        // A jolt away from the shot that rings down.
        const k = amp * Math.exp(-age / 150) * Math.cos(age * 0.042);
        const j = jerks[s.toId] ?? { dx: 0, dy: 0, tilt: 0, dirX: s.dirX, dirY: s.dirY };
        j.dx += s.dirX * k; j.dy += s.dirY * k; j.tilt += k * 0.9;
        j.dirX = s.dirX; j.dirY = s.dirY;
        jerks[s.toId] = j;
      }
    }
  }

  // A small kick back on each mini as it fires.
  for (const s of shots) {
    const age = t - s.fire;
    if (age < 0 || age > 220 || fx.melee) continue;
    const k = -0.08 * Math.exp(-age / 60);
    const j = jerks[s.fromId] ?? { dx: 0, dy: 0, tilt: 0, dirX: s.dirX, dirY: s.dirY };
    j.dx += s.dirX * k; j.dy += s.dirY * k; j.tilt += k * 0.6;
    jerks[s.fromId] = j;
  }

  const ghosts: FxGhost[] = [];
  for (const m of fx.to) {
    if (!m.defeated) continue;
    const dieAt = shots.filter((s) => s.toId === m.id && (s.kind === "hit" || s.kind === "crit")).reduce((x, s) => Math.max(x, s.arrive), 0);
    const since = t - dieAt;
    const fall = since <= 0 ? 0 : Math.min(1, since / FALL_MS);
    const alpha = since <= FALL_MS ? 1 : Math.max(0, 1 - (since - FALL_MS) / FADE_MS);
    if (alpha <= 0) continue;
    ghosts.push({ id: m.id, x: m.x, y: m.y, size: m.size, color: m.color, label: m.label, portrait: m.portrait, fall, alpha });
    if (since > 0 && since < 420) flashes.push({ x: m.x, y: m.y, r: m.size * (0.5 + since / 420), alpha: 1 - since / 420, color: "#ff8a3a", kind: "down", id: m.id });
  }
  return { bolts, flashes, jerks, ghosts };
}
