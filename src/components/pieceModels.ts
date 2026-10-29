// Default 3D models for tabletop pieces, built from primitives.
//
// Every model is built at unit size (footprint ~1, height ~1) and scaled to
// fit the piece. Limbs and walker legs hang from a pivot and carry
// userData.swing (+1/-1: which way they swing) so the take-control walk cycle
// can animate them; userData.swingBase is the pose they swing about (a raised
// sabre arm, say). The figure faces -z, so its right hand is +x.

import * as THREE from "three";

export type FigureStyle = "rebel" | "imperial" | "clone" | "droid" | "merc" | "pawn";

/** Body shape. "trooper" (the default) is the faction's iconic trooper. */
export type FigureBuild =
  | "trooper"     // faction trooper: rebel, stormtrooper, clone, B1, cloak, pawn
  | "hero"        // bare-headed named character (Han, Leia, an officer, an agent)
  | "robed"       // Jedi / Sith robes
  | "vader"       // armoured Sith: helmet and cape
  | "yoda"        // little green Jedi master: big head, long ears
  | "grievous"    // cyborg general: caped, four sabre arms
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
  /** Which of the squad's poses this mini takes; the simple models have one. */
  pose?: number;
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
  /** The piece's id (the sculpted models used it to vary poses). */
  id?: string;
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
  yoda:         { body: "#b8a88a", trim: "#7a5e3e", dark: "#1a1a1a" },
  grievous:     { body: "#ddd6c2", trim: "#3a3d44", dark: "#1a1b1e" },
  mando:        { body: "#7d8b96", trim: "#3d4a55", dark: "#1c2228" },
  wookiee:      { body: "#6b4a2b", trim: "#4a3220", dark: "#2a1c12" },
  ewok:         { body: "#7a5a3a", trim: "#a07a4a", dark: "#2e2218" },
  insect:       { body: "#9a7a4a", trim: "#6a5232", dark: "#2e2418" },
  b2:           { body: "#5f6b80", trim: "#3e4757", dark: "#1e232c" },
  "tall-droid": { body: "#4b4f57", trim: "#2c2f35", dark: "#15171a" },
  droideka:     { body: "#8a6a4a", trim: "#5a4430", dark: "#2a2018" },
  astromech:    { body: "#e8ecf0", trim: "#2d5fb0", dark: "#3a3f48" },
  probe:        { body: "#2a2c31", trim: "#4a4d55", dark: "#121316" },
};

const SKIN = "#c99a7a";
const METAL = "#8c939c";

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
  fit(g, pc.footprint, pc.modelHeight);
  return g;
}

type Team = { color: string; accent: string };
type Mats = { body: THREE.Material; trim: THREE.Material; dark: THREE.Material };

function mats(style: FigureStyle, spec: FigureSpec, team: Team): Mats {
  const build = spec.build ?? "trooper";
  let p = BUILD_COLORS[build] ?? STYLE_COLORS[style];
  if (build === "trooper" && style === "pawn") p = { ...p, body: team.color, trim: team.accent };
  if (build === "hero") p = { body: team.color, trim: STYLE_COLORS[style].dark, dark: "#2a2622" };
  if (build === "mando") p = { ...p, trim: team.color };
  p = { ...p, ...spec.palette };
  return { body: std(p.body), trim: std(p.trim), dark: std(p.dark) };
}

// --- Figures ----------------------------------------------------------------

type Add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;

function adder(g: THREE.Object3D): Add {
  return (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };
}

type Limbs = {
  legR: number; legL: number; hipX: number; hipY: number;
  armR: number; armL: number; shoulderX: number; shoulderY: number;
  legMat: THREE.Material; armMat: THREE.Material;
  /** Robes hide the legs, so don't hang any. */
  noLegs?: boolean;
};

// Two legs from the hips and two arms from the shoulders, each pivoting at
// the top so the walk cycle can swing it. Returns the arms (right, left) so
// callers can put things in their hands at y = -armLength.
function limbs(g: THREE.Group, l: Limbs): [THREE.Mesh, THREE.Mesh] {
  const add = adder(g);
  const arms: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    if (!l.noLegs) add(new THREE.CylinderGeometry(l.legR, l.legR * 0.92, l.hipY, 10).translate(0, -l.hipY / 2, 0), l.legMat, s * l.hipX, l.hipY, 0).userData.swing = s;
    const armLen = l.shoulderY - l.hipY + 0.02;
    const arm = add(new THREE.CylinderGeometry(l.armR, l.armL, armLen, 10).translate(0, -armLen / 2, 0), l.armMat, s * l.shoulderX, l.shoulderY, -0.02);
    arm.rotation.z = s * 0.12;
    arm.userData.swing = -s;
    arm.userData.armLength = armLen;
    arms.push(arm);
  }
  return [arms[0], arms[1]];
}

// Raise an arm forward so the walk cycle swings it about that pose.
function raise(arm: THREE.Mesh, angle: number) {
  arm.userData.swingBase = angle;
  arm.rotation.x = angle;
}

function hand(arm: THREE.Mesh): THREE.Group {
  const h = new THREE.Group();
  h.position.y = -(arm.userData.armLength as number);
  arm.add(h);
  return h;
}

// A lightsaber in the hand, blade pointing `tilt` from straight up (negative
// tilts it forward), taking the arm's own raise into account.
function saber(arm: THREE.Mesh, color: string, tilt: number, double = false) {
  const h = hand(arm);
  const s = new THREE.Group();
  s.rotation.x = tilt - ((arm.userData.swingBase as number | undefined) ?? 0);
  h.add(s);
  const hiltLen = double ? 0.16 : 0.09;
  s.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, hiltLen, 8), std(METAL)));
  const core = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
  for (const dir of double ? [1, -1] : [1]) {
    const y = dir * (hiltLen / 2 + 0.25);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), core);
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.52, 10), glow);
    blade.position.y = halo.position.y = y;
    blade.userData.glow = halo.userData.glow = true;
    s.add(blade, halo);
  }
}

