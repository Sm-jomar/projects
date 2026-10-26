// Default 3D models for tabletop pieces, sculpted from smooth primitives:
// lathed torsos and helmets, tapered capsule limbs, swept tubes for necks,
// tails and cables, and bevelled extrusions for vehicle hulls.
//
// Every model is built at unit size (footprint ~1, height ~1) and scaled to
// fit the piece. Limbs and walker legs hang from a pivot group carrying
// userData.swing (+1/-1: which way, and how far, they swing) so the
// take-control walk cycle can animate them; userData.swingBase is the pose
// they swing about (a raised sabre arm, say). Once built, the static parts
// under each pivot are merged by material so a model costs a handful of draw
// calls. The figure faces -z, so its right hand is +x.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type FigureStyle = "rebel" | "imperial" | "clone" | "droid" | "merc" | "pawn";

/** Body shape. "trooper" (the default) is the faction's iconic trooper. */
export type FigureBuild =
  | "trooper"     // faction trooper: rebel, stormtrooper, clone, B1, cloak, pawn
  | "hero"        // bare-headed named character (Han, Leia, an officer, an agent)
  | "robed"       // Jedi / Sith robes
  | "yoda"        // little green Jedi master: big head, long ears
  | "grievous"    // cyborg general: hunched, caped, four sabre arms
  | "vader"       // armoured Sith: helmet and cape
  | "mando"       // Mandalorian armour, T-visor helmet, jetpack
  | "wookiee"
  | "ewok"
  | "insect"      // Geonosian
  | "b2"          // super battle droid
  | "tall-droid"  // IG-88, K-2SO, tactical droids, MagnaGuards, dark troopers
  | "droideka"
  | "astromech"
  | "probe";

export type FigureSpec = {
  build?: FigureBuild;
  /** Commanders get a cape and a sidearm instead of a rifle. */
  commander?: boolean;
  /** Lightsaber blade colours, right hand first. */
  sabers?: string[];
  /** The first sabre is double-bladed. */
  doubleSaber?: boolean;
  /** Back-mounted jetpack (B2 rockets, Mandalorians always have one). */
  jetpack?: boolean;
  /** Overrides the build's own colours. */
  palette?: Partial<Palette>;
};

export type VehicleFrame =
  | "tank"          // treads + turret
  | "hover-tank"    // repulsor hull, engine pods, turret
  | "landspeeder"   // open hover car with a driver
  | "bike"          // speeder bike with a rider
  | "walker"        // AT-ST: two legs and an armoured head
  | "scout-walker"  // AT-RT: two legs and an open seat
  | "airspeeder"    // T-47, fluttercraft
  | "gunship"       // LAAT
  | "crawler";      // crab / spider droid

export type MountKind = "tauntaun" | "dewback" | "boga";

export type PieceModel =
  | ({ kind: "figure"; style: FigureStyle } & FigureSpec)
  | { kind: "rider"; style: FigureStyle; mount: MountKind; pilot?: FigureSpec }
  | { kind: "vehicle"; style: FigureStyle; repulsor: boolean; frame?: VehicleFrame; pilot?: FigureSpec }
  | { kind: "emplacement"; style: FigureStyle }
  | { kind: "marker" }
  | { kind: "stl"; data: string };

/** What buildModel needs to know about the piece. */
export type ModelPiece = {
  footprint: number;
  modelHeight: number;
  color: string;
  accent: string;
  model: PieceModel;
};

type Palette = { body: string; trim: string; dark: string };

const STYLE_COLORS: Record<FigureStyle, Palette> = {
  rebel:    { body: "#b59a6a", trim: "#6b5a3a", dark: "#3a3226" },  // tan fatigues, helmet
  imperial: { body: "#eceff2", trim: "#1b1d22", dark: "#2a2d33" },  // stormtrooper white
  clone:    { body: "#eef0f2", trim: "#d0701e", dark: "#1b1d22" },  // clone white + orange
  droid:    { body: "#c9b48a", trim: "#7a6a4a", dark: "#3d3528" },  // B1 battle droid tan
  merc:     { body: "#6a4e32", trim: "#c79a54", dark: "#2a2018" },  // hooded cloak
  pawn:     { body: "#9aa3b2", trim: "#596273", dark: "#2a2f3a" },
};

// Builds with colours of their own; the rest take the faction's.
const BUILD_COLORS: Partial<Record<FigureBuild, Palette>> = {
  robed:        { body: "#c8b38a", trim: "#6e4f33", dark: "#3e2c1e" },  // Jedi tan + brown
  vader:        { body: "#18181b", trim: "#2a2a30", dark: "#0b0b0d" },
  mando:        { body: "#7d8b96", trim: "#3d4a55", dark: "#1c2228" },
  wookiee:      { body: "#6b4a2b", trim: "#4a3220", dark: "#2a1c12" },
  ewok:         { body: "#7a5a3a", trim: "#a07a4a", dark: "#2e2218" },
  insect:       { body: "#9a7a4a", trim: "#6a5232", dark: "#2e2418" },
  b2:           { body: "#5f6b80", trim: "#3e4757", dark: "#1e232c" },
  "tall-droid": { body: "#4b4f57", trim: "#2c2f35", dark: "#15171a" },
  yoda:         { body: "#b8a88a", trim: "#7a5e3e", dark: "#4a3826" },
  grievous:     { body: "#ddd6c2", trim: "#3a3d44", dark: "#1a1b1e" },
  droideka:     { body: "#8a6a4a", trim: "#5a4430", dark: "#2a2018" },
  astromech:    { body: "#e8ecf0", trim: "#2d5fb0", dark: "#3a3f48" },
  probe:        { body: "#2a2c31", trim: "#4a4d55", dark: "#121316" },
};

const SKIN = "#c99a7a";
const METAL = "#8c939c";
const PI = Math.PI;

export function buildModel(pc: ModelPiece, stl: (d: string) => THREE.BufferGeometry | null): THREE.Object3D {
  const m = pc.model;
  const g = new THREE.Group();
  if (m.kind === "stl") {
    const geom = stl(m.data);
    if (geom) {
      // Double-sided: plenty of STLs have a few faces wound the wrong way,
      // which back-face culling would show as holes.
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: pc.color, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide,
        // Cast shadows from back faces only, or a double-sided mesh shades
        // itself with streaky shadow acne.
        shadowSide: THREE.BackSide,
      }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.setScalar(pc.footprint * 0.95);
      g.add(mesh);
      return g;
    }
    return buildModel({ ...pc, model: { kind: "figure", style: "pawn" } }, stl);
  }
  if (m.kind === "marker") {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 32),
      new THREE.MeshStandardMaterial({ color: pc.color, emissive: pc.color, emissiveIntensity: 0.25 }));
    disc.position.y = 0.06;
    g.add(disc);
    g.scale.setScalar(pc.footprint);
    shadows(g);
    return g;
  }

  const team = { color: pc.color, accent: pc.accent };
  if (m.kind === "figure") g.add(figure(m.style, m, team));
  else if (m.kind === "rider") g.add(rider(m.style, m.mount, m.pilot, team));
  else if (m.kind === "vehicle") g.add(vehicle(m.style, m.frame ?? (m.repulsor ? "hover-tank" : "tank"), m.pilot, team));
  else g.add(emplacement(m.style, team));
  bake(g);
  fit(g, pc.footprint, pc.modelHeight);
  return g;
}

type Team = { color: string; accent: string };
type Mat = THREE.Material;
type Mats = { body: Mat; trim: Mat; dark: Mat; skin: Mat; metal: Mat; colors: Palette };

function mats(style: FigureStyle, spec: FigureSpec, team: Team): Mats {
  const build = spec.build ?? "trooper";
  let p = BUILD_COLORS[build] ?? STYLE_COLORS[style];
  if (build === "trooper" && style === "pawn") p = { ...p, body: team.color, trim: team.accent };
  if (build === "hero") p = { body: team.color, trim: STYLE_COLORS[style].dark, dark: "#2a2622" };
  if (build === "mando") p = { ...p, trim: team.color };
  p = { ...p, ...spec.palette };
  return {
    body: std(p.body), trim: std(p.trim), dark: std(p.dark),
    skin: std(SKIN), metal: std(METAL), colors: p,
  };
}

// --- Shapes -------------------------------------------------------------------

type P2 = [number, number];
type P3 = [number, number, number];

/** A surface of revolution about y through [radius, y] points, bottom to
 * top, smoothed through a spline when `smooth` names a point count. `depth`
 * squashes it front to back. */
function lathe(pts: P2[], { depth = 1, seg = 20, smooth = 0, phi = 0, arc = PI * 2 } = {}): THREE.BufferGeometry {
  let v = pts.map(([r, y]) => new THREE.Vector2(r, y));
  if (smooth) v = new THREE.SplineCurve(v).getPoints(Math.ceil(smooth * 0.6)).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const g = new THREE.LatheGeometry(v, seg, phi, arc);
  if (depth !== 1) g.scale(1, 1, depth);
  return g;
}

/** A capsule hanging down from the origin, `len` long, tapering r1 to r2. */
function limb(r1: number, r2: number, len: number, seg = detail(r1, 8, 12)): THREE.BufferGeometry {
  const pts: P2[] = [];
  for (let i = 0; i <= 3; i++) {
    const a = -PI / 2 + (i / 3) * (PI / 2);
    pts.push([Math.cos(a) * r2, -len + Math.sin(a) * r2]);
  }
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * (PI / 2);
    pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  return lathe(pts, { seg });
}

// Small parts get fewer segments: nobody sees the facets on an eye.
function detail(r: number, lo = 8, hi = 18): number {
  return Math.max(lo, Math.min(hi, Math.round(r * 160)));
}

function ell(rx: number, ry: number, rz: number, w = detail(Math.max(rx, ry, rz)), h = Math.max(6, Math.round(w * 0.7))): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}

/** Part of a sphere: theta runs from the top (0) to the bottom (PI). */
function dome(rx: number, ry: number, rz: number, from = 0, to = PI / 2, w = 18): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, w, 10, 0, PI * 2, from, to - from).scale(rx, ry, rz);
}

function rbox(w: number, h: number, d: number, r = 0.015): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 1, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
}

function cyl(r1: number, r2: number, h: number, seg = detail(Math.max(r1, r2), 6, 16)): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r2, h, seg);
}

/** A tube through `pts`, tapering from r0 to r1. */
function sweep(pts: P3[], r0: number, r1 = r0, seg = 16, radial = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return g;
}

/** A side profile ([forward, y] points) extruded `width` across, bevelled. */
function prism(profile: P2[], width: number, bevel = 0.015): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([f, y]) => new THREE.Vector2(f, y)));
  const depth = Math.max(0.001, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(PI / 2);
  return g;
}

/** A top-view outline ([x, forward] points, smoothed closed) extruded up
 * from y = 0, bevelled. */
function plate(outline: P2[], thick: number, bevel = 0.02, smooth = true): THREE.BufferGeometry {
  let pts = outline.map(([x, f]) => new THREE.Vector2(x, f));
  if (smooth) {
    pts = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)), true)
      .getPoints(64).slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y));
  }
  const depth = Math.max(0.001, thick - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
  });
  g.rotateX(-PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** A lathe shape lying along z, nose at z = 0 running back to +z. */
function nacelle(pts: P2[], opts: { depth?: number; seg?: number; smooth?: number } = {}): THREE.BufferGeometry {
  return lathe(pts, opts).rotateX(PI / 2);
}

// Ripple a lathed skirt into cloth folds, deepening towards the hem.
function folds(g: THREE.BufferGeometry, n: number, amp: number, hem: number, top: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.min(1, Math.max(0, (top - y) / (top - hem)));
    const k = 1 + amp * t * Math.sin(Math.atan2(x, z) * n);
    p.setXYZ(i, x * k, y, z * k);
  }
  return smoothNormals(g);
}

// Rough the surface up into shaggy fur.
function fur(g: THREE.BufferGeometry, amp: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = hash(Math.round(x * 400), Math.round(y * 400), Math.round(z * 400)) - 0.5;
    const streak = Math.sin(y * 90 + Math.atan2(x, z) * 7) * 0.5;
    const k = 1 + amp * (n + streak * 0.6);
    p.setXYZ(i, x * k, y + amp * n * 0.02, z * k);
  }
  return smoothNormals(g);
}

function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- Scene graph --------------------------------------------------------------

