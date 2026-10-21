// Fog of war for the D&D tabletop: line of sight from tokens, blocked by
// terrain that stands taller than the viewer's eyes. Everything works in
// GRID CELLS (5 ft each), the same units as token and terrain positions.

import type { DndTabletopState, DndTerrain, DndToken } from "./dndTabletop";

export type Pt = { x: number; y: number };
type Seg = { ax: number; ay: number; bx: number; by: number };

const FEET_PER_CELL = 5;
/** A medium creature's eyes, in feet above whatever it stands on. */
export const EYE_FT = 5;
// Rays swept evenly around a viewer, so a sight radius reads as a circle
// and open ground between blockers gets a smooth edge.
const SWEEP_RAYS = 96;
const EPS = 1e-4;

/** The outline of a terrain block, in cells, with its rotation applied. */
export function terrainOutline(t: DndTerrain): Pt[] {
  const w = t.w, d = t.shape === "circle" ? t.w : t.d;
  const cx = t.x + w / 2, cy = t.y + d / 2;
  let pts: Pt[];
  if (t.shape === "circle") {
    pts = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: cx + Math.cos(a) * w / 2, y: cy + Math.sin(a) * w / 2 };
    });
  } else {
    pts = [
      { x: t.x, y: t.y }, { x: t.x + w, y: t.y },
      { x: t.x + w, y: t.y + d }, { x: t.x, y: t.y + d },
    ];
  }
  if (!t.rotation) return pts;
  // Same sense as the SVG rotate() the board draws with (y points down).
  const r = (t.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const tokenCenter = (t: DndToken): Pt => ({ x: t.x + t.size / 2, y: t.y + t.size / 2 });

// Terrain taller than the viewer's eyes blocks sight, so a flyer looks
// over walls and a 5 ft boulder doesn't hide anything. A block the viewer
// stands inside (or on) never blocks them.
function blockers(terrain: DndTerrain[], eye: Pt, eyeFt: number): Seg[] {
  const out: Seg[] = [];
  for (const t of terrain) {
    if (t.height <= eyeFt) continue;
    const poly = terrainOutline(t);
    if (pointInPolygon(eye, poly)) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  return out;
}

// Distance along the ray (origin + t*dir) to the segment, or Infinity.
function rayHit(o: Pt, dx: number, dy: number, s: Seg): number {
  const ex = s.bx - s.ax, ey = s.by - s.ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const qx = s.ax - o.x, qy = s.ay - o.y;
  const t = (qx * ey - qy * ex) / den;
  const u = (qx * dy - qy * dx) / den;
  return t >= 0 && u >= -EPS && u <= 1 + EPS ? t : Infinity;
}

/**
 * What a viewer at `eye` can see: a polygon swept by rays that stop at the
 * first blocker, the edge of the map, or `rangeCells` (null = unlimited).
 */
export function visibilityPolygon(
  eye: Pt, terrain: DndTerrain[], cols: number, rows: number, eyeFt: number, rangeCells: number | null,
): Pt[] {
  const segs = blockers(terrain, eye, eyeFt);
  const edges: Seg[] = [
    { ax: 0, ay: 0, bx: cols, by: 0 }, { ax: cols, ay: 0, bx: cols, by: rows },
    { ax: cols, ay: rows, bx: 0, by: rows }, { ax: 0, ay: rows, bx: 0, by: 0 },
  ];
  const all = segs.concat(edges);
  // Aim at every blocker corner (and just either side of it, to see past
  // it), plus the even sweep.
  const angles: number[] = [];
  for (let i = 0; i < SWEEP_RAYS; i++) angles.push((i / SWEEP_RAYS) * Math.PI * 2 - Math.PI);
  for (const s of all) {
    for (const [px, py] of [[s.ax, s.ay], [s.bx, s.by]] as const) {
      const a = Math.atan2(py - eye.y, px - eye.x);
      angles.push(a - EPS, a, a + EPS);
    }
  }
  angles.sort((a, b) => a - b);
  const poly: Pt[] = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of all) { const t = rayHit(eye, dx, dy, s); if (t < best) best = t; }
    if (rangeCells != null && best > rangeCells) best = rangeCells;
    if (!isFinite(best)) continue;
    poly.push({ x: eye.x + dx * best, y: eye.y + dy * best });
  }
  return poly;
}

export function tokenVision(t: DndToken, s: DndTabletopState): Pt[] {
  const range = t.sight != null && t.sight > 0 ? t.sight / FEET_PER_CELL : null;
  return visibilityPolygon(tokenCenter(t), s.terrain ?? [], s.map.cols, s.map.rows, (t.elevation ?? 0) + EYE_FT, range);
}

// A token is seen if its centre or any side of its base is in view.
export function tokenSeen(t: DndToken, vision: Pt[][]): boolean {
  const c = tokenCenter(t), r = t.size * 0.4;
  const probes = [c, { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, { x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }];
  return probes.some((p) => vision.some((poly) => pointInPolygon(p, poly)));
}

export type FogViewer = {
  /** Tokens whose eyes this client sees through. */
  viewers: DndToken[];
  vision: Pt[][];
  /** Ids of every token this client may see (viewers included). */
  seen: Set<string>;
};

/** Which tokens are "mine": PCs from my shared sheet, or in my player color. */
export function isMyToken(t: DndToken, myColor: string | null, myCharId: string | null): boolean {
  if (t.kind !== "pc") return false;
  if (myCharId && t.charId === myCharId) return true;
  return !!myColor && t.color.toLowerCase() === myColor.toLowerCase();
}

export function computeFog(s: DndTabletopState, viewers: DndToken[]): FogViewer {
  const vision = viewers.map((t) => tokenVision(t, s));
  const seen = new Set(viewers.map((t) => t.id));
  for (const t of s.tokens) if (!seen.has(t.id) && tokenSeen(t, vision)) seen.add(t.id);
  return { viewers, vision, seen };
}

export type FogMode = "off" | "dm" | "player";
/** What the board draws: the live vision, plus ground explored earlier. */
export type FogView = { mode: "dm" | "player"; vision: Pt[][]; explored: Pt[][]; noViewers: boolean };

/** Does a terrain block touch any of these polygons? (3D: hide unseen blocks.) */
export function terrainSeen(t: DndTerrain, polys: Pt[][]): boolean {
  const outline = terrainOutline(t);
  const c = outline.reduce((a, p) => ({ x: a.x + p.x / outline.length, y: a.y + p.y / outline.length }), { x: 0, y: 0 });
  return [c, ...outline].some((p) => polys.some((poly) => pointInPolygon(p, poly)))
    || polys.some((poly) => poly.some((q) => pointInPolygon(q, outline)));
}

/** SVG path data for a set of polygons (cells scaled by `u`). */
export function polysPath(polys: Pt[][], u: number): string {
  return polys
    .filter((p) => p.length > 2)
    .map((p) => "M" + p.map((q) => `${(q.x * u).toFixed(1)} ${(q.y * u).toFixed(1)}`).join("L") + "Z")
    .join("");
}