function pistol(arm: THREE.Mesh, mat: THREE.Material) {
  const h = hand(arm);
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.14), mat);
  p.position.set(0, -0.02, -0.05);
  p.rotation.x = -((arm.userData.swingBase as number | undefined) ?? 0);
  h.add(p);
}

function cape(add: Add, color: string, w: number, top: number, z: number) {
  const c = add(new THREE.BoxGeometry(w, top - 0.12, 0.025), std(color), 0, (top + 0.12) / 2, z);
  c.rotation.x = 0.1;
}

function jetpack(add: Add, m: Mats, y: number, z: number) {
  add(new THREE.BoxGeometry(0.2, 0.2, 0.08), m.dark, 0, y, z);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.05, 0.24, 10), m.trim, s * 0.08, y + 0.01, z + 0.06);
}

// The figure's weapons: sabres if it has any, else a sidearm for
// commanders and characters, else the caller's rifle.
function arm(armR: THREE.Mesh, armL: THREE.Mesh, spec: FigureSpec, m: Mats, rifle?: () => void) {
  const sabers = spec.sabers ?? [];
  if (sabers.length) {
    raise(armR, 0.9);
    saber(armR, sabers[0], -0.35, spec.doubleSaber);
    if (sabers[1]) { raise(armL, 0.5); saber(armL, sabers[1], -0.9); }
  } else if (spec.commander || !rifle) {
    raise(armR, 0.6);
    pistol(armR, m.dark);
  } else rifle();
}

export function figure(style: FigureStyle, spec: FigureSpec, team: Team): THREE.Group {
  const build = spec.build ?? "trooper";
  const m = mats(style, spec, team);
  switch (build) {
    case "hero": return hero(m, spec, team);
    case "robed": return robed(m, spec, false);
    case "vader": return robed(m, spec, true);
    case "yoda": return yoda(m, spec);
    case "grievous": return grievous(m, spec);
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

// The faction's own trooper. Each style changes the silhouette so a glance
// tells you whose unit it is.
function trooper(style: FigureStyle, m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const { body, trim, dark } = m;
  const g = new THREE.Group();
  const add = adder(g);

  if (style === "pawn") {
    add(new THREE.CylinderGeometry(0.28, 0.36, 0.14, 24), body, 0, 0.07, 0);
    add(new THREE.CylinderGeometry(0.12, 0.24, 0.55, 24), body, 0, 0.42, 0);
    add(new THREE.SphereGeometry(0.2, 20, 16), body, 0, 0.82, 0);
    add(new THREE.TorusGeometry(0.2, 0.03, 8, 24), trim, 0, 0.66, 0).rotation.x = Math.PI / 2;
    return g;
  }

  if (style === "merc") {
    // Hooded cloak: a cone body with a head tucked into the hood.
    add(new THREE.ConeGeometry(0.3, 0.78, 20), body, 0, 0.39, 0);
    add(new THREE.SphereGeometry(0.15, 16, 12), dark, 0, 0.8, -0.02);
    const hood = add(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), body, 0, 0.82, 0.02);
    hood.rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.36, 0.05, 0.05), trim, 0, 0.52, -0.2); // belt
    if (spec.commander) add(new THREE.BoxGeometry(0.06, 0.06, 0.02), std("#e0b84a"), 0.08, 0.62, -0.18);
    else {
      const rifle = add(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8), trim, 0.22, 0.55, -0.1);
      rifle.rotation.x = 1.1;
    }
    return g;
  }

  if (style === "droid") {
    // B1: thin limbs, narrow torso, long forward-leaning head.
    const [armR, armL] = limbs(g, {
      legR: 0.035, legL: 0.035, hipX: 0.08, hipY: 0.42, armR: 0.03, armL: 0.03,
      shoulderX: 0.17, shoulderY: 0.69, legMat: body, armMat: body,
    });
    add(new THREE.BoxGeometry(0.24, 0.2, 0.1), body, 0, 0.56, 0);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), body, 0, 0.72, 0);
    const head = add(new THREE.CapsuleGeometry(0.06, 0.2, 4, 12), body, 0, 0.84, -0.06);
    head.rotation.x = Math.PI / 2 - 0.35;
    add(new THREE.SphereGeometry(0.05, 10, 8), trim, 0, 0.83, 0.05); // backpack
    if (spec.commander) {
      // Command droid: yellow markings.
      add(new THREE.BoxGeometry(0.25, 0.05, 0.11), std("#d8b23a"), 0, 0.62, 0);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), dark, -0.06, 0.95, 0.05);
    }
    arm(armR, armL, spec, m, () => {
      const blaster = add(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark, 0.17, 0.42, -0.15);
      blaster.rotation.x = 0.2;
    });
    return g;
  }

  // Humanoid troopers: rebel, imperial, clone.
  const [armR, armL] = limbs(g, {
    legR: 0.07, legL: 0.065, hipX: 0.09, hipY: 0.4, armR: 0.055, armL: 0.05,
    shoulderX: 0.2, shoulderY: 0.72, legMat: style === "rebel" ? trim : body, armMat: body,
  });
  add(new THREE.BoxGeometry(0.34, 0.36, 0.2), body, 0, 0.58, 0);
  add(new THREE.BoxGeometry(0.36, 0.06, 0.22), style === "imperial" ? dark : trim, 0, 0.42, 0); // belt
  arm(armR, armL, spec, m, () => {
    const blaster = add(new THREE.BoxGeometry(0.05, 0.07, 0.34), dark, 0.13, 0.55, -0.2);
    blaster.rotation.x = 0.15;
  });

  if (style === "rebel") {
    add(new THREE.SphereGeometry(0.13, 16, 12), std(SKIN), 0, 0.88, 0);
    // Rounded helmet with a brim, and a big field pack.
    add(new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 0.9, 0);
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 20), trim, 0, 0.9, 0);
    if (!spec.commander) add(new THREE.BoxGeometry(0.28, 0.3, 0.14), dark, 0, 0.6, 0.16);
  } else if (style === "imperial") {
    // Domed stormtrooper helmet with a dark visor band.
    add(new THREE.SphereGeometry(0.15, 18, 14), body, 0, 0.9, 0);
    add(new THREE.BoxGeometry(0.2, 0.05, 0.08), dark, 0, 0.91, -0.11);
    add(new THREE.BoxGeometry(0.09, 0.06, 0.06), dark, 0, 0.84, -0.13);
    if (!spec.commander) add(new THREE.BoxGeometry(0.22, 0.1, 0.08), body, 0, 0.62, 0.13); // backpack
  } else {
    // Clone: helmet with a T-visor, crest stripe and shoulder pauldron.
    add(new THREE.SphereGeometry(0.15, 18, 14), body, 0, 0.9, 0);
    add(new THREE.BoxGeometry(0.2, 0.04, 0.06), dark, 0, 0.93, -0.12);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.06), dark, 0, 0.87, -0.12);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.3), trim, 0, 1.04, 0);
    const pauldron = add(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, -0.2, 0.74, 0);
    pauldron.rotation.z = 0.4;
    if (spec.commander) {
      // Command kama and a rangefinder.
      add(new THREE.CylinderGeometry(0.19, 0.22, 0.16, 16, 1, true), trim, 0, 0.34, 0);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), dark, 0.13, 1.0, -0.04);
    }
  }
  if (spec.commander) cape(add, team.accent, 0.34, 0.76, 0.12);
  return g;
}

