// Board geometry for the Legion AI: distances between bases, terrain in the
// way, and how far a unit can get toward a point. Inches throughout, with
// the same frames the canvas draws: a token's x/y is its top-left, and a
// terrain piece is drawn from its x/y corner, rotated about that corner.

import { terrainClears, type TabletopState, type Terrain, type Token } from "../tabletop";

export type Pt = { x: number; y: number };

export const center = (t: Token): Pt => ({ x: t.x + t.size / 2, y: t.y + t.size / 2 });
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Edge-to-edge distance between two bases (0 when touching). */
export function baseGap(a: Token, b: Token): number {
  return Math.max(0, dist(center(a), center(b)) - a.size / 2 - b.size / 2);
}

/** The closest any base of `as` gets to any base of `bs`. */
export function unitGap(as: Token[], bs: Token[]): number {
  let best = Infinity;
  for (const a of as) for (const b of bs) best = Math.min(best, baseGap(a, b));
  return best;
}

// A point in the terrain piece's own (unrotated) frame.
function toLocal(t: Terrain, p: Pt): Pt {
  const rad = (-(t.rotation || 0) * Math.PI) / 180;
  const dx = p.x - t.x, dy = p.y - t.y;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/** Distance from a point to the terrain piece's footprint (0 inside). */
export function terrainDistance(t: Terrain, p: Pt): number {
  const l = toLocal(t, p);
  if (t.shape === "circle") return Math.max(0, dist(l, { x: t.width / 2, y: t.width / 2 }) - t.width / 2);
  const dx = Math.max(0 - l.x, 0, l.x - t.width);
  const dy = Math.max(0 - l.y, 0, l.y - t.height);
  return Math.hypot(dx, dy);
}

export function terrainCenter(t: Terrain): Pt {
  const rad = ((t.rotation || 0) * Math.PI) / 180;
  const w = t.width / 2, h = (t.shape === "circle" ? t.width : t.height) / 2;
  return { x: t.x + w * Math.cos(rad) - h * Math.sin(rad), y: t.y + w * Math.sin(rad) + h * Math.cos(rad) };
}

/** Terrain a unit can't stand in or walk through: walls, buildings and
 * rocks taller than it flies. Forests and barricades are crossed (slowly,
 * in the real game); objective markers never block. */
export function blocks(t: Terrain, fly: number): boolean {
  if (t.kind === "objective" || t.kind === "forest" || t.kind === "barricade") return false;
  return !terrainClears(t, fly);
}

/** Pieces that give cover to a unit behind them. */
export function coverOf(t: Terrain): 0 | 1 | 2 {
  if (t.kind === "objective") return 0;
  return t.kind === "building" || t.kind === "wall" ? 2 : 1;
}

/** Whether the segment a→b passes through the terrain piece. */
export function crosses(t: Terrain, a: Pt, b: Pt): boolean {
  const n = Math.max(2, Math.ceil(dist(a, b) / 0.4));
  for (let i = 1; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (terrainDistance(t, p) === 0) return true;
  }
  return false;
}

/** Cover a target gets against an attacker: the best piece within 2" of
 * the target that the line from the attacker crosses. */
export function coverAgainst(state: TabletopState, from: Pt, target: Token[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const t of state.terrain) {
    const c = coverOf(t);
    if (c <= best) continue;
    // Most of the unit has to be behind it.
    const behind = target.filter((m) => terrainDistance(t, center(m)) <= 2 + m.size / 2 && crosses(t, from, center(m)));
    if (behind.length * 2 >= target.length) best = c;
  }
  return best;
}

/** Can these bases sit `d` further along? Kept on the table, out of
 * blocking terrain and off every other unit's base. */
function fits(state: TabletopState, moving: Token[], d: Pt): boolean {
  const ids = new Set(moving.map((m) => m.id));
  const W = state.map.widthInches, H = state.map.heightInches;
  for (const m of moving) {
    const c = { x: center(m).x + d.x, y: center(m).y + d.y };
    const r = m.size / 2;
    if (c.x < r || c.y < r || c.x > W - r || c.y > H - r) return false;
    for (const t of state.terrain) if (blocks(t, m.elevation ?? 0) && terrainDistance(t, c) < r - 0.05) return false;
    for (const o of state.tokens) {
      if (ids.has(o.id) || o.kind !== "unit") continue;
      if (dist(c, center(o)) < r + o.size / 2 - 0.05) return false;
    }
  }
  return true;
}

/** How far the unit gets moving straight toward `target`: at most
 * `maxDist`, stopping `stopAt` short of it, and backing off until the bases
 * fit and nothing blocking is crossed on the way. */
export function planMove(state: TabletopState, moving: Token[], from: Pt, target: Pt, maxDist: number, stopAt: number): Pt {
  const full = dist(from, target);
  const want = Math.min(maxDist, Math.max(0, full - stopAt));
  if (want < 0.25 || full === 0) return { x: 0, y: 0 };
  const dir = { x: (target.x - from.x) / full, y: (target.y - from.y) / full };
  for (let s = want; s >= 0.25; s -= 0.25) {
    const d = { x: dir.x * s, y: dir.y * s };
    if (!fits(state, moving, d)) continue;
    const path = moving.some((m) => state.terrain.some((t) => blocks(t, m.elevation ?? 0) &&
      crosses(t, center(m), { x: center(m).x + d.x, y: center(m).y + d.y })));
    if (!path) return d;
  }
  return { x: 0, y: 0 };
}