function grp(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: Mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Both sides of a symmetrical part: f(side) with side = +1 (right), -1.
function pair(f: (s: number) => void) { f(1); f(-1); }

function pivot(parent: THREE.Object3D, x: number, y: number, z: number, swing: number): THREE.Group {
  const p = grp(parent, x, y, z);
  p.userData.swing = swing;
  return p;
}

function glow(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return opacity < 1
    ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    : new THREE.MeshBasicMaterial({ color });
}

function lit(m: THREE.Mesh): THREE.Mesh {
  m.userData.glow = true;
  return m;
}

function glass(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: "#9fd0ff", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false });
}

// --- Humanoids ----------------------------------------------------------------

type Rig = {
  hipY: number; hipX: number; shoulderY: number; shoulderX: number;
  /** Thigh, shin, upper arm and forearm radii. */
  thigh: number; shin: number; upper: number; fore: number;
  legMat: Mat; shinMat?: Mat; bootMat?: Mat; jointMat?: Mat;
  armMat: Mat; foreMat?: Mat; handMat?: Mat;
  /** Robes hide the legs, so don't hang any. */
  noLegs?: boolean;
  /** Boot size. */
  foot?: number;
  /** Arm length against the torso (1 = to mid-thigh). */
  reach?: number;
};

type Arm = { pivot: THREE.Group; elbow: THREE.Group; hand: THREE.Group; side: number };

// Two legs from the hips and two arms from the shoulders. Each pivots at the
// top so the walk cycle can swing it, with a knee or elbow part way down.
function rig(g: THREE.Group, r: Rig): [Arm, Arm] {
  if (!r.noLegs) pair((s) => {
    const hip = pivot(g, s * r.hipX, r.hipY, 0, s);
    hip.userData.leg = true;
    const foot = (r.foot ?? 1) * 1.15;
    const ankle = 0.045 * foot;
    const L1 = r.hipY * 0.48, L2 = r.hipY - L1 - ankle;
    put(hip, limb(r.thigh, r.thigh * 0.78, L1), r.legMat);
    const knee = grp(hip, 0, -L1, 0);
    hip.userData.knee = knee;
    if (r.jointMat) put(knee, ell(r.thigh * 0.85, r.thigh * 0.8, r.thigh * 0.85), r.jointMat, 0, 0, -r.thigh * 0.15);
    put(knee, limb(r.shin, r.shin * 0.72, L2), r.shinMat ?? r.legMat);
    // Boot: a rounded wedge with the toe forward, sole flat on the ground.
    const boot = r.bootMat ?? r.shinMat ?? r.legMat;
    put(knee, lathe([[0, 0], [r.shin * 1.15, 0.004], [r.shin * 1.2, ankle * 0.7], [r.shin * 0.95, ankle * 1.5], [0, ankle * 1.6]], { smooth: 10, seg: 14 })
      .scale(1, 1, 1.5 * foot).translate(0, 0, -r.shin * 0.45 * foot), boot, 0, -L2 - ankle, 0);
  });
  const arms = [1, -1].map((s) => {
    const sh = pivot(g, s * r.shoulderX * 1.1, r.shoulderY, 0, -s);
    const reach = (r.shoulderY - r.hipY) * (r.reach ?? 1.05);
    const U = reach * 0.52, F = reach * 0.42;
    put(sh, limb(r.upper, r.upper * 0.85, U), r.armMat);
    const elbow = grp(sh, 0, -U, 0);
    if (r.jointMat) put(elbow, ell(r.upper * 0.8, r.upper * 0.8, r.upper * 0.8), r.jointMat);
    put(elbow, limb(r.fore, r.fore * 0.78, F), r.foreMat ?? r.armMat);
    const hand = grp(elbow, 0, -F - r.fore * 0.5, 0);
    put(hand, ell(r.fore * 0.85 * BIG_HANDS, r.fore * 1.05 * BIG_HANDS, r.fore * 0.95 * BIG_HANDS), r.handMat ?? r.foreMat ?? r.armMat);
    return { pivot: sh, elbow, hand, side: s };
  });
  // A natural stance: arms a touch out and bent.
  pose(arms[0], 0.05, 0.25, 0.12);
  pose(arms[1], 0.05, 0.25, 0.12);
  return [arms[0], arms[1]];
}

// Raise an arm forward (the walk cycle swings it about that pose), bend the
// elbow and splay it out (negative brings the hand across the body).
function pose(a: Arm, shoulder: number, elbow: number, splay = 0) {
  a.pivot.userData.swingBase = shoulder;
  a.pivot.rotation.x = shoulder;
  a.pivot.rotation.z = a.side * splay;
  a.elbow.rotation.x = elbow;
  a.hand.userData.pitch = shoulder + elbow;
}

// Put something in a hand, pitched `pitch` from straight up (things are
// modelled pointing up the hand's +y; -PI/2 points them forward).
function hold(a: Arm, o: THREE.Object3D, pitch: number) {
  o.rotation.x = pitch - ((a.hand.userData.pitch as number | undefined) ?? 0);
  a.hand.add(o);
}

/** A torso lathed from waist and chest radii, oval in section. */
function torso(g: THREE.Object3D, mat: Mat, hipY: number, shoulderY: number, waist: number, chest: number, depth = 0.66) {
  const h = shoulderY - hipY;
  waist *= 0.88;
  return put(g, lathe([
    [0, hipY - 0.04], [waist * 0.9, hipY - 0.035], [waist * 1.08, hipY + h * 0.05], [waist, hipY + h * 0.35],
    [chest * 0.97, hipY + h * 0.72], [chest, hipY + h * 0.9], [chest * 0.75, shoulderY + 0.012],
    [0.045, shoulderY + 0.03], [0, shoulderY + 0.032],
  ], { depth, smooth: 28 }), mat);
}

// --- Hand-held kit -----------------------------------------------------------

/** A blaster rifle along +y, grip at the origin. */
function rifle(m: Mats, len = 0.46, body: Mat = m.dark): THREE.Group {
  const r = new THREE.Group();
  put(r, rbox(0.032, len * 0.5, 0.05, 0.01), body, 0, len * 0.12, 0.015);       // receiver
  put(r, cyl(0.014, 0.014, len * 0.42, 8), body, 0, len * 0.55, 0.02);          // barrel
  put(r, cyl(0.017, 0.017, len * 0.06, 8), m.metal, 0, len * 0.74, 0.02);       // muzzle
  put(r, cyl(0.012, 0.012, len * 0.22, 8), m.metal, 0, len * 0.18, 0.05);       // scope
  put(r, rbox(0.022, len * 0.24, 0.04, 0.008), body, 0, -len * 0.2, 0.0, -0.15); // stock
  put(r, rbox(0.02, 0.025, 0.06, 0.006), body, 0, 0, -0.025);                   // grip
  return r;
}

function pistol(m: Mats): THREE.Group {
  const p = new THREE.Group();
  put(p, rbox(0.03, 0.12, 0.04, 0.008), m.dark, 0, 0.04, 0.015);
  put(p, cyl(0.01, 0.012, 0.06, 8), m.metal, 0, 0.12, 0.02);
  put(p, rbox(0.024, 0.02, 0.06, 0.006), m.dark, 0, -0.005, -0.015);
  return p;
}

/** A lightsabre along +y: hilt in the hand, a white core in a coloured glow. */
function saber(color: string, double = false): THREE.Group {
  const s = new THREE.Group();
  const hilt = double ? 0.17 : 0.1;
  put(s, cyl(0.02, 0.02, hilt, 10), std(METAL));
  for (const y of [-hilt * 0.25, hilt * 0.15]) put(s, cyl(0.023, 0.023, 0.018, 10), std("#1a1a1c"), 0, y, 0);
  const core = glow("#ffffff");
  const halo = glow(color, 0.5);
  for (const dir of double ? [1, -1] : [1]) {
    const y = dir * (hilt / 2 + 0.26);
    lit(put(s, new THREE.CapsuleGeometry(0.013, 0.5, 4, 8), core, 0, y, 0));
    lit(put(s, new THREE.CapsuleGeometry(0.03, 0.51, 4, 12), halo, 0, y, 0));
  }
  return s;
}

// The figure's weapons: sabres if it has any, else a sidearm for
// commanders and characters, else a rifle held at the ready.
function arm(armR: Arm, armL: Arm, spec: FigureSpec, m: Mats, rifleOf?: () => THREE.Object3D) {
  const sabers = spec.sabers ?? [];
  if (sabers.length) {
    if (spec.doubleSaber) {
      // Staff held across the body, both hands on it.
      pose(armR, 0.55, 0.9, -0.1);
      pose(armL, 0.45, 0.9, 0.15);
      const st = saber(sabers[0], true);
      st.rotation.z = 1.15;
      hold(armR, st, -0.2);
    } else if (sabers[1]) {
      // Two blades: one raised high, one low and out.
      pose(armR, 0.5, 1.0, 0.1);
      hold(armR, saber(sabers[0]), -0.15);
      pose(armL, 0.35, 0.5, 0.35);
      hold(armL, saber(sabers[1]), -1.25);
    } else {
      // Guard stance: blade up and forward, off hand out for balance.
      pose(armR, 0.65, 0.85, -0.05);
      hold(armR, saber(sabers[0]), -0.35);
      pose(armL, 0.25, 0.6, 0.2);
    }
    armR.pivot.userData.swing = -0.5;
    armL.pivot.userData.swing = 0.6;
  } else if (spec.commander && rifleOf) {
    // Officer's sidearm aimed forward, off hand down at the side.
    pose(armR, 1.2, 0.2, -0.05);
    hold(armR, pistol(m), -PI / 2 + 0.05);
    pose(armL, 0.08, 0.3, 0.12);
    armR.pivot.userData.swing = -0.25;
  } else if (spec.commander || !rifleOf) {
    // Sidearm held up by the shoulder, ready.
    pose(armR, 0.3, 1.95, -0.1);
    hold(armR, pistol(m), 0.15);
    pose(armL, 0.08, 0.3, 0.12);
    armR.pivot.userData.swing = -0.3;
  } else {
    // Rifle at the ready: right hand on the grip, left on the barrel.
    pose(armR, 0.35, 1.1, -0.2);
    hold(armR, rifleOf(), -PI / 2 + 0.1);
    pose(armL, 0.55, 0.95, -0.45);
    armR.pivot.userData.swing = -0.2;
    armL.pivot.userData.swing = 0.2;
  }
}