// Named characters and officers: bare head with hair, jacket over a shirt.
function hero(m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.065, legL: 0.06, hipX: 0.085, hipY: 0.4, armR: 0.05, armL: 0.045,
    shoulderX: 0.19, shoulderY: 0.72, legMat: m.dark, armMat: m.body,
  });
  add(new THREE.BoxGeometry(0.32, 0.36, 0.19), m.body, 0, 0.58, 0);
  add(new THREE.BoxGeometry(0.12, 0.3, 0.02), std("#d9d2c0"), 0, 0.6, -0.1); // shirt front
  add(new THREE.BoxGeometry(0.34, 0.05, 0.21), m.trim, 0, 0.42, 0); // belt
  add(new THREE.SphereGeometry(0.13, 16, 12), std(SKIN), 0, 0.88, 0);
  add(new THREE.SphereGeometry(0.138, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), m.trim, 0, 0.895, 0.01); // hair
  arm(armR, armL, spec, m);
  if (spec.commander) cape(add, team.accent, 0.32, 0.76, 0.11);
  return g;
}

// Jedi and Sith: long robe over hidden legs, wide sleeves, a sabre or two.
// Vader swaps the head for his helmet and the cloak for a cape.
function robed(m: Mats, spec: FigureSpec, helmet: boolean): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  add(new THREE.CylinderGeometry(0.15, 0.3, 0.52, 20), m.body, 0, 0.26, 0); // skirt
  add(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 16), m.body, 0, 0.66, 0); // chest
  add(new THREE.TorusGeometry(0.155, 0.022, 8, 20), m.dark, 0, 0.52, 0).rotation.x = Math.PI / 2; // belt
  add(new THREE.BoxGeometry(0.08, 0.6, 0.02), m.trim, 0, 0.48, -0.15).rotation.x = 0.12; // tabard
  const [armR, armL] = limbs(g, {
    legR: 0, legL: 0, hipX: 0, hipY: 0.48, armR: 0.045, armL: 0.075,
    shoulderX: 0.19, shoulderY: 0.78, legMat: m.body, armMat: m.body, noLegs: true,
  });
  if (helmet) {
    add(new THREE.SphereGeometry(0.14, 18, 14), m.body, 0, 0.94, 0);
    add(new THREE.CylinderGeometry(0.13, 0.19, 0.12, 18), m.body, 0, 0.86, 0.01);
    add(new THREE.BoxGeometry(0.07, 0.08, 0.05), std(METAL), 0, 0.88, -0.13); // grille
    add(new THREE.BoxGeometry(0.16, 0.12, 0.02), m.trim, 0, 0.68, -0.15); // chest box
    for (const [x, c] of [[-0.04, "#d03a2a"], [0, "#3a8ad0"], [0.04, "#3ac05a"]] as const)
      add(new THREE.BoxGeometry(0.02, 0.02, 0.01), std(c), x, 0.69, -0.165);
    cape(add, "#0b0b0d", 0.46, 0.84, 0.15);
  } else {
    add(new THREE.SphereGeometry(0.12, 16, 12), std(SKIN), 0, 0.92, 0);
    // Hood down round the shoulders, and a cloak behind.
    add(new THREE.TorusGeometry(0.13, 0.05, 8, 20), m.trim, 0, 0.8, 0.02).rotation.x = Math.PI / 2;
    const cloak = add(new THREE.CylinderGeometry(0.2, 0.32, 0.72, 18, 1, true, -Math.PI * 0.35, Math.PI * 0.7), m.trim, 0, 0.42, 0);
    cloak.position.z = 0.02;
    (cloak.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.4), m.dark, 0, 0.935, 0.01); // hair
  }
  arm(armR, armL, spec, m);
  return g;
}

// Yoda: a short robe, a big green head with long ears, and a green sabre.
function yoda(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const skin = std("#8fa860");
  add(new THREE.CylinderGeometry(0.13, 0.24, 0.4, 18), m.body, 0, 0.2, 0); // robe
  add(new THREE.TorusGeometry(0.15, 0.04, 8, 18), m.trim, 0, 0.42, 0.01).rotation.x = Math.PI / 2; // collar
  const [armR, armL] = limbs(g, {
    legR: 0, legL: 0, hipX: 0, hipY: 0.24, armR: 0.035, armL: 0.06,
    shoulderX: 0.15, shoulderY: 0.42, legMat: m.body, armMat: m.body, noLegs: true,
  });
  add(new THREE.SphereGeometry(0.17, 18, 14), skin, 0, 0.6, 0).scale.set(1.1, 0.9, 1);
  for (const s of [-1, 1]) {
    const ear = add(new THREE.ConeGeometry(0.05, 0.26, 10), skin, s * 0.24, 0.62, 0.02);
    ear.rotation.z = s * (Math.PI / 2 + 0.25);
    add(new THREE.SphereGeometry(0.03, 8, 6), m.dark, s * 0.06, 0.62, -0.14); // eyes
  }
  add(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.25), std("#e8e4dc"), 0, 0.62, 0.01); // wisps
  arm(armR, armL, spec, m);
  return g;
}

// Grievous: a tall bony droid in a cape, with four arms and a sabre in each.
function grievous(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.04, legL: 0.035, hipX: 0.09, hipY: 0.46, armR: 0.035, armL: 0.03,
    shoulderX: 0.2, shoulderY: 0.78, legMat: m.body, armMat: m.body,
  });
  add(new THREE.BoxGeometry(0.28, 0.3, 0.16), m.body, 0, 0.64, 0);
  add(new THREE.BoxGeometry(0.14, 0.14, 0.12), m.trim, 0, 0.5, 0); // gut sac
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), std(METAL), 0, 0.82, 0);
  const head = add(new THREE.CapsuleGeometry(0.075, 0.1, 4, 12), m.body, 0, 0.92, -0.02);
  head.scale.set(0.9, 1, 1.1);
  for (const s of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: "#e0c040" }), s * 0.035, 0.94, -0.1);
    eye.userData.glow = true;
  }
  cape(add, "#5a5f68", 0.34, 0.8, 0.11);
  // The lower pair of arms hangs just under the shoulders.
  const lower: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const len = 0.3;
    const a = add(new THREE.CylinderGeometry(0.028, 0.024, len, 8).translate(0, -len / 2, 0), m.body, s * 0.17, 0.7, -0.02);
    a.rotation.z = s * 0.45;
    a.userData.swing = s * 0.6;
    a.userData.armLength = len;
    lower.push(a);
  }
  const sabers = spec.sabers ?? [];
  arm(armR, armL, { ...spec, sabers: sabers.slice(0, 2) }, m);
  [sabers[2], sabers[3]].forEach((c, i) => {
    if (!c) return;
    raise(lower[i], 0.7);
    saber(lower[i], c, i ? -1.1 : -0.6);
  });
  return g;
}

function mando(m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.07, legL: 0.065, hipX: 0.09, hipY: 0.4, armR: 0.055, armL: 0.05,
    shoulderX: 0.2, shoulderY: 0.72, legMat: m.dark, armMat: m.dark,
  });
  add(new THREE.BoxGeometry(0.34, 0.36, 0.2), m.dark, 0, 0.58, 0);
  add(new THREE.BoxGeometry(0.3, 0.2, 0.04), m.body, 0, 0.64, -0.1); // chest plate
  add(new THREE.BoxGeometry(0.36, 0.06, 0.22), m.trim, 0, 0.42, 0);
  for (const s of [-1, 1]) {
    const p = add(new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.trim, s * 0.2, 0.74, 0);
    p.rotation.z = -s * 0.4;
  }
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 18), m.body, 0, 0.9, 0); // bucket helmet
  add(new THREE.SphereGeometry(0.14, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.body, 0, 1.02, 0);
  add(new THREE.BoxGeometry(0.18, 0.04, 0.03), m.dark, 0, 0.93, -0.13); // T-visor
  add(new THREE.BoxGeometry(0.045, 0.12, 0.03), m.dark, 0, 0.87, -0.13);
  jetpack(add, m, 0.66, 0.14);
  arm(armR, armL, spec, m, () => {
    const blaster = add(new THREE.BoxGeometry(0.05, 0.07, 0.3), m.trim, 0.13, 0.55, -0.2);
    blaster.rotation.x = 0.15;
  });
  if (spec.commander) cape(add, team.accent, 0.3, 0.74, 0.22);
  return g;
}

function wookiee(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.09, legL: 0.085, hipX: 0.11, hipY: 0.44, armR: 0.075, armL: 0.065,
    shoulderX: 0.25, shoulderY: 0.84, legMat: m.body, armMat: m.body,
  });
  add(new THREE.BoxGeometry(0.42, 0.44, 0.26), m.body, 0, 0.66, 0);
  add(new THREE.SphereGeometry(0.15, 16, 12), m.body, 0, 1.0, -0.01);
  add(new THREE.SphereGeometry(0.07, 12, 10), m.trim, 0, 0.97, -0.13); // muzzle
  const band = add(new THREE.BoxGeometry(0.06, 0.62, 0.28), m.dark, 0, 0.68, 0); // bandolier
  band.rotation.z = 0.7;
  arm(armR, armL, spec, m, () => {
    // Bowcaster.
    add(new THREE.BoxGeometry(0.06, 0.08, 0.4), m.dark, 0.16, 0.62, -0.22);
    add(new THREE.BoxGeometry(0.3, 0.02, 0.03), std(METAL), 0.16, 0.66, -0.4);
  });
  return g;
}