function cape(g: THREE.Object3D, mat: Mat, top: number, width: number, z: number, length = top - 0.04) {
  // A quarter-cylinder sheet hanging from the shoulders, rippled into folds.
  const geo = lathe([[width * 0.55, top - length], [width * 0.5, top - length * 0.5], [width * 0.42, top - 0.02], [width * 0.3, top]],
    { phi: -PI * 0.32, arc: PI * 0.64, smooth: 16, seg: 24 });
  const m = put(g, folds(geo, 6, 0.08, top - length, top), mat, 0, 0, z - width * 0.25);
  (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return m;
}

function jetpack(g: THREE.Object3D, m: Mats, y: number, z: number) {
  put(g, rbox(0.17, 0.16, 0.07, 0.025), m.dark, 0, y, z);
  pair((s) => {
    put(g, lathe([[0, -0.1], [0.03, -0.1], [0.045, -0.06], [0.045, 0.07], [0.03, 0.11], [0, 0.12]], { smooth: 14, seg: 14 }), m.trim, s * 0.065, y, z + 0.05);
    put(g, cyl(0.035, 0.025, 0.03, 10), m.metal, s * 0.065, y - 0.115, z + 0.05);
  });
}

export function figure(style: FigureStyle, spec: FigureSpec, team: Team): THREE.Group {
  const build = spec.build ?? "trooper";
  const m = mats(style, spec, team);
  switch (build) {
    case "hero": return hero(m, spec, team);
    case "robed": return robed(m, spec);
    case "yoda": return yoda(m, spec);
    case "grievous": return grievous(m, spec);
    case "vader": return vader(m, spec);
    case "mando": return mando(m, spec, team);
    case "wookiee": return wookiee(m, spec);
    case "ewok": return ewok(m);
    case "insect": return insect(m);
    case "b2": return b2(m, spec);
    case "tall-droid": return tallDroid(m, spec, team);
    case "droideka": return droideka(m);
    case "astromech": return astromech(m);
    case "probe": return probe(m);
    default: return trooper(style, m, spec, team);
  }
}

// Shared humanoid proportions.
const HIP = 0.45, SH = 0.75, HEAD = 0.875;
// Animated-show proportions: oversized heads and hands, a broad chest over
// a narrow waist.
const BIG_HEAD = 1.22, BIG_HANDS = 1.25;

// A head group at height y, scaled up the cartoon way and sat on the neck.
function headGroup(g: THREE.Object3D, y: number): THREE.Group {
  const h = grp(g, 0, y + 0.022, 0);
  h.scale.setScalar(BIG_HEAD);
  return h;
}

// The faction's own trooper. Each style changes the silhouette so a glance
// tells you whose unit it is.
function trooper(style: FigureStyle, m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const { body, trim, dark } = m;
  const g = new THREE.Group();

  if (style === "pawn") {
    put(g, lathe([[0, 0], [0.34, 0], [0.35, 0.05], [0.3, 0.1], [0.2, 0.2], [0.13, 0.45], [0.12, 0.6], [0.2, 0.64],
      [0.2, 0.66], [0.12, 0.68], [0.15, 0.74]], { smooth: 40, seg: 28 }), body);
    put(g, ell(0.19, 0.19, 0.19, 24, 18), body, 0, 0.86, 0);
    put(g, new THREE.TorusGeometry(0.19, 0.022, 10, 32), trim, 0, 0.66, 0, PI / 2);
    return g;
  }

  if (style === "merc") return merc(m, spec);
  if (style === "droid") return b1(m, spec);

  // Humanoid troopers: rebel, imperial, clone.
  const armour = style !== "rebel";
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0.075, shoulderY: SH, shoulderX: 0.155,
    thigh: 0.056, shin: 0.045, upper: 0.042, fore: 0.038,
    legMat: style === "rebel" ? trim : body, bootMat: style === "rebel" ? dark : body,
    jointMat: armour ? dark : undefined, armMat: body,
    handMat: armour ? dark : m.skin,
  });
  torso(g, armour ? dark : body, HIP, SH, 0.095, 0.13);
  put(g, cyl(0.035, 0.04, 0.06, 12), armour ? dark : m.skin, 0, SH + 0.04, 0); // neck
  arm(armR, armL, spec, m, () => rifle(m, style === "rebel" ? 0.5 : 0.44));

  if (style === "rebel") {
    // Fatigues, a padded vest, field pack with a bedroll, brimmed helmet.
    const vest = put(g, lathe([[0.112, HIP + 0.08], [0.142, HIP + 0.2], [0.148, SH - 0.06], [0.12, SH - 0.0]],
      { depth: 0.72, smooth: 12, phi: PI + 0.3, arc: PI * 2 - 0.6 }), dark);
    (vest.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    put(g, lathe([[0.1, HIP - 0.01], [0.105, HIP + 0.04]], { depth: 0.72 }), std("#3a2a1a"), 0, 0, 0); // belt
    pair((s) => put(g, rbox(0.05, 0.05, 0.03, 0.01), std("#4a3a26"), s * 0.06, HIP + 0.02, -0.075)); // pouches
    if (!spec.commander) {
      put(g, rbox(0.2, 0.2, 0.09, 0.03), std("#5a4a30"), 0, SH - 0.1, 0.11);
      put(g, cyl(0.04, 0.04, 0.22, 12), std("#7a6a48"), 0, SH - 0.0, 0.12, 0, 0, PI / 2); // bedroll
    }
    const h = head(g, m, HEAD);
    // Helmet: a rounded dome with a turned-down brim.
    put(h, lathe([[0.112, -0.012], [0.114, -0.004], [0.094, 0.004], [0.094, 0.04], [0.08, 0.08], [0.04, 0.1], [0, 0.104]],
      { smooth: 18, seg: 24 }), trim, 0, 0.035, 0.008);
    put(h, sweep([[-0.085, 0.085, -0.03], [0, 0.095, -0.1], [0.085, 0.085, -0.03]], 0.012, 0.012, 10, 8), std("#2a2a2a")); // goggles
  } else if (style === "imperial") {
    // White plates over the black body glove.
    put(g, lathe([[0.1, SH - 0.2], [0.135, SH - 0.13], [0.138, SH - 0.05], [0.115, SH], [0.06, SH + 0.025]], { depth: 0.7, smooth: 14 }), body); // chest
    for (const y of [HIP + 0.1, HIP + 0.14]) put(g, rbox(0.11, 0.03, 0.06, 0.01), body, 0, y, -0.035); // ab plates
    put(g, lathe([[0.1, HIP - 0.035], [0.112, HIP - 0.01], [0.11, HIP + 0.04], [0.098, HIP + 0.05]], { depth: 0.72, smooth: 10 }), body); // belt
    pair((s) => put(g, rbox(0.035, 0.035, 0.03, 0.008), body, s * 0.05, HIP + 0.01, -0.08)); // belt boxes
    put(g, cyl(0.025, 0.025, 0.07, 10), m.metal, -0.06, HIP + 0.005, 0.07, 0, 0, PI / 2); // detonator
    pair((s) => put(g, dome(0.06, 0.05, 0.06), body, s * 0.15, SH - 0.005, 0, 0, 0, -s * 0.35)); // shoulder bells
    if (!spec.commander) put(g, rbox(0.15, 0.08, 0.06, 0.02), body, 0, SH - 0.08, 0.09); // backpack
    stormHelmet(g, m, HEAD);
  } else {
    // Clone: plates over the body glove, a T-visor and the unit's markings.
    put(g, lathe([[0.1, SH - 0.2], [0.135, SH - 0.13], [0.138, SH - 0.05], [0.115, SH], [0.06, SH + 0.025]], { depth: 0.7, smooth: 14 }), body);
    put(g, rbox(0.15, 0.1, 0.06, 0.015), body, 0, HIP + 0.1, -0.03);
    put(g, lathe([[0.1, HIP - 0.035], [0.11, HIP - 0.01], [0.108, HIP + 0.04], [0.096, HIP + 0.05]], { depth: 0.72, smooth: 10 }), body);
    put(g, rbox(0.1, 0.02, 0.01, 0.004), trim, 0, SH - 0.06, -0.093); // chest stripe
    pair((s) => put(g, dome(0.058, 0.045, 0.06), s > 0 ? body : trim, s * 0.15, SH - 0.005, 0, 0, 0, -s * 0.35));
    if (!spec.commander) put(g, rbox(0.15, 0.1, 0.06, 0.02), body, 0, SH - 0.09, 0.09);
    cloneHelmet(g, m, HEAD, !!spec.commander);
    if (spec.commander) {
      // Command kama over the hips.
      const kama = put(g, folds(lathe([[0.15, HIP - 0.17], [0.13, HIP - 0.06], [0.112, HIP + 0.03]],
        { phi: PI + 0.5, arc: PI * 2 - 1.0, smooth: 10, seg: 24 }), 6, 0.06, HIP - 0.17, HIP + 0.03), trim);
      (kama.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
  }
  if (spec.commander) cape(g, std(team.accent), SH + 0.02, 0.3, 0.06, 0.5);
  return g;
}

// A bare head: skin, eyes, a nose and hair.
function head(g: THREE.Object3D, m: Mats, y: number, hair?: Mat) {
  const h = headGroup(g, y);
  // An egg, narrowing to the chin.
  put(h, lathe([[0, -0.092], [0.035, -0.088], [0.058, -0.055], [0.07, -0.005], [0.072, 0.035], [0.055, 0.075], [0, 0.092]],
    { depth: 1.12, smooth: 16, seg: 18 }), m.skin);
  pair((s) => put(h, ell(0.012, 0.022, 0.012), m.skin, s * 0.071, -0.005, 0.0)); // ears
  pair((s) => put(h, ell(0.011, 0.008, 0.006), std("#1a1410"), s * 0.027, 0.012, -0.074));
  put(h, ell(0.012, 0.018, 0.014), m.skin, 0, -0.008, -0.08); // nose
  if (hair) {
    put(h, dome(0.078, 0.078, 0.088), hair, 0, 0.022, 0.004);
    put(h, ell(0.07, 0.072, 0.06), hair, 0, -0.005, 0.03); // back and sides
  }
  return h;
}

function stormHelmet(g: THREE.Object3D, m: Mats, y: number) {
  const h = headGroup(g, y);
  const black = std("#16171a");
  put(h, dome(0.093, 0.1, 0.1), m.body, 0, 0.005, 0.005); // dome
  // The mask: wide cheeks flaring to a lip, narrowing at the chin.
  put(h, lathe([[0.075, -0.09], [0.098, -0.07], [0.1, -0.02], [0.095, 0.01]], { smooth: 12, seg: 22 }).scale(1, 1, 1.05), m.body, 0, 0, 0);
  put(h, ell(0.05, 0.04, 0.03), m.body, 0, -0.06, -0.08); // snout
  pair((s) => put(h, ell(0.03, 0.022, 0.012), black, s * 0.036, 0.0, -0.088, 0, s * 0.35, s * 0.3)); // eye lenses
  put(h, rbox(0.04, 0.02, 0.012, 0.005), black, 0, -0.075, -0.106); // grille
  pair((s) => put(h, cyl(0.012, 0.012, 0.03, 10), std("#8a8f99"), s * 0.03, -0.075, -0.098, PI / 2)); // breathers
  pair((s) => put(h, cyl(0.022, 0.022, 0.012, 14), std("#8a8f99"), s * 0.098, -0.02, 0.0, 0, 0, PI / 2)); // ears
  put(h, rbox(0.12, 0.01, 0.005, 0.002), std("#5b6370"), 0, 0.03, -0.098); // brow
}

function cloneHelmet(g: THREE.Object3D, m: Mats, y: number, commander: boolean) {
  const h = headGroup(g, y);
  const black = std("#16171a");
  put(h, dome(0.09, 0.1, 0.098), m.body, 0, 0.005, 0.005);
  put(h, lathe([[0.08, -0.095], [0.095, -0.08], [0.095, -0.0], [0.09, 0.01]], { smooth: 10, seg: 22 }), m.body);
  put(h, rbox(0.11, 0.024, 0.02, 0.006), black, 0, 0.01, -0.088); // T-visor
  put(h, rbox(0.032, 0.07, 0.02, 0.006), black, 0, -0.025, -0.09);
  put(h, rbox(0.012, 0.05, 0.016, 0.004), std("#5b6370"), 0, -0.075, -0.095); // vocoder
  put(h, rbox(0.012, 0.06, 0.15, 0.005), m.trim, 0, 0.1, 0.0); // crest
  pair((s) => put(h, rbox(0.05, 0.012, 0.012, 0.004), m.trim, s * 0.05, 0.05, -0.08, 0, 0, s * 0.3)); // markings
  pair((s) => put(h, cyl(0.02, 0.02, 0.01, 14), std("#8a8f99"), s * 0.093, -0.02, 0, 0, 0, PI / 2));
  if (commander) {
    put(h, cyl(0.007, 0.007, 0.1, 8), m.dark, 0.1, 0.05, -0.0); // rangefinder
    put(h, rbox(0.01, 0.025, 0.04, 0.004), m.dark, 0.1, 0.0, -0.04);
  }
}

// Named characters and officers: bare head with hair, a jacket over a shirt.
function hero(m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0.07, shoulderY: SH, shoulderX: 0.15,
    thigh: 0.052, shin: 0.042, upper: 0.04, fore: 0.035,
    legMat: m.dark, bootMat: std("#1e1a16"), armMat: m.body, foreMat: m.body, handMat: m.skin,
  });
  torso(g, m.body, HIP, SH, 0.09, 0.125);
  put(g, rbox(0.045, 0.17, 0.012, 0.005), std("#d9d2c0"), 0, SH - 0.08, -0.079); // shirt
  pair((s) => put(g, rbox(0.03, 0.2, 0.014, 0.006), m.body, s * 0.045, SH - 0.08, -0.078, 0.05, 0, s * 0.28)); // lapels
  put(g, lathe([[0.096, HIP - 0.01], [0.1, HIP + 0.03]], { depth: 0.72 }), m.trim); // belt
  put(g, rbox(0.035, 0.025, 0.01, 0.004), std("#c8a850"), 0, HIP + 0.01, -0.073); // buckle
  put(g, rbox(0.035, 0.08, 0.04, 0.01), std("#2a2018"), 0.1, HIP - 0.04, 0.0); // holster
  put(g, cyl(0.035, 0.04, 0.06, 12), m.skin, 0, SH + 0.04, 0);
  head(g, m, HEAD, std("#3a2a1c"));
  arm(armR, armL, spec, m);
  if (spec.commander) cape(g, std(team.accent), SH + 0.02, 0.29, 0.06, 0.5);
  return g;
}