function ewok(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR] = limbs(g, {
    legR: 0.07, legL: 0.07, hipX: 0.09, hipY: 0.2, armR: 0.05, armL: 0.05,
    shoulderX: 0.2, shoulderY: 0.48, legMat: m.body, armMat: m.body,
  });
  add(new THREE.SphereGeometry(0.22, 18, 14), m.body, 0, 0.36, 0).scale.set(1, 1.05, 0.9);
  add(new THREE.SphereGeometry(0.2, 18, 14), m.body, 0, 0.68, 0);
  add(new THREE.SphereGeometry(0.09, 12, 10), m.dark, 0, 0.64, -0.15); // face
  // Leather hood with ears poking out.
  add(new THREE.SphereGeometry(0.215, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.trim, 0, 0.7, 0.02);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.05, 10, 8), m.body, s * 0.15, 0.86, 0.02);
  // Spear in the right hand.
  const h = hand(armR);
  const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), m.dark);
  spear.position.y = 0.15;
  h.add(spear);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), std(METAL));
  tip.position.y = 0.64;
  h.add(tip);
  return g;
}

function insect(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  limbs(g, {
    legR: 0.04, legL: 0.035, hipX: 0.08, hipY: 0.44, armR: 0.035, armL: 0.03,
    shoulderX: 0.17, shoulderY: 0.72, legMat: m.body, armMat: m.body,
  });
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 12), m.body, 0, 0.6, 0);
  const head = add(new THREE.SphereGeometry(0.1, 14, 12), m.body, 0, 0.88, -0.04);
  head.scale.set(1, 1.6, 1.1);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.03, 8, 6), std("#c8a030"), s * 0.05, 0.9, -0.12); // eyes
  // Folded wings.
  const wing = new THREE.MeshStandardMaterial({ color: "#d8d0b0", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) {
    const w = add(new THREE.PlaneGeometry(0.16, 0.5), wing, s * 0.08, 0.6, 0.1);
    w.rotation.set(0.15, s * 0.5, s * 0.15);
    w.userData.glow = true;
  }
  const blaster = add(new THREE.CylinderGeometry(0.04, 0.025, 0.28, 8), m.dark, 0.13, 0.55, -0.18);
  blaster.rotation.x = Math.PI / 2;
  return g;
}

function b2(m: Mats, spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.055, legL: 0.05, hipX: 0.11, hipY: 0.42, armR: 0.065, armL: 0.06,
    shoulderX: 0.25, shoulderY: 0.74, legMat: m.body, armMat: m.body,
  });
  const torso = add(new THREE.BoxGeometry(0.4, 0.34, 0.3), m.body, 0, 0.63, -0.02);
  torso.rotation.x = 0.15;
  add(new THREE.BoxGeometry(0.2, 0.12, 0.2), m.trim, 0, 0.47, 0);
  add(new THREE.BoxGeometry(0.12, 0.09, 0.12), m.body, 0, 0.84, -0.12); // small sunken head
  add(new THREE.BoxGeometry(0.06, 0.02, 0.01), std("#e04030"), 0, 0.85, -0.185);
  // Wrist blasters.
  for (const a of [armR, armL]) {
    const h = hand(a);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), m.dark);
    gun.position.set(0, 0.04, -0.04);
    h.add(gun);
  }
  raise(armR, 0.5);
  raise(armL, 0.5);
  if (spec.jetpack) jetpack(add, m, 0.66, 0.16);
  return g;
}

// IG-88, K-2SO, tactical droids, MagnaGuards, dark troopers: tall and thin.
function tallDroid(m: Mats, spec: FigureSpec, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const [armR, armL] = limbs(g, {
    legR: 0.045, legL: 0.04, hipX: 0.085, hipY: 0.46, armR: 0.04, armL: 0.035,
    shoulderX: 0.2, shoulderY: 0.78, legMat: m.body, armMat: m.body,
  });
  add(new THREE.BoxGeometry(0.3, 0.32, 0.16), m.body, 0, 0.64, 0);
  add(new THREE.BoxGeometry(0.18, 0.1, 0.12), m.trim, 0, 0.5, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), std(METAL), 0, 0.84, 0);
  const head = add(new THREE.CapsuleGeometry(0.07, 0.1, 4, 12), m.body, 0, 0.95, 0);
  head.scale.set(1.1, 1, 1);
  for (const s of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff5a3a" }), s * 0.035, 0.97, -0.065);
    eye.userData.glow = true;
  }
  arm(armR, armL, spec, m, () => {
    const blaster = add(new THREE.BoxGeometry(0.04, 0.06, 0.4), m.dark, 0.13, 0.58, -0.2);
    blaster.rotation.x = 0.15;
  });
  if (spec.commander) cape(add, team.accent, 0.28, 0.78, 0.1);
  return g;
}