// Hooded mercenaries: a long cloak with rifle and arms showing.
function merc(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0.07, shoulderY: SH, shoulderX: 0.15,
    thigh: 0.05, shin: 0.042, upper: 0.044, fore: 0.038,
    legMat: m.dark, armMat: m.body, handMat: std("#2a2420"), noLegs: true,
  });
  put(g, folds(lathe([[0.2, 0], [0.19, 0.06], [0.15, 0.3], [0.12, 0.52], [0.14, 0.66], [0.13, SH], [0.06, SH + 0.03], [0, SH + 0.035]],
    { depth: 0.85, smooth: 30, seg: 28 }), 9, 0.07, 0, 0.55), m.body);
  put(g, lathe([[0.112, HIP], [0.118, HIP + 0.04]], { depth: 0.85 }), m.trim); // sash
  pair((s) => put(g, rbox(0.04, 0.05, 0.03, 0.008), m.dark, s * 0.07, HIP + 0.0, -0.09)); // pouches
  // Face in shadow under a deep hood.
  const hd = headGroup(g, HEAD);
  put(hd, ell(0.065, 0.08, 0.07), std("#1a1512"), 0, -0.005, -0.01);
  const hood = put(hd, new THREE.SphereGeometry(1, 20, 12, PI * 1.5 + 0.7, PI * 2 - 1.4, 0, PI * 0.62).scale(0.1, 0.12, 0.11),
    m.body, 0, -0.01, 0.0, 0.25);
  (hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  put(g, sweep([[-0.1, HEAD - 0.06, -0.02], [0, HEAD - 0.13, -0.07], [0.1, HEAD - 0.06, -0.02]], 0.03, 0.03, 10, 8), m.body); // cowl
  pair((s) => put(hd, ell(0.012, 0.008, 0.006), glow("#e0c070"), s * 0.024, 0.005, -0.075)); // eye glint
  if (spec.commander) put(g, ell(0.022, 0.022, 0.01), std("#e0b84a"), 0.05, SH - 0.04, -0.09); // clasp
  arm(armR, armL, spec, m, () => rifle(m, 0.5, std("#2a2420")));
  return g;
}

// B1 battle droid: spindly limbs, a narrow ribbed torso, long snouted head.
function b1(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.44, hipX: 0.06, shoulderY: 0.7, shoulderX: 0.12,
    thigh: 0.022, shin: 0.02, upper: 0.019, fore: 0.018,
    legMat: m.body, jointMat: m.trim, armMat: m.body, handMat: m.trim, foot: 0.75, reach: 1.25,
  });
  put(g, ell(0.07, 0.04, 0.05), m.body, 0, 0.44, 0); // pelvis
  put(g, cyl(0.02, 0.02, 0.12, 8), m.trim, 0, 0.5, 0.0); // spine
  put(g, lathe([[0.04, 0.53], [0.1, 0.6], [0.105, 0.66], [0.08, 0.71], [0.03, 0.72]], { depth: 0.5, smooth: 14 }), m.body, 0, 0, -0.005); // chest
  for (const y of [0.58, 0.62, 0.66]) put(g, rbox(0.15, 0.008, 0.01, 0.003), m.trim, 0, y, -0.05); // ribs
  put(g, ell(0.05, 0.06, 0.05), m.body, 0, 0.66, 0.06); // backpack
  put(g, cyl(0.012, 0.012, 0.12, 8), m.trim, 0, 0.77, 0.0, 0.2); // neck
  // Head: a long, forward-leaning snout.
  const h = grp(g, 0, 0.83, -0.02);
  h.rotation.x = -0.5;
  put(h, lathe([[0, -0.03], [0.03, -0.02], [0.045, 0.04], [0.04, 0.11], [0.025, 0.16], [0, 0.17]], { smooth: 16, seg: 16, depth: 0.9 }), m.body, 0, 0, 0, -PI / 2 + 0.5);
  pair((s) => put(h, ell(0.015, 0.015, 0.012), m.dark, s * 0.032, 0.02, -0.02));
  if (spec.commander) {
    // Command droid: yellow markings and a long antenna.
    put(g, lathe([[0.075, 0.62], [0.105, 0.66], [0.08, 0.71]], { depth: 0.52, smooth: 8 }), std("#d8b23a"), 0, 0, -0.006);
    put(h, cyl(0.004, 0.004, 0.2, 6), m.dark, -0.03, 0.1, 0.03);
  }
  arm(armR, armL, spec, m, () => {
    // E-5: long, thin, with a curved stock.
    const r = new THREE.Group();
    put(r, cyl(0.011, 0.011, 0.3, 8), m.dark, 0, 0.12, 0.02);
    put(r, rbox(0.022, 0.12, 0.04, 0.008), m.dark, 0, 0.0, 0.015);
    put(r, sweep([[0, -0.05, 0.015], [0, -0.12, 0.0], [0, -0.17, -0.03]], 0.012, 0.01, 8, 6), m.dark);
    return r;
  });
  return g;
}

// Jedi and Sith: a long robe over hidden legs, wide sleeves, a sabre or two.
function robed(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0, shoulderY: SH, shoulderX: 0.15,
    thigh: 0, shin: 0, upper: 0.042, fore: 0.036,
    legMat: m.body, armMat: m.body, handMat: m.skin, noLegs: true,
  });
  // Robe: flared skirt, narrow waist, broad shoulders, rippled at the hem.
  put(g, folds(lathe([[0.21, 0], [0.2, 0.04], [0.16, 0.2], [0.12, HIP], [0.11, HIP + 0.08], [0.13, SH - 0.1], [0.135, SH - 0.03],
    [0.1, SH + 0.01], [0.04, SH + 0.03], [0, SH + 0.032]], { depth: 0.82, smooth: 36, seg: 28 }), 10, 0.07, 0, HIP), m.body);
  // Over-tunic crossing at the chest, tabards and a wide sash.
  pair((s) => put(g, rbox(0.07, 0.24, 0.012, 0.005), m.trim, s * 0.035, SH - 0.1, -0.086, 0.06, 0, -s * 0.35));
  put(g, lathe([[0.112, HIP], [0.12, HIP + 0.02], [0.118, HIP + 0.06], [0.11, HIP + 0.08]], { depth: 0.84, smooth: 10 }), m.dark);
  put(g, rbox(0.06, 0.28, 0.01, 0.004), m.trim, 0, HIP - 0.14, -0.11, 0.1);
  // Wide sleeves around the forearms.
  for (const a of [armR, armL]) {
    const el = a.elbow;
    put(el, lathe([[0.04, 0.02], [0.05, -0.05], [0.065, -0.12], [0.06, -0.135]], { smooth: 10, seg: 16 }), m.body);
  }
  // Hood down over the shoulders, a cloak hanging behind.
  put(g, sweep([[-0.12, SH + 0.0, 0.0], [-0.07, SH + 0.04, 0.07], [0, SH + 0.05, 0.09], [0.07, SH + 0.04, 0.07], [0.12, SH, 0]], 0.04, 0.04, 16, 10), m.trim);
  cape(g, m.trim, SH + 0.02, 0.36, 0.0, SH);
  put(g, cyl(0.032, 0.038, 0.06, 12), m.skin, 0, SH + 0.04, 0);
  head(g, m, HEAD + 0.01, m.dark);
  arm(armR, armL, spec, m);
  return g;
}

// Vader: flared helmet and mask, chest box, cape to the floor.
function vader(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const gloss = std("#121214");
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0.075, shoulderY: SH, shoulderX: 0.16,
    thigh: 0.058, shin: 0.048, upper: 0.046, fore: 0.042,
    legMat: m.body, armMat: m.body, handMat: gloss, noLegs: true,
  });
  put(g, folds(lathe([[0.19, 0], [0.18, 0.06], [0.15, 0.25], [0.12, HIP], [0.115, HIP + 0.1], [0.145, SH - 0.06],
    [0.13, SH + 0.005], [0.05, SH + 0.03], [0, SH + 0.032]], { depth: 0.8, smooth: 30, seg: 28 }), 8, 0.05, 0, HIP), m.body);
  pair((s) => put(g, dome(0.065, 0.05, 0.07), gloss, s * 0.15, SH - 0.01, 0, 0, 0, -s * 0.3)); // shoulder armour
  put(g, lathe([[0.112, HIP - 0.01], [0.12, HIP + 0.04]], { depth: 0.8 }), gloss); // belt
  pair((s) => put(g, rbox(0.03, 0.035, 0.012, 0.004), std(METAL), s * 0.04, HIP + 0.015, -0.1));
  put(g, rbox(0.1, 0.075, 0.02, 0.006), std("#3a3a40"), 0, SH - 0.1, -0.095); // chest box
  [["#d03a2a", -0.025], ["#3a8ad0", 0], ["#3ac05a", 0.025]].forEach(([c, x]) =>
    put(g, rbox(0.014, 0.014, 0.008, 0.003), glow(c as string), x as number, SH - 0.095, -0.107));
  put(g, cyl(0.04, 0.05, 0.05, 12), gloss, 0, SH + 0.035, 0);
  // Helmet: a domed crown flaring to a wide lip; a triangular faceplate.
  const h = headGroup(g, HEAD + 0.01);
  put(h, lathe([[0.135, -0.11], [0.13, -0.095], [0.105, -0.06], [0.1, 0.0], [0.095, 0.05], [0.06, 0.095], [0, 0.11]],
    { smooth: 24, seg: 26, phi: PI * 0.22, arc: PI * 1.56 }), gloss);
  const helm = h.children[h.children.length - 1] as THREE.Mesh;
  (helm.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  put(h, ell(0.085, 0.07, 0.08), gloss, 0, -0.02, -0.01); // face
  pair((s) => put(h, ell(0.03, 0.022, 0.014), std("#2a1a1c"), s * 0.033, 0.0, -0.083, 0, s * 0.3, s * 0.25)); // eyes
  put(h, lathe([[0.04, -0.04], [0.012, 0.03]], { seg: 3 }).rotateY(PI / 6), std("#2c2c30"), 0, -0.07, -0.06, -0.35); // nose
  put(h, lathe([[0, -0.03], [0.03, -0.02], [0.022, 0.02]], { seg: 3 }), std(METAL), 0, -0.085, -0.075, -0.4); // mouth grille
  cape(g, std("#0b0b0d"), SH + 0.03, 0.42, 0.02, SH + 0.03);
  arm(armR, armL, { ...spec, commander: false }, m);
  return g;
}

function mando(m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: HIP, hipX: 0.075, shoulderY: SH, shoulderX: 0.155,
    thigh: 0.055, shin: 0.046, upper: 0.042, fore: 0.04,
    legMat: m.dark, shinMat: m.body, bootMat: m.dark, armMat: m.dark, foreMat: m.body, handMat: m.dark,
  });
  torso(g, m.dark, HIP, SH, 0.095, 0.13);
  put(g, lathe([[0.1, SH - 0.18], [0.135, SH - 0.12], [0.135, SH - 0.05], [0.11, SH - 0.01]], { depth: 0.72, smooth: 12, phi: PI * 0.62, arc: PI * 0.76 }), m.body); // chest plate
  put(g, rbox(0.1, 0.08, 0.02, 0.01), m.body, 0, HIP + 0.1, -0.066); // ab plate
  pair((s) => put(g, rbox(0.06, 0.1, 0.03, 0.012), m.body, s * 0.06, HIP - 0.07, -0.05)); // thigh plates
  put(g, lathe([[0.1, HIP - 0.02], [0.106, HIP + 0.025]], { depth: 0.75 }), std("#3a2a1a"));
  pair((s) => put(g, dome(0.06, 0.05, 0.065), m.trim, s * 0.155, SH - 0.005, 0, 0, 0, -s * 0.4));
  put(g, cyl(0.035, 0.04, 0.06, 12), m.dark, 0, SH + 0.04, 0);
  // Bucket helmet with a T-visor and a rangefinder stalk.
  const h = headGroup(g, HEAD + 0.01);
  put(h, lathe([[0.08, -0.1], [0.088, -0.08], [0.088, 0.03], [0.07, 0.085], [0, 0.098]], { smooth: 18, seg: 24 }), m.body);
  put(h, rbox(0.12, 0.026, 0.02, 0.006), std("#121316"), 0, 0.01, -0.083);
  put(h, rbox(0.034, 0.075, 0.02, 0.006), std("#121316"), 0, -0.035, -0.084);
  put(h, cyl(0.007, 0.007, 0.09, 8), m.dark, 0.085, 0.05, 0);
  put(h, rbox(0.012, 0.022, 0.035, 0.004), m.dark, 0.085, 0.095, -0.015);
  jetpack(g, m, SH - 0.08, 0.1);
  arm(armR, armL, spec, m, () => rifle(m, 0.44, m.trim));
  if (spec.commander) cape(g, std(team.accent), SH + 0.02, 0.3, 0.08, 0.5);
  return g;
}