function droideka(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  // Three thin legs: two forward, one behind.
  const legs: [number, number, number][] = [[0.18, -0.12, 1], [-0.18, -0.12, -1], [0, 0.2, 1]];
  for (const [x, z, s] of legs) {
    const hip = new THREE.Group();
    hip.position.set(x * 0.4, 0.46, z * 0.4);
    hip.userData.swing = s * 0.5;
    g.add(hip);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.5, 6), m.dark);
    leg.position.set(x * 0.5, -0.23, z * 0.5);
    leg.rotation.set(-z * 0.9, 0, x * 0.9);
    hip.add(leg);
  }
  add(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.body, 0, 0.46, 0.04).rotation.x = -0.5; // shell
  add(new THREE.SphereGeometry(0.08, 12, 10), m.trim, 0, 0.6, -0.12).scale.set(1, 0.7, 1.3); // head
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.06, 0.24), m.dark, s * 0.17, 0.42, -0.14); // twin blasters
  // Deflector shield bubble.
  const shield = add(new THREE.SphereGeometry(0.46, 24, 16), new THREE.MeshStandardMaterial({
    color: "#7ad0ff", transparent: true, opacity: 0.14, depthWrite: false, emissive: "#3a90d0", emissiveIntensity: 0.4,
  }), 0, 0.42, 0);
  shield.userData.glow = true;
  return g;
}

function astromech(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  add(new THREE.CylinderGeometry(0.17, 0.16, 0.42, 20), m.body, 0, 0.42, 0);
  add(new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(METAL), 0, 0.63, 0);
  add(new THREE.BoxGeometry(0.1, 0.06, 0.04), m.trim, 0, 0.7, -0.14);
  add(new THREE.SphereGeometry(0.03, 8, 6), m.dark, 0.05, 0.76, -0.13); // eye
  add(new THREE.BoxGeometry(0.12, 0.16, 0.02), m.trim, 0, 0.42, -0.16);
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.2, 0.56, 0);
    leg.userData.swing = s * 0.3;
    g.add(leg);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.1), m.body);
    strut.position.y = -0.25;
    leg.add(strut);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), m.trim);
    foot.position.y = -0.53;
    leg.add(foot);
  }
  add(new THREE.BoxGeometry(0.08, 0.1, 0.1), m.trim, 0, 0.1, 0); // centre foot
  return g;
}

function probe(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  add(new THREE.SphereGeometry(0.2, 18, 14), m.body, 0, 0.72, 0);
  for (const [x, y] of [[0, 0.74], [-0.07, 0.68], [0.07, 0.68]]) {
    const eye = add(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff3a2a" }), x, y, -0.19);
    eye.userData.glow = true;
  }
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), m.trim, 0.08, 1.0, 0.04);
  // Dangling manipulator legs.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const hip = new THREE.Group();
    hip.position.set(Math.sin(a) * 0.1, 0.56, Math.cos(a) * 0.1);
    hip.userData.swing = i % 2 ? 0.4 : -0.4;
    g.add(hip);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.4, 6).translate(0, -0.2, 0), m.trim);
    leg.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
    hip.add(leg);
  }
  return g;
}

// --- Riders -------------------------------------------------------------------

function rider(style: FigureStyle, mount: MountKind, pilot: FigureSpec | undefined, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const skin = std(mount === "tauntaun" ? "#e4dccb" : mount === "boga" ? "#5f8a4a" : "#8a7a52");
  const belly = std(mount === "tauntaun" ? "#c8bca4" : mount === "boga" ? "#c8b878" : "#b0a070");
  const leg = (x: number, y: number, z: number, len: number, r: number, s: number) => {
    const hip = new THREE.Group();
    hip.position.set(x, y, z);
    hip.userData.swing = s;
    g.add(hip);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, len, 10).translate(0, -len / 2, 0), skin);
    hip.add(l);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r, r * 3), skin);
    foot.position.set(0, -len + r / 2, -r);
    hip.add(foot);
  };
  let seatY: number;
  if (mount === "tauntaun") {
    // Upright biped: big haunches, a neck curving forward, curled horns.
    for (const s of [1, -1]) leg(s * 0.13, 0.52, 0.05, 0.5, 0.08, s);
    add(new THREE.SphereGeometry(0.26, 18, 14), skin, 0, 0.66, 0.02).scale.set(0.95, 0.9, 1.2);
    add(new THREE.SphereGeometry(0.2, 16, 12), belly, 0, 0.62, -0.1).scale.set(0.9, 1, 0.8);
    const neck = add(new THREE.CylinderGeometry(0.09, 0.13, 0.36, 12), skin, 0, 0.9, -0.2);
    neck.rotation.x = -0.7;
    const head = add(new THREE.SphereGeometry(0.11, 14, 12), skin, 0, 1.06, -0.36);
    head.scale.set(0.9, 0.9, 1.4);
    for (const s of [-1, 1]) add(new THREE.TorusGeometry(0.05, 0.015, 6, 12, Math.PI * 1.4), belly, s * 0.08, 1.12, -0.32).rotation.y = s * Math.PI / 2;
    const tail = add(new THREE.ConeGeometry(0.07, 0.36, 10), skin, 0, 0.5, 0.36);
    tail.rotation.x = 1.9;
    seatY = 0.82;
  } else {
    // Low quadruped lizard; the boga is bigger with a frill and stripes.
    const big = mount === "boga";
    for (const [x, z, s] of [[0.2, -0.28, 1], [-0.2, -0.28, -1], [0.2, 0.26, -1], [-0.2, 0.26, 1]] as const)
      leg(x, 0.3, z, 0.3, 0.07, s);
    add(new THREE.SphereGeometry(0.3, 18, 14), skin, 0, 0.38, 0).scale.set(0.95, 0.75, 1.55);
    add(new THREE.SphereGeometry(0.25, 16, 12), belly, 0, 0.3, 0).scale.set(0.9, 0.6, 1.4);
    const head = add(new THREE.SphereGeometry(0.13, 14, 12), skin, 0, big ? 0.6 : 0.45, -0.56);
    head.scale.set(0.9, 0.8, 1.3);
    if (big) {
      add(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 12), skin, 0, 0.52, -0.42).rotation.x = -0.9;
      const frill = add(new THREE.CircleGeometry(0.18, 16), belly, 0, 0.66, -0.5);
      (frill.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
    const tail = add(new THREE.ConeGeometry(0.1, 0.6, 10), skin, 0, 0.32, 0.72);
    tail.rotation.x = 1.75;
    add(new THREE.BoxGeometry(0.34, 0.06, 0.3), std("#5a3a22"), 0, 0.58, 0.02); // saddle
    seatY = 0.58;
  }
  const p = seated(style, pilot, team, 0.62);
  p.position.set(0, seatY - 0.62 * 0.3, mount === "tauntaun" ? 0.06 : 0.02);
  g.add(p);
  return g;
}

// --- Vehicles -----------------------------------------------------------------

// A figure sitting down: legs out in front instead of swinging (the arms
// still swing with the walk cycle).
function seated(style: FigureStyle, pilot: FigureSpec | undefined, team: Team, scale: number): THREE.Group {
  const p = figure(style, pilot ?? {}, team);
  p.traverse((o) => { if (o.userData.swing && o.position.y < 0.5) { o.userData.swing = 0; o.rotation.x = 1.3; } });
  p.scale.setScalar(scale);
  return p;
}

function vehicle(style: FigureStyle, frame: VehicleFrame, pilot: FigureSpec | undefined, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const c = STYLE_COLORS[style];
  const hullMat = std(team.color);
  const trim = std(style === "pawn" ? team.accent : c.trim);
  const dark = std(c.dark);
  const metal = std(METAL);
  const gun = (x: number, y: number, z: number, len: number, r = 0.03) => {
    const b = add(new THREE.CylinderGeometry(r, r, len, 8), dark, x, y, z - len / 2);
    b.rotation.x = Math.PI / 2;
    return b;
  };

  switch (frame) {
    case "tank": {
      add(new THREE.BoxGeometry(0.62, 0.22, 0.92), hullMat, 0, 0.2, 0);
      add(new THREE.BoxGeometry(0.5, 0.06, 0.7), trim, 0, 0.34, 0);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.18, 0.96), dark, s * 0.36, 0.1, 0);
      add(new THREE.CylinderGeometry(0.18, 0.2, 0.14, 16), trim, 0, 0.44, 0);
      gun(0, 0.46, -0.08, 0.45);
      break;
    }
    case "hover-tank": {
      const hull = add(new THREE.CylinderGeometry(0.3, 0.34, 0.2, 6), hullMat, 0, 0.24, 0);
      hull.scale.set(1, 1, 1.5);
      hull.rotation.y = Math.PI / 6;
      add(new THREE.BoxGeometry(0.44, 0.05, 0.6), trim, 0, 0.36, 0.04);
      for (const s of [-1, 1]) {
        const pod = add(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 12), dark, s * 0.34, 0.2, 0.22);
        pod.rotation.x = Math.PI / 2;
        add(new THREE.CircleGeometry(0.07, 12), new THREE.MeshBasicMaterial({ color: "#7ad0ff" }), s * 0.34, 0.2, 0.432).userData.glow = true;
      }
      add(new THREE.BoxGeometry(0.28, 0.12, 0.3), trim, 0, 0.44, 0.02);
      for (const s of [-1, 1]) gun(s * 0.06, 0.46, -0.12, 0.42, 0.022);
      break;
    }
    case "landspeeder": {
      add(new THREE.BoxGeometry(0.5, 0.14, 0.86), hullMat, 0, 0.24, 0).scale.set(1, 1, 1);
      add(new THREE.BoxGeometry(0.44, 0.04, 0.4), dark, 0, 0.32, 0.04); // seats well
      const screen = add(new THREE.BoxGeometry(0.42, 0.12, 0.02), new THREE.MeshStandardMaterial({
        color: "#9fd0ff", transparent: true, opacity: 0.45, depthWrite: false }), 0, 0.38, -0.2);
      screen.rotation.x = -0.6;
      for (const x of [-0.24, 0, 0.24]) {
        const eng = add(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 12), metal, x, x ? 0.28 : 0.38, 0.42);
        eng.rotation.x = Math.PI / 2;
      }
      const p = seated(style, pilot, team, 0.42);
      p.position.set(-0.1, 0.16, 0.05);
      g.add(p);
      break;
    }
    case "bike": {
      add(new THREE.BoxGeometry(0.14, 0.12, 0.6), hullMat, 0, 0.3, 0.06);
      add(new THREE.BoxGeometry(0.18, 0.14, 0.2), dark, 0, 0.3, 0.32); // engine
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), metal, 0, 0.3, 0.45).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), metal, s * 0.05, 0.3, -0.44).rotation.x = Math.PI / 2;
        add(new THREE.BoxGeometry(0.02, 0.12, 0.16), trim, s * 0.05, 0.3, -0.7); // steering vanes
      }
      const p = seated(style, pilot, team, 0.5);
      p.rotation.x = -0.25; // leaning into the ride
      p.position.set(0, 0.12, 0.08);
      g.add(p);
      break;
    }
    case "walker":
    case "scout-walker": {
      const scout = frame === "scout-walker";
      const hipY = 0.62;
      for (const s of [1, -1]) {
        const hip = new THREE.Group();
        hip.position.set(s * (scout ? 0.12 : 0.17), hipY, 0);
        hip.userData.swing = s * 0.7;
        g.add(hip);
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.06, hipY * 0.55, 0.08).translate(0, -hipY * 0.275, 0), hullMat);
        thigh.rotation.x = -0.35;
        hip.add(thigh);
        const shin = new THREE.Mesh(new THREE.BoxGeometry(0.05, hipY * 0.55, 0.06).translate(0, -hipY * 0.275, 0), dark);
        shin.position.set(0, -hipY * 0.52, 0.18 * hipY);
        shin.rotation.x = 0.5;
        hip.add(shin);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.2), hullMat);
        foot.position.set(0, -hipY + 0.02, -0.02);
        hip.add(foot);
      }
      if (scout) {
        add(new THREE.BoxGeometry(0.22, 0.12, 0.26), hullMat, 0, 0.68, 0);
        gun(0, 0.62, -0.12, 0.3, 0.025);
        const p = seated(style, pilot, team, 0.36);
        p.position.set(0, 0.62, 0.03);
        g.add(p);
      } else {
        add(new THREE.BoxGeometry(0.36, 0.24, 0.4), hullMat, 0, 0.82, 0);
        add(new THREE.BoxGeometry(0.3, 0.06, 0.06), dark, 0, 0.85, -0.2); // viewport
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), trim, 0, 0.96, 0.04); // hatch
        for (const s of [-1, 1]) gun(s * 0.21, 0.82, -0.08, 0.22, 0.03);
        gun(0, 0.72, -0.18, 0.18, 0.025);
      }
      break;
    }
    case "airspeeder": {
      add(new THREE.BoxGeometry(0.22, 0.12, 0.8), hullMat, 0, 0.3, 0);
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(0.14, 0.08, 0.62), hullMat, s * 0.22, 0.28, -0.04);
        add(new THREE.BoxGeometry(0.035, 0.08, 0.2), dark, s * 0.22, 0.28, -0.42); // split nose
        add(new THREE.BoxGeometry(0.08, 0.02, 0.4), trim, s * 0.32, 0.25, 0.1);
      }
      add(new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
        color: "#9fd0ff", transparent: true, opacity: 0.6 }), 0, 0.36, -0.06).scale.set(1, 0.8, 1.6);
      gun(0, 0.3, 0.6, 0.2, 0.02).rotation.x = -Math.PI / 2;
      break;
    }
    case "gunship": {
      add(new THREE.BoxGeometry(0.3, 0.22, 0.86), hullMat, 0, 0.34, 0.04);
      add(new THREE.SphereGeometry(0.15, 16, 12), hullMat, 0, 0.36, -0.4).scale.set(1, 0.8, 1.3);
      add(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshStandardMaterial({ color: "#9fd0ff", transparent: true, opacity: 0.7 }), 0, 0.42, -0.5);
      add(new THREE.BoxGeometry(1.0, 0.03, 0.26), trim, 0, 0.42, 0.06); // wings
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(0.02, 0.16, 0.36), dark, s * 0.152, 0.32, 0.06); // open troop bay
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), dark, s * 0.42, 0.44, -0.02);
      }
      add(new THREE.BoxGeometry(0.03, 0.16, 0.18), hullMat, 0, 0.52, 0.4); // tail fin
      break;
    }
    case "crawler": {
      add(new THREE.SphereGeometry(0.26, 18, 14), hullMat, 0, 0.42, 0).scale.set(1.1, 0.6, 1);
      add(new THREE.BoxGeometry(0.2, 0.08, 0.1), dark, 0, 0.42, -0.26);
      for (const s of [-1, 1]) {
        const eye = add(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff3a2a" }), s * 0.06, 0.46, -0.27);
        eye.userData.glow = true;
      }
      gun(0, 0.38, -0.28, 0.3, 0.03);
      for (const [x, z, s] of [[1, -1, 1], [-1, -1, -1], [1, 1, -1], [-1, 1, 1]] as const) {
        const hip = new THREE.Group();
        hip.position.set(x * 0.2, 0.44, z * 0.16);
        hip.userData.swing = s * 0.4;
        g.add(hip);
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05).translate(x * 0.15, 0, 0), hullMat);
        upper.rotation.z = x * 0.5;
        hip.add(upper);
        const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.015, 0.38, 6), dark);
        lower.position.set(x * 0.3, -0.24, 0);
        lower.rotation.z = -x * 0.25;
        hip.add(lower);
      }
      break;
    }
  }
  return g;
}

function emplacement(style: FigureStyle, team: Team): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const dark = std(STYLE_COLORS[style].dark);
  add(new THREE.BoxGeometry(0.7, 0.25, 0.5), std(team.color), 0, 0.125, 0);
  const gun = add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), dark, 0, 0.32, -0.2);
  gun.rotation.x = Math.PI / 2;
  const crew = figure(style, {}, team);
  crew.scale.setScalar(0.55);
  crew.position.set(0, 0.25, 0.15);
  g.add(crew);
  return g;
}

// --- Helpers ------------------------------------------------------------------

export function std(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
}

// Glowing bits (blades, shields, eyes, wings) neither cast nor take shadows.
export function shadows(g: THREE.Object3D) {
  g.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const lit = !o.userData.glow;
    o.castShadow = lit;
    o.receiveShadow = lit;
  });
}

// Scale a unit-sized model so its footprint matches and its height is
// modelHeight, whichever is tighter.
function fit(g: THREE.Group, footprint: number, modelHeight: number) {
  shadows(g);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const s = Math.min((footprint * 0.9) / Math.max(size.x, size.z, 1e-3), modelHeight / Math.max(size.y, 1e-3));
  g.scale.setScalar(s);
}