function wookiee(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.42, hipX: 0.085, shoulderY: 0.78, shoulderX: 0.18,
    thigh: 0.075, shin: 0.062, upper: 0.06, fore: 0.055,
    legMat: m.body, armMat: m.body, foot: 1.2, reach: 1.15,
  });
  // Shaggy torso, longer fur at the hem.
  put(g, fur(lathe([[0, 0.3], [0.13, 0.31], [0.14, 0.42], [0.13, 0.52], [0.165, 0.68], [0.17, 0.76], [0.12, 0.81], [0.05, 0.83], [0, 0.835]],
    { depth: 0.75, smooth: 40, seg: 36 }), 0.1), m.body);
  const h = grp(g, 0, 0.9, -0.01);
  put(h, fur(ell(0.085, 0.1, 0.09, 22, 18), 0.08), m.body);
  put(h, fur(dome(0.09, 0.1, 0.095, 0, PI * 0.45, 22), 0.1), m.trim, 0, 0.01, 0.01); // darker crown
  put(h, ell(0.045, 0.04, 0.05), m.trim, 0, -0.035, -0.07); // muzzle
  put(h, ell(0.015, 0.01, 0.01), std("#1a1410"), 0, -0.02, -0.115); // nose
  pair((s) => put(h, ell(0.01, 0.008, 0.006), std("#1a1410"), s * 0.03, 0.02, -0.083));
  // Bandolier over the shoulder, ammo pouches along it.
  const band: P3[] = [[0.14, 0.76, -0.04], [0.04, 0.66, -0.12], [-0.08, 0.52, -0.105], [-0.13, 0.42, -0.04]];
  put(g, sweep(band, 0.018, 0.018, 16, 8).scale(1, 1, 1), std("#3a2a1a"));
  for (const t of [0.25, 0.45, 0.65]) {
    const p = new THREE.CatmullRomCurve3(band.map((v) => new THREE.Vector3(...v))).getPointAt(t);
    put(g, rbox(0.035, 0.03, 0.02, 0.006), std(METAL), p.x, p.y, p.z - 0.01, 0, 0, 0.8);
  }
  arm(armR, armL, spec, m, () => {
    // Bowcaster: a stocky body with a bow across the front.
    const r = new THREE.Group();
    put(r, rbox(0.05, 0.36, 0.06, 0.012), m.dark, 0, 0.1, 0.02);
    put(r, sweep([[-0.13, 0.26, 0.04], [0, 0.29, 0.05], [0.13, 0.26, 0.04]], 0.01, 0.01, 10, 6), std(METAL));
    put(r, cyl(0.012, 0.012, 0.2, 8), std(METAL), 0, 0.2, 0.06);
    return r;
  });
  return g;
}

function ewok(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.24, hipX: 0.075, shoulderY: 0.5, shoulderX: 0.165,
    thigh: 0.07, shin: 0.06, upper: 0.05, fore: 0.048,
    legMat: m.body, armMat: m.body, foot: 1.1,
  });
  put(g, fur(lathe([[0, 0.14], [0.17, 0.16], [0.21, 0.28], [0.19, 0.42], [0.13, 0.52], [0, 0.54]], { depth: 0.9, smooth: 20, seg: 24 }), 0.04), m.body);
  const h = grp(g, 0, 0.67, 0);
  put(h, fur(ell(0.17, 0.155, 0.16, 22, 16), 0.03), m.body);
  put(h, ell(0.08, 0.065, 0.06), m.dark, 0, -0.035, -0.12); // face
  pair((s) => put(h, ell(0.022, 0.024, 0.012), std("#0e0a08"), s * 0.04, 0.0, -0.15));
  put(h, ell(0.02, 0.015, 0.015), std("#0e0a08"), 0, -0.05, -0.175);
  // Leather hood with ears poking through.
  const hood = put(h, dome(0.18, 0.17, 0.175, 0, PI * 0.55, 22), m.trim, 0, 0.012, 0.015);
  (hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  pair((s) => put(h, ell(0.045, 0.05, 0.03), m.body, s * 0.12, 0.13, 0.02, 0, 0, -s * 0.4));
  // Spear in the right hand.
  pose(armR, 0.45, 0.5, 0.05);
  const spear = new THREE.Group();
  put(spear, cyl(0.013, 0.013, 0.95, 6), std("#5a4028"), 0, 0.2, 0);
  put(spear, new THREE.ConeGeometry(0.03, 0.09, 6), std(METAL), 0, 0.71, 0);
  put(spear, ell(0.025, 0.03, 0.025), std("#e8e0c8"), 0, 0.64, 0); // binding
  hold(armR, spear, -0.15);
  pose(armL, 0.3, 0.5, 0.15);
  return g;
}

// Geonosian: hunched, long-skulled, thin limbed, folded wings.
function insect(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.44, hipX: 0.06, shoulderY: 0.72, shoulderX: 0.125,
    thigh: 0.03, shin: 0.024, upper: 0.024, fore: 0.022,
    legMat: m.body, jointMat: m.trim, armMat: m.body, foot: 0.85, reach: 1.25,
  });
  put(g, lathe([[0, 0.38], [0.06, 0.4], [0.07, 0.5], [0.06, 0.56], [0.11, 0.66], [0.11, 0.72], [0.06, 0.76], [0, 0.77]],
    { depth: 0.7, smooth: 24 }), m.body, 0, 0, 0, 0.12);
  put(g, ell(0.07, 0.08, 0.06), m.trim, 0, 0.48, 0.0); // abdomen
  const h = grp(g, 0, 0.83, -0.05);
  h.rotation.x = 0.35;
  put(h, lathe([[0, -0.05], [0.05, -0.04], [0.06, 0.02], [0.05, 0.1], [0.025, 0.15], [0, 0.16]], { smooth: 16, seg: 16 }), m.body, 0, 0, 0, -0.6);
  pair((s) => put(h, ell(0.026, 0.03, 0.02), std("#c8a030"), s * 0.04, 0.0, -0.05)); // eyes
  put(h, ell(0.03, 0.02, 0.025), m.trim, 0, -0.045, -0.05); // mandibles
  // Folded wings.
  const wing = new THREE.MeshStandardMaterial({ color: "#d8d0b0", transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  pair((s) => {
    const w = lit(put(g, new THREE.CircleGeometry(0.1, 16).scale(0.6, 2.6, 1), wing, s * 0.05, 0.56, 0.08));
    w.rotation.set(0.12, s * 0.45, s * 0.12);
  });
  arm(armR, armL, {}, m, () => {
    // Sonic blaster: a bulb with a fluted barrel.
    const r = new THREE.Group();
    put(r, ell(0.04, 0.06, 0.04), m.dark, 0, 0.05, 0.02);
    put(r, lathe([[0.012, 0], [0.02, 0.1], [0.035, 0.16]], { seg: 12 }), m.dark, 0, 0.09, 0.02);
    return r;
  });
  return g;
}

// B2 super battle droid: hunched barrel chest, sunken head, wrist blasters.
function b2(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.4, hipX: 0.085, shoulderY: 0.7, shoulderX: 0.19,
    thigh: 0.05, shin: 0.035, upper: 0.05, fore: 0.06,
    legMat: m.body, shinMat: m.trim, jointMat: m.dark, armMat: m.trim, foreMat: m.body, foot: 1.1,
  });
  put(g, ell(0.09, 0.05, 0.06), m.trim, 0, 0.41, 0);
  const chest = put(g, lathe([[0, 0.44], [0.08, 0.46], [0.14, 0.54], [0.18, 0.64], [0.17, 0.72], [0.1, 0.76], [0, 0.77]],
    { depth: 0.9, smooth: 24, seg: 24 }), m.body, 0, 0, 0.02);
  chest.rotation.x = 0.2;
  put(g, rbox(0.1, 0.06, 0.06, 0.02), m.body, 0, 0.8, -0.1); // small sunken head
  put(g, rbox(0.06, 0.012, 0.01, 0.004), glow("#e04030"), 0, 0.8, -0.13);
  pair((s) => put(g, dome(0.06, 0.05, 0.06), m.trim, s * 0.18, 0.71, 0, 0, 0, -s * 0.3));
  // Blasters built into the forearms.
  for (const a of [armR, armL]) put(a.hand, rbox(0.08, 0.14, 0.09, 0.02), m.dark, 0, 0.0, 0);
  pose(armR, 0.9, 0.6, 0.15);
  pose(armL, 0.9, 0.6, 0.15);
  if (spec.jetpack) jetpack(g, m, 0.66, 0.15);
  return g;
}

// IG-88, K-2SO, tactical droids, MagnaGuards, dark troopers: tall and thin.
function tallDroid(m: Mats, spec: FigureSpec, team: Team, eye = "#ff5a3a"): THREE.Group {
  const g = new THREE.Group();
  const [armR, armL] = rig(g, {
    hipY: 0.47, hipX: 0.065, shoulderY: 0.76, shoulderX: 0.15,
    thigh: 0.035, shin: 0.028, upper: 0.03, fore: 0.028,
    legMat: m.body, jointMat: m.trim, armMat: m.body, handMat: m.trim, foot: 0.85, reach: 1.25,
  });
  put(g, ell(0.07, 0.04, 0.05), m.trim, 0, 0.48, 0);
  put(g, cyl(0.02, 0.02, 0.1, 8), m.metal, 0, 0.53, 0);
  put(g, lathe([[0.05, 0.56], [0.11, 0.62], [0.125, 0.7], [0.11, 0.76], [0.04, 0.78]], { depth: 0.6, smooth: 16 }), m.body);
  put(g, rbox(0.1, 0.06, 0.012, 0.005), m.trim, 0, 0.68, -0.072);
  pair((s) => put(g, dome(0.045, 0.035, 0.045), m.trim, s * 0.15, 0.76, 0, 0, 0, -s * 0.3));
  put(g, cyl(0.014, 0.014, 0.1, 8), m.metal, 0, 0.82, 0);
  const h = grp(g, 0, 0.9, 0);
  put(h, lathe([[0, -0.05], [0.05, -0.045], [0.06, 0.0], [0.055, 0.04], [0.03, 0.065], [0, 0.07]], { depth: 1.15, smooth: 14, seg: 18 }), m.body);
  pair((s) => lit(put(h, ell(0.014, 0.014, 0.01), glow(eye), s * 0.025, 0.005, -0.065)));
  put(h, rbox(0.06, 0.012, 0.02, 0.004), m.trim, 0, -0.03, -0.06);
  arm(armR, armL, spec, m, () => rifle(m, 0.5));
  if (spec.commander) cape(g, std(team.accent), 0.78, 0.26, 0.04, 0.5);
  return g;
}

// Grievous: the tall droid frame with a bone mask, a cape and a second
// pair of arms, a sabre in every hand.
function grievous(m: Mats, spec: FigureSpec): THREE.Group {
  const sabers = spec.sabers ?? [];
  const g = tallDroid(m, { ...spec, sabers: sabers.slice(0, 2), commander: false }, { color: "", accent: "" }, "#ffd040");
  put(g, lathe([[0.04, 0.6], [0.12, 0.64], [0.13, 0.7], [0.1, 0.75]], { depth: 0.65, smooth: 10 }), m.body); // ribcage plate
  put(g, rbox(0.1, 0.05, 0.08, 0.02), std("#5a3a4a"), 0, 0.5, 0); // gut sac
  put(g, sweep([[-0.13, 0.8, 0.02], [0, 0.83, 0.07], [0.13, 0.8, 0.02]], 0.03, 0.03, 12, 8), m.trim); // collar
  cape(g, std("#2a2830"), 0.82, 0.3, 0.02, 0.62);
  const lower = new THREE.Group();
  const [armR, armL] = rig(lower, {
    hipY: 0.47, hipX: 0, shoulderY: 0.7, shoulderX: 0.12, thigh: 0, shin: 0, upper: 0.026, fore: 0.024,
    legMat: m.body, jointMat: m.trim, armMat: m.body, handMat: m.trim, noLegs: true, reach: 1.6,
  });
  g.add(lower);
  if (sabers[2]) { pose(armR, 0.6, 0.6, 0.5); hold(armR, saber(sabers[2]), -0.8); }
  if (sabers[3]) { pose(armL, 0.4, 0.7, 0.55); hold(armL, saber(sabers[3]), -1.1); }
  return g;
}

// Yoda: knee high, a big head with long ears, a short robe.
function yoda(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const skin = std("#8aa35a");
  const [armR, armL] = rig(g, {
    hipY: 0.28, hipX: 0, shoulderY: 0.5, shoulderX: 0.12, thigh: 0, shin: 0, upper: 0.04, fore: 0.035,
    legMat: m.body, armMat: m.body, handMat: skin, noLegs: true, reach: 1.3,
  });
  put(g, folds(lathe([[0.19, 0], [0.18, 0.04], [0.14, 0.18], [0.11, 0.3], [0.12, 0.44], [0.1, 0.51], [0.04, 0.53], [0, 0.535]],
    { depth: 0.85, smooth: 24, seg: 24 }), 8, 0.08, 0, 0.3), m.body);
  put(g, lathe([[0.112, 0.28], [0.118, 0.32]], { depth: 0.86 }), m.dark); // sash
  put(g, sweep([[-0.11, 0.5, 0.0], [0, 0.55, 0.07], [0.11, 0.5, 0.0]], 0.035, 0.035, 12, 8), m.trim); // collar
  for (const a of [armR, armL]) put(a.elbow, lathe([[0.04, 0.02], [0.055, -0.06], [0.06, -0.1]], { smooth: 8, seg: 14 }), m.body);
  const h = grp(g, 0, 0.66, -0.01);
  put(h, ell(0.12, 0.1, 0.11), skin);
  put(h, ell(0.07, 0.04, 0.05), skin, 0, -0.06, -0.06); // mouth and chin
  pair((s) => {
    put(h, ell(0.026, 0.022, 0.012), std("#3a2a1a"), s * 0.045, 0.0, -0.1);
    put(h, ell(0.035, 0.012, 0.012), skin, s * 0.045, 0.025, -0.095); // brow
    // Ears sweep out and up, tapering to a point.
    put(h, sweep([[s * 0.1, 0.0, 0.01], [s * 0.18, 0.02, 0.02], [s * 0.26, 0.05, 0.03]], 0.035, 0.006, 10, 8).scale(1, 1, 0.5), skin);
  });
  put(h, dome(0.11, 0.09, 0.105, 0, PI * 0.3), std("#d8d8d0"), 0, 0.012, 0.01); // wisps of hair
  arm(armR, armL, spec, m);
  // Blade held out to the side so it doesn't hide the face.
  if (armR.hand.children.length > 1) {
    pose(armR, 0.45, 0.55, 0.4);
    armR.hand.children[1].rotation.x = -0.5 - 1.0;
  }
  // Gimer stick in the off hand.
  pose(armL, 0.15, 0.5, 0.2);
  const stick = new THREE.Group();
  put(stick, sweep([[0, -0.32, 0], [0.01, -0.1, 0.01], [0, 0.08, 0], [0.02, 0.12, 0]], 0.009, 0.012, 10, 6), std("#5a4028"));
  hold(armL, stick, 0.05);
  return g;
}

function droideka(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // Three curved legs: two forward, one behind, each ending in a claw.
  const legs: [number, number, number][] = [[1, -0.6, 1], [-1, -0.6, -1], [0, 1, 1]];
  for (const [x, z, s] of legs) {
    const hip = pivot(g, x * 0.06, 0.34, z * 0.05, s * 0.5);
    const ox = x * 0.17, oz = z * 0.15;
    put(hip, sweep([[0, 0, 0], [ox * 0.7, 0.06, oz * 0.7], [ox, -0.08, oz], [ox * 1.05, -0.3, oz * 1.05]], 0.02, 0.011, 14, 8), m.dark);
    put(hip, new THREE.ConeGeometry(0.02, 0.06, 6), m.dark, ox * 1.05, -0.32, oz * 1.05, PI);
  }
  // Curled shell, a narrow head, arms with twin blasters.
  put(g, lathe([[0, -0.05], [0.11, 0], [0.155, 0.07], [0.145, 0.15], [0.07, 0.19], [0, 0.195]], { depth: 0.8, smooth: 18, seg: 22 }), m.body, 0, 0.3, 0.06, -0.4);
  for (const r of [0.12, 0.145]) put(g, new THREE.TorusGeometry(r, 0.007, 6, 24, PI), m.trim, 0, 0.37, 0.06, 0, PI / 2, -0.4);
  put(g, ell(0.045, 0.032, 0.075), m.trim, 0, 0.46, -0.07);
  pair((s) => {
    put(g, sweep([[s * 0.05, 0.4, -0.02], [s * 0.13, 0.36, -0.07], [s * 0.13, 0.34, -0.14]], 0.014, 0.014, 8, 6), m.dark);
    put(g, rbox(0.055, 0.045, 0.13, 0.015), m.dark, s * 0.13, 0.34, -0.18);
    for (const d of [-0.014, 0.014]) put(g, cyl(0.007, 0.007, 0.05, 6), m.metal, s * 0.13 + d, 0.34, -0.26, PI / 2);
  });
  // Deflector shield bubble.
  lit(put(g, new THREE.SphereGeometry(0.33, 28, 18), new THREE.MeshStandardMaterial({
    color: "#7ad0ff", transparent: true, opacity: 0.12, depthWrite: false, emissive: "#3a90d0", emissiveIntensity: 0.4,
  }), 0, 0.3, 0));
  return g;
}

function astromech(m: Mats): THREE.Group {
  const g = new THREE.Group();
  put(g, lathe([[0.12, 0.12], [0.15, 0.18], [0.155, 0.56], [0.152, 0.6]], { smooth: 8, seg: 24 }), m.body);
  put(g, dome(0.155, 0.13, 0.155, 0, PI / 2, 24), std(METAL), 0, 0.6, 0);
  put(g, new THREE.TorusGeometry(0.153, 0.008, 6, 28), m.dark, 0, 0.6, 0, PI / 2);
  // Dome panels and eye.
  put(g, rbox(0.07, 0.045, 0.03, 0.008), m.trim, 0, 0.67, -0.13, -0.5);
  put(g, ell(0.022, 0.022, 0.012), std("#141518"), 0.05, 0.69, -0.12, -0.5);
  lit(put(g, ell(0.008, 0.008, 0.006), glow("#ff3a2a"), -0.05, 0.66, -0.135));
  for (const [x, y, w, h] of [[0, 0.45, 0.08, 0.14], [-0.07, 0.32, 0.04, 0.12], [0.07, 0.32, 0.04, 0.12], [0, 0.24, 0.12, 0.03]])
    put(g, rbox(w, h, 0.02, 0.006), m.trim, x, y, -0.14);
  pair((s) => {
    const leg = pivot(g, s * 0.165, 0.5, 0, s * 0.3);
    put(leg, cyl(0.04, 0.04, 0.03, 14), m.body, 0, 0, 0, 0, 0, PI / 2);
    put(leg, rbox(0.045, 0.42, 0.09, 0.015), m.body, s * 0.02, -0.22, 0.0);
    put(leg, rbox(0.03, 0.2, 0.05, 0.01), m.trim, s * 0.04, -0.22, -0.02);
    put(leg, rbox(0.09, 0.08, 0.17, 0.02), m.trim, s * 0.02, -0.46, -0.0);
  });
  put(g, rbox(0.07, 0.1, 0.1, 0.02), m.trim, 0, 0.08, 0); // centre foot
  return g;
}

function probe(m: Mats): THREE.Group {
  const g = new THREE.Group();
  put(g, lathe([[0, 0.55], [0.1, 0.56], [0.17, 0.62], [0.2, 0.72], [0.18, 0.82], [0.1, 0.88], [0, 0.9]], { smooth: 22, seg: 24 }), m.body);
  put(g, new THREE.TorusGeometry(0.2, 0.012, 6, 28), m.trim, 0, 0.72, 0, PI / 2);
  for (const [x, y] of [[0, 0.75], [-0.07, 0.69], [0.07, 0.69]])
    lit(put(g, ell(0.025, 0.025, 0.012), glow("#ff3a2a"), x, y, -0.19));
  pair((s) => put(g, cyl(0.006, 0.006, 0.3, 6), m.trim, s * 0.06, 1.0, 0.06, -0.1, 0, s * 0.1));
  put(g, cyl(0.04, 0.03, 0.05, 10), m.trim, 0, 0.92, 0); // dish
  // Dangling manipulator arms.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    const hip = pivot(g, Math.sin(a) * 0.1, 0.58, Math.cos(a) * 0.1, i % 2 ? 0.4 : -0.4);
    const ox = Math.sin(a) * 0.06, oz = Math.cos(a) * 0.06;
    put(hip, sweep([[0, 0, 0], [ox, -0.12, oz], [ox * 0.6, -0.3, oz * 0.6], [ox * 1.4, -0.45, oz * 1.4]], 0.014, 0.007, 14, 6), m.trim);
  }
  return g;
}

// --- Riders -------------------------------------------------------------------

function rider(style: FigureStyle, mount: MountKind, pilot: FigureSpec | undefined, team: Team): THREE.Group {
  const g = new THREE.Group();
  const skin = std(mount === "tauntaun" ? "#e4dccb" : mount === "boga" ? "#5f8a4a" : "#8a7a52");
  const belly = std(mount === "tauntaun" ? "#c8bca4" : mount === "boga" ? "#c8b878" : "#b0a070");
  const horn = std("#e8dcc0");
  const leather = std("#5a3a22");
  // A jointed leg: thigh, a backward-bent shin, a clawed foot.
  const leg = (x: number, y: number, z: number, len: number, r: number, s: number, digi = false) => {
    const hip = pivot(g, x, y, z, s);
    const k = digi ? [0, -len * 0.45, -len * 0.18] : [0, -len * 0.5, -len * 0.05];
    const a = digi ? [0, -len * 0.82, len * 0.12] : [0, -len * 0.92, len * 0.02];
    put(hip, sweep([[0, r * 0.5, 0], k as P3, a as P3, [0, -len + r * 0.3, -r * 0.6]], r, r * 0.5, 14, 10), skin);
    put(hip, ell(r * 1.3, r * 1.1, r * 1.2), skin, 0, 0, 0);
    // Three toes.
    for (const t of [-1, 0, 1]) put(hip, new THREE.ConeGeometry(r * 0.32, r * 1.8, 6), horn, t * r * 0.55, -len + r * 0.2, -r * 1.7, -PI / 2 - 0.2, t * 0.3, 0);
  };
  let seatY: number, seatZ: number;
  if (mount === "tauntaun") {
    // Upright biped: big haunches, a neck curving forward, curled horns.
    pair((s) => leg(s * 0.12, 0.5, 0.06, 0.5, 0.075, s, true));
    put(g, fur(lathe([[0, -0.26], [0.1, -0.22], [0.15, -0.08], [0.15, 0.08], [0.11, 0.2], [0, 0.26]], { smooth: 20, seg: 22, depth: 0.85 }), 0.03)
      .rotateX(-0.9), skin, 0, 0.66, 0.02);
    put(g, ell(0.12, 0.13, 0.11), belly, 0, 0.6, -0.06); // chest
    put(g, sweep([[0, 0.76, -0.1], [0, 0.88, -0.2], [0, 0.93, -0.3]], 0.085, 0.06, 12, 12), skin);
    const h = grp(g, 0, 0.94, -0.36);
    put(h, ell(0.065, 0.065, 0.11), skin);
    put(h, ell(0.05, 0.045, 0.06), belly, 0, -0.03, -0.1);
    pair((s) => {
      put(h, ell(0.012, 0.012, 0.008), std("#1a1410"), s * 0.06, 0.02, -0.06);
      put(h, sweep([[s * 0.05, 0.035, 0.02], [s * 0.1, 0.06, 0.05], [s * 0.13, 0.0, 0.02], [s * 0.1, -0.05, -0.01], [s * 0.075, -0.025, -0.03]], 0.018, 0.006, 18, 8), horn);
    });
    put(g, sweep([[0, 0.55, 0.22], [0, 0.42, 0.38], [0, 0.3, 0.46], [0, 0.22, 0.6]], 0.08, 0.015, 14, 10), skin); // tail
    pair((a) => put(g, sweep([[a * 0.04, 0.9, -0.42], [a * 0.07, 0.9, -0.25], [a * 0.08, 0.86, -0.08]], 0.006, 0.006, 8, 4), leather)); // reins
    put(g, lathe([[0.17, 0], [0.18, 0.02], [0.14, 0.04]], { depth: 1.3, seg: 18 }), leather, 0, 0.82, 0.08);
    seatY = 0.84; seatZ = 0.08;
  } else {
    // Low quadruped lizard; the boga is bigger, long-necked and frilled.
    const big = mount === "boga";
    for (const [x, z, s] of [[0.16, -0.24, 1], [-0.16, -0.24, -1], [0.16, 0.22, -1], [-0.16, 0.22, 1]] as const)
      leg(x, 0.3, z, 0.3, 0.06, s);
    put(g, lathe([[0, -0.42], [0.12, -0.36], [0.2, -0.15], [0.21, 0.08], [0.17, 0.3], [0.09, 0.44], [0, 0.48]], { smooth: 24, seg: 24, depth: 0.8 })
      .rotateX(PI / 2), skin, 0, 0.38, 0);
    put(g, lathe([[0, -0.35], [0.15, -0.2], [0.17, 0.1], [0.12, 0.3], [0, 0.38]], { smooth: 16, seg: 20 }).rotateX(PI / 2).scale(1, 0.55, 1), belly, 0, 0.32, 0);
    // Neck and head.
    const neck: P3[] = big ? [[0, 0.44, -0.3], [0, 0.6, -0.45], [0, 0.78, -0.5]] : [[0, 0.42, -0.34], [0, 0.45, -0.46]];
    put(g, sweep(neck, 0.1, 0.065, 12, 12), skin);
    const end = neck[neck.length - 1];
    const h = grp(g, end[0], end[1], end[2] - 0.04);
    put(h, ell(0.08, 0.07, 0.13), skin);
    put(h, ell(0.06, 0.035, 0.08), belly, 0, -0.04, -0.06);
    pair((s) => put(h, ell(0.014, 0.014, 0.01), std("#1a1410"), s * 0.06, 0.025, -0.06));
    if (big) {
      const frill = put(g, new THREE.CircleGeometry(0.16, 20, 0, PI).rotateZ(-PI / 2).rotateY(PI / 2).scale(1, 1, 0.6), std("#d0763a"), 0, end[1] + 0.06, end[2] + 0.08);
      (frill.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) put(g, new THREE.ConeGeometry(0.02, 0.07, 6), std("#d0763a"), 0, 0.56 - i * 0.012, -0.15 + i * 0.08, -0.2);
    } else {
      // Dewback: a row of blunt back spines.
      for (let i = 0; i < 6; i++) put(g, new THREE.ConeGeometry(0.025, 0.05, 6), belly, 0, 0.55 - Math.abs(i - 1.5) * 0.008, -0.2 + i * 0.09);
    }
    put(g, sweep([[0, 0.38, 0.38], [0, 0.32, 0.6], [0, 0.22, 0.78], [0.05, 0.12, 0.92]], 0.09, 0.012, 16, 10), skin); // tail
    put(g, rbox(0.26, 0.04, 0.26, 0.02), leather, 0, 0.54, 0.02);
    pair((s) => put(g, rbox(0.012, 0.16, 0.03, 0.004), leather, s * 0.17, 0.46, 0.02)); // girth
    seatY = 0.56; seatZ = 0.02;
  }
  const p = seated(style, pilot, team, 0.62, 0.45);
  p.position.set(0, seatY - 0.62 * 0.43, seatZ);
  g.add(p);
  return g;
}

// --- Vehicles -----------------------------------------------------------------

// A figure sitting down: thighs forward, shins down (the arms still swing
// with the walk cycle).
function seated(style: FigureStyle, pilot: FigureSpec | undefined, team: Team, scale: number, straddle = 0): THREE.Group {
  const p = figure(style, pilot ?? {}, team);
  p.traverse((o) => {
    if (!o.userData.leg) return;
    o.userData.swing = 0;
    o.rotation.set(1.35, 0, Math.sign(o.position.x) * straddle, "ZXY");
    (o.userData.knee as THREE.Object3D | undefined)?.rotation.set(-1.3, 0, 0);
  });
  p.scale.setScalar(scale);
  return p;
}

function vehicle(style: FigureStyle, frame: VehicleFrame, pilot: FigureSpec | undefined, team: Team): THREE.Group {
  const g = new THREE.Group();
  const c = STYLE_COLORS[style];
  const hull = std(team.color);
  const trim = std(style === "pawn" ? team.accent : c.trim);
  const dark = std(c.dark);
  const metal = std(METAL);
  const engine = glow("#7ad0ff");
  // A gun barrel pointing forward from (x, y, z), with a muzzle.
  const gun = (x: number, y: number, z: number, len: number, r = 0.025) => {
    put(g, cyl(r, r * 0.85, len, 10), dark, x, y, z - len / 2, PI / 2);
    put(g, cyl(r * 1.35, r * 1.35, len * 0.12, 10), metal, x, y, z - len, PI / 2);
  };
  const glowDisc = (x: number, y: number, z: number, r: number) =>
    lit(put(g, new THREE.CircleGeometry(r, 16), engine, x, y, z));

  switch (frame) {
    case "tank": {
      // Sloped hull on two track units, a rounded turret with a long gun.
      put(g, prism([[-0.42, 0.1], [0.36, 0.1], [0.46, 0.2], [0.34, 0.3], [-0.36, 0.32], [-0.44, 0.22]], 0.46, 0.03), hull);
      put(g, prism([[-0.3, 0.3], [0.22, 0.3], [0.18, 0.34], [-0.28, 0.35]], 0.36, 0.01), trim);
      pair((s) => {
        put(g, rbox(0.13, 0.17, 0.94, 0.06), dark, s * 0.3, 0.09, 0);
        for (let i = 0; i < 5; i++) put(g, cyl(0.05, 0.05, 0.02, 14), metal, s * 0.37, 0.08, -0.34 + i * 0.17, 0, 0, PI / 2);
        put(g, rbox(0.16, 0.025, 0.96, 0.01), trim, s * 0.3, 0.19, 0);
      });
      put(g, lathe([[0, 0], [0.17, 0], [0.18, 0.04], [0.15, 0.1], [0.06, 0.13], [0, 0.13]], { depth: 1.25, smooth: 16, seg: 22 }), trim, 0, 0.33, 0.06);
      gun(0, 0.4, -0.12, 0.48, 0.028);
      put(g, cyl(0.04, 0.045, 0.03, 14), dark, 0.05, 0.47, 0.1); // hatch
      break;
    }
    case "hover-tank": {
      // Wedge hull that rises to the back, engine pods on the flanks.
      // Seen from above the hull is a wedge: a narrow prow, wide at the back.
      put(g, plate([[-0.3, -0.44], [-0.28, 0.0], [-0.12, 0.46], [0.12, 0.46], [0.28, 0.0], [0.3, -0.44]], 0.14, 0.04, false), hull, 0, 0.09, 0);
      put(g, plate([[-0.24, -0.4], [-0.22, -0.02], [-0.1, 0.3], [0.1, 0.3], [0.22, -0.02], [0.24, -0.4]], 0.07, 0.03, false), hull, 0, 0.22, 0);
      put(g, plate([[-0.16, -0.36], [-0.14, 0.0], [0.14, 0.0], [0.16, -0.36]], 0.02, 0.008, false), trim, 0, 0.29, 0);
      pair((s) => {
        put(g, nacelle([[0, 0], [0.06, 0.04], [0.085, 0.2], [0.08, 0.5], [0.06, 0.56]], { smooth: 16, seg: 16 }), dark, s * 0.33, 0.2, -0.2);
        glowDisc(s * 0.33, 0.2, 0.37, 0.055).rotation.y = 0;
        put(g, rbox(0.08, 0.02, 0.5, 0.008), trim, s * 0.33, 0.29, 0.06);
      });
      for (const [x, z] of [[-0.18, -0.25], [0.18, -0.25], [-0.18, 0.25], [0.18, 0.25]])
        lit(put(g, new THREE.CircleGeometry(0.06, 16), glow("#7ad0ff", 0.7), x, 0.075, z, PI / 2));
      put(g, lathe([[0, 0], [0.14, 0], [0.15, 0.05], [0.11, 0.1], [0, 0.11]], { depth: 1.3, smooth: 14, seg: 20 }), trim, 0, 0.32, 0.02);
      pair((s) => gun(s * 0.05, 0.37, -0.1, 0.42, 0.018));
      break;
    }
    case "landspeeder": {
      // A rounded tub with a pointed nose, windscreen and three engines.
      put(g, plate([[-0.2, -0.42], [-0.24, -0.1], [-0.22, 0.2], [-0.1, 0.42], [0, 0.46], [0.1, 0.42], [0.22, 0.2], [0.24, -0.1], [0.2, -0.42]], 0.12, 0.04), hull, 0, 0.16, 0);
      put(g, plate([[-0.16, -0.25], [-0.17, 0.08], [0, 0.12], [0.17, 0.08], [0.16, -0.25]], 0.02, 0.01), std("#2a2420"), 0, 0.29, 0.04);
      const screen = put(g, lathe([[0.2, 0], [0.19, 0.07]], { phi: PI * 0.72, arc: PI * 0.56, seg: 16 }), glass(), 0, 0.3, 0.05);
      (screen.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      for (const [x, y] of [[-0.25, 0.27], [0.25, 0.27], [0, 0.4]]) {
        put(g, nacelle([[0.03, 0], [0.065, 0.02], [0.07, 0.25], [0.05, 0.3]], { smooth: 10, seg: 16 }), metal, x, y, 0.2);
        put(g, new THREE.TorusGeometry(0.066, 0.01, 6, 18), trim, x, y, 0.22);
        glowDisc(x, y, 0.505, 0.04);
      }
      pair((s) => put(g, rbox(0.03, 0.1, 0.06, 0.01), trim, s * 0.13, 0.33, 0.24)); // pylon to the top engine
      const p = seated(style, pilot, team, 0.42);
      p.position.set(-0.08, 0.13, 0.06);
      g.add(p);
      break;
    }
    case "bike": {
      // A slim hull, long steering vanes forward, the engine behind.
      put(g, nacelle([[0, -0.1], [0.05, -0.05], [0.07, 0.1], [0.075, 0.3], [0.06, 0.4], [0.03, 0.42]], { depth: 0.8, smooth: 18, seg: 16 }), hull, 0, 0.3, -0.06);
      put(g, nacelle([[0.04, 0], [0.09, 0.03], [0.1, 0.18], [0.07, 0.24]], { smooth: 10, seg: 16 }), dark, 0, 0.3, 0.3);
      glowDisc(0, 0.3, 0.545, 0.06);
      put(g, rbox(0.08, 0.03, 0.2, 0.012), std("#2a2420"), 0, 0.37, 0.14); // seat
      pair((s) => {
        put(g, cyl(0.007, 0.007, 0.36, 6), metal, s * 0.04, 0.29, -0.34, PI / 2);
        put(g, plate([[-0.01, -0.08], [0.01, -0.08], [0.012, 0.08], [-0.012, 0.08]], 0.12, 0.004, false), trim, s * 0.045, 0.23, -0.52);
      });
      put(g, sweep([[0.08, 0.36, -0.1], [0.12, 0.42, -0.04], [-0.12, 0.42, -0.04], [-0.08, 0.36, -0.1]], 0.008, 0.008, 12, 6), dark); // handlebars
      const p = seated(style, pilot, team, 0.5);
      p.rotation.x = -0.25; // leaning into the ride
      p.position.set(0, 0.13, 0.12);
      g.add(p);
      break;
    }
    case "walker":
    case "scout-walker": {
      const scout = frame === "scout-walker";
      const hipY = 0.6;
      pair((s) => {
        // Reverse-jointed leg: thigh forward and down, shin back, splayed toes.
        const hip = pivot(g, s * (scout ? 0.1 : 0.15), hipY, 0, s * 0.7);
        put(hip, ell(0.05, 0.05, 0.05), dark);
        put(hip, rbox(0.06, hipY * 0.52, 0.08, 0.02).translate(0, -hipY * 0.25, 0), hull, 0, 0, 0, 0.35);
        const knee = grp(hip, 0, -hipY * 0.47, -hipY * 0.17);
        put(knee, ell(0.04, 0.04, 0.045), dark);
        put(knee, rbox(0.045, hipY * 0.5, 0.055, 0.015).translate(0, -hipY * 0.25, 0), dark, 0, 0, 0, -0.42);
        const ankle = grp(hip, 0, -hipY + 0.05, 0.02);
        put(ankle, ell(0.03, 0.03, 0.03), metal);
        for (const t of [-1, 0, 1]) put(ankle, rbox(0.035, 0.03, 0.12, 0.01), hull, t * 0.04, -0.03, -0.05, 0, t * 0.4, 0);
        put(ankle, rbox(0.035, 0.03, 0.07, 0.01), hull, 0, -0.03, 0.05);
      });
      if (scout) {
        put(g, prism([[0.14, 0.0], [-0.12, 0.0], [-0.14, 0.08], [0.06, 0.1]], 0.18, 0.02), hull, 0, 0.6, 0);
        put(g, rbox(0.12, 0.04, 0.14, 0.015), std("#2a2420"), 0, 0.71, 0.02);
        gun(0, 0.62, -0.14, 0.32, 0.022);
        const p = seated(style, pilot, team, 0.36);
        p.position.set(0, 0.6, 0.03);
        g.add(p);
      } else {
        // Chin-forward head with viewports, cheek guns and a top hatch.
        put(g, prism([[0.26, -0.06], [0.14, -0.12], [-0.18, -0.12], [-0.24, 0.0], [-0.2, 0.11], [0.12, 0.13], [0.24, 0.04]], 0.32, 0.03), hull, 0, 0.84, 0);
        put(g, rbox(0.24, 0.035, 0.02, 0.01), std("#141518"), 0, 0.88, -0.24);
        put(g, lathe([[0, 0], [0.07, 0], [0.065, 0.03], [0, 0.035]], { seg: 16 }), trim, 0, 0.97, 0.04);
        pair((s) => {
          put(g, rbox(0.06, 0.07, 0.12, 0.015), dark, s * 0.2, 0.84, -0.04);
          gun(s * 0.22, 0.84, -0.1, 0.2, 0.02);
        });
        gun(0, 0.74, -0.2, 0.16, 0.022);
        put(g, ell(0.11, 0.06, 0.1), dark, 0, 0.66, 0); // hip
      }
      break;
    }
    case "airspeeder": {
      // T-47: a wedge with a split nose, a bubble canopy, a rear gun.
      const hullShape: P2[] = [[-0.3, -0.38], [-0.32, 0.1], [-0.22, 0.4], [-0.08, 0.4], [-0.06, 0.18], [0.06, 0.18], [0.08, 0.4], [0.22, 0.4], [0.32, 0.1], [0.3, -0.38]];
      put(g, plate(hullShape, 0.1, 0.03, false), hull, 0, 0.24, 0);
      put(g, plate([[-0.24, -0.3], [-0.24, 0.05], [0.24, 0.05], [0.24, -0.3]], 0.03, 0.01, false), trim, 0, 0.33, 0);
      pair((s) => {
        put(g, nacelle([[0.03, 0], [0.05, 0.05], [0.05, 0.25]], { seg: 12 }), dark, s * 0.15, 0.27, -0.42);
        glowDisc(s * 0.22, 0.29, 0.385, 0.03);
      });
      put(g, dome(0.1, 0.07, 0.17), glass(), 0, 0.33, -0.02);
      put(g, cyl(0.016, 0.016, 0.16, 8), dark, 0, 0.32, 0.42, PI / 2);
      break;
    }
    case "gunship": {
      // LAAT: a long fuselage with a bubble nose, swept wings, ball turrets.
      put(g, nacelle([[0, 0], [0.1, 0.04], [0.15, 0.2], [0.16, 0.6], [0.12, 0.88], [0.04, 0.95]], { depth: 0.9, smooth: 22, seg: 20 }), hull, 0, 0.36, -0.48);
      put(g, dome(0.08, 0.06, 0.1), glass(), 0, 0.42, -0.36);
      put(g, plate([[-0.5, 0.0], [-0.48, 0.12], [-0.1, 0.22], [0.1, 0.22], [0.48, 0.12], [0.5, 0.0], [0.1, -0.08], [-0.1, -0.08]], 0.03, 0.012), trim, 0, 0.44, 0.06);
      pair((s) => {
        put(g, rbox(0.02, 0.15, 0.3, 0.008), dark, s * 0.155, 0.32, 0.02); // open troop bay
        put(g, ell(0.05, 0.05, 0.05), glass(), s * 0.42, 0.42, 0.0); // ball turrets
        put(g, nacelle([[0.02, 0], [0.04, 0.05], [0.04, 0.2]], { seg: 10 }), dark, s * 0.3, 0.47, 0.0);
      });
      put(g, prism([[0.05, 0], [-0.14, 0], [-0.16, 0.1], [-0.08, 0.1]], 0.025, 0.006), hull, 0, 0.44, 0.38);
      break;
    }
    case "crawler": {
      // Crab droid: a flattened shell, red eyes, four jointed legs.
      put(g, lathe([[0, -0.1], [0.2, -0.08], [0.27, 0.0], [0.24, 0.06], [0.12, 0.11], [0, 0.12]], { depth: 0.85, smooth: 18, seg: 24 }), hull, 0, 0.42, 0);
      put(g, rbox(0.18, 0.07, 0.08, 0.02), dark, 0, 0.42, -0.24);
      pair((s) => lit(put(g, ell(0.022, 0.022, 0.012), glow("#ff3a2a"), s * 0.055, 0.45, -0.28)));
      gun(0, 0.37, -0.24, 0.28, 0.025);
      for (const [x, z, s] of [[1, -1, 1], [-1, -1, -1], [1, 1, -1], [-1, 1, 1]] as const) {
        const hip = pivot(g, x * 0.18, 0.44, z * 0.12, s * 0.4);
        put(hip, ell(0.04, 0.04, 0.04), dark);
        put(hip, sweep([[0, 0, 0], [x * 0.18, 0.12, z * 0.08], [x * 0.3, 0.08, z * 0.12]], 0.03, 0.025, 12, 8), hull);
        put(hip, sweep([[x * 0.3, 0.08, z * 0.12], [x * 0.33, -0.15, z * 0.14], [x * 0.3, -0.42, z * 0.14]], 0.022, 0.01, 12, 8), dark);
      }
      break;
    }
  }
  return g;
}

function emplacement(style: FigureStyle, team: Team): THREE.Group {
  const g = new THREE.Group();
  const dark = std(STYLE_COLORS[style].dark);
  const metal = std(METAL);
  // Tripod-mounted heavy blaster with a power generator.
  pair((s) => put(g, sweep([[0, 0.3, -0.1], [s * 0.18, 0.12, -0.18], [s * 0.24, 0.0, -0.2]], 0.015, 0.012, 8, 6), metal));
  put(g, sweep([[0, 0.3, -0.1], [0, 0.12, 0.08], [0, 0.0, 0.12]], 0.015, 0.012, 8, 6), metal);
  put(g, rbox(0.1, 0.08, 0.2, 0.02), std(team.color), 0, 0.33, -0.12);
  put(g, cyl(0.03, 0.025, 0.5, 12), dark, 0, 0.35, -0.42, PI / 2);
  put(g, cyl(0.04, 0.04, 0.06, 12), metal, 0, 0.35, -0.67, PI / 2);
  put(g, rbox(0.18, 0.14, 0.12, 0.03), std(team.color), 0.26, 0.07, 0.15);
  put(g, sweep([[0.2, 0.12, 0.1], [0.1, 0.18, 0.0], [0.03, 0.3, -0.08]], 0.01, 0.01, 10, 6), dark); // power cable
  const crew = figure(style, {}, team);
  crew.scale.setScalar(0.62);
  crew.position.set(-0.05, -0.04, 0.12);
  crew.traverse((o) => {
    // Kneeling behind the gun.
    if (!o.userData.leg) return;
    o.userData.swing = 0;
    o.rotation.x = o.position.x > 0 ? 1.4 : 0.2;
    (o.userData.knee as THREE.Object3D | undefined)?.rotation.set(o.position.x > 0 ? -1.5 : -1.9, 0, 0);
  });
  g.add(crew);
  return g;
}

// --- Helpers ------------------------------------------------------------------

// The models are cel shaded, like an animated show: light falls in a few
// flat bands instead of a smooth gradient. Gloss and metal are ignored.
let bands: THREE.DataTexture | null = null;
function toonBands(): THREE.DataTexture {
  if (!bands) {
    bands = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
    bands.minFilter = bands.magFilter = THREE.NearestFilter;
    bands.needsUpdate = true;
  }
  return bands;
}

export function std(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonBands() });
}

// Glowing bits (blades, shields, eyes, wings) and ink outlines neither cast
// nor take shadows.
export function shadows(g: THREE.Object3D) {
  g.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const lit = !o.userData.glow && !o.userData.outline;
    o.castShadow = lit;
    o.receiveShadow = lit;
  });
}

function matKey(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return [m.type, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.roughness, s.metalness,
    m.opacity, m.transparent, m.side, m.depthWrite].join("|");
}

// Merge the static meshes under each pivot (and under the model itself) by
// material, so the walk cycle still has its limbs but a model costs a few
// draw calls instead of dozens.
function bake(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  const visit = (top: THREE.Object3D) => {
    inv.copy(top.matrixWorld).invert();
    const buckets = new Map<string, { mat: THREE.Material; glow: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    const pivots: THREE.Object3D[] = [];
    const inked: THREE.BufferGeometry[] = [];
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (c.userData.swing) { pivots.push(c); continue; }
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh || c.children.length || Array.isArray(mesh.material)) { walk(c); continue; }
        const key = matKey(mesh.material) + (c.userData.glow ? "|glow" : "");
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = { mat: mesh.material, glow: !!c.userData.glow, geos: [], meshes: [] });
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
        geo.applyMatrix4(rel.multiplyMatrices(inv, mesh.matrixWorld));
        b.geos.push(geo);
        b.meshes.push(mesh);
        const mat = mesh.material;
        if (!c.userData.glow && !mat.transparent && mat.side === THREE.FrontSide) {
          const ink = new THREE.BufferGeometry();
          ink.setAttribute("position", geo.attributes.position);
          inked.push(ink);
        }
      }
    };
    walk(top);
    for (const b of buckets.values()) {
      const merged = b.meshes.length > 1 ? mergeGeometries(b.geos) : null;
      if (!merged) { b.geos.forEach((x) => x.dispose()); continue; }
      for (const mesh of b.meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.userData.glow = b.glow;
      top.add(mesh);
    }
    if (inked.length) top.add(outline(inked));
    for (const p of pivots) visit(p);
  };
  visit(root);
}

const INK = 0.0085;

// A cartoon ink line: the shapes again, pushed out along their smoothed
// normals and drawn back faces only in black, so a dark rim shows round the
// silhouette and wherever one part overlaps another.
function outline(geos: THREE.BufferGeometry[]): THREE.Mesh {
  const g = mergeVertices(mergeGeometries(geos), 1e-4);
  geos.forEach((x) => x.dispose());
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * INK, p.getY(i) + n.getY(i) * INK, p.getZ(i) + n.getZ(i) * INK);
  g.deleteAttribute("normal");
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#0a0a0c", side: THREE.BackSide }));
  m.userData.outline = true;
  return m;
}

// Scale a unit-sized model so its footprint matches and its height is
// modelHeight, whichever is tighter.
function fit(g: THREE.Group, footprint: number, modelHeight: number) {
  shadows(g);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const s = Math.min((footprint * 0.9) / Math.max(size.x, size.z, 1e-3), modelHeight / Math.max(size.y, 1e-3));
  g.scale.setScalar(s);
}
