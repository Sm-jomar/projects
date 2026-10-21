// Semi-3D view of a tabletop, shared by the Legion and D&D boards.
//
// The 2D boards stay the place where pieces are moved; this view is for
// reading height and depth: terrain is extruded to its set height, pieces
// stand on whatever they're on top of, and hovering/flying pieces float at
// their elevation on a clear stand with a shadow on the ground beneath.
//
// Coordinates: the caller works in its own board units (inches for Legion,
// grid cells for D&D) with x to the right and y down the board. Here that
// maps to three.js x and z, with y up.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { decodeModel } from "../lib/stlModel";

export type FigureStyle = "rebel" | "imperial" | "clone" | "droid" | "merc" | "pawn";

export type PieceModel =
  | { kind: "figure"; style: FigureStyle }
  | { kind: "vehicle"; style: FigureStyle; repulsor: boolean }
  | { kind: "emplacement"; style: FigureStyle }
  | { kind: "marker" }
  | { kind: "stl"; data: string };

export type Piece3D = {
  id: string;
  /** Centre of the footprint, board units. */
  x: number;
  y: number;
  /** Base diameter, board units. */
  footprint: number;
  /** Height of the model itself, board units. */
  modelHeight: number;
  /** Height above the table/terrain it stands on (hover / flight). */
  lift: number;
  /** Primary and accent colours: body + trim / base rim. */
  color: string;
  accent: string;
  model: PieceModel;
  /** Image shown semi-transparent on the base under the model. */
  iconUrl?: string;
  /** For card art: crop to the top square of a portrait image. */
  iconCropTop?: boolean;
  /** Facing in degrees, 0 = up the board. */
  facing?: number;
  dim?: boolean;
};

export type Block3D = {
  id: string;
  shape: "rect" | "circle";
  /** Top-left corner (rect) / bounding-box corner (circle), board units. */
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
  height: number;
  color: string;
  edge: string;
  style?: "solid" | "forest" | "objective";
  /** Pieces can stand on top of this (buildings, rocks) vs. stand inside it. */
  standable?: boolean;
  /** Hover highlight: green if the selected piece flies over it, red if not. */
  tint?: "clear" | "block" | null;
  /** Uploaded STL (lib/stlModel encoding), stretched to fill the block. */
  stl?: string;
  selected?: boolean;
};

export type Zone3D = { x: number; y: number; w: number; d: number; color: string };

type Props = {
  width: number;
  depth: number;
  groundColor: string;
  groundImageUrl?: string | null;
  /** Grid line spacing in board units (0/undefined = no grid). */
  gridStep?: number;
  gridColor?: string;
  gridOpacity?: number;
  zones?: Zone3D[];
  /** Drawn over the ground, under terrain and pieces, stretched to the
   * board (e.g. D&D fog of war). Transparent where the ground shows. */
  overlay?: HTMLCanvasElement | null;
  blocks: Block3D[];
  pieces: Piece3D[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export default function Board3D(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<SceneCtx | null>(null);
  const propsRef = useRef(props);

  // One renderer per mount. Scene content is rebuilt on prop changes below.
  useEffect(() => {
    const host = hostRef.current!;
    const ctx = createScene(host, (id) => propsRef.current.onSelect(id));
    ctxRef.current = ctx;
    return () => { ctx.dispose(); ctxRef.current = null; };
  }, []);

  const { width, depth } = props;
  useEffect(() => { ctxRef.current?.frame(width, depth); }, [width, depth]);

  useEffect(() => {
    propsRef.current = props;
    ctxRef.current?.build(props);
  });

  return (
    <div className="board3d" ref={hostRef}>
      <div className="board3d-hint small">Drag to orbit · right-drag to pan · scroll to zoom · click a piece or terrain to select</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type SceneCtx = {
  build: (p: Props) => void;
  frame: (w: number, d: number) => void;
  dispose: () => void;
};

function createScene(host: HTMLDivElement, onPick: (id: string | null) => void): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "board3d-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0d12");
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  // "Semi" 3D: never below the table, never perfectly top-down.
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight("#dfe8ff", "#30281c", 1.1));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  let content = new THREE.Group();
  scene.add(content);
  const pickables: THREE.Object3D[] = [];
  const stlGeoms = new Map<string, THREE.BufferGeometry | null>();
  let boardW = 1, boardD = 1;
  let disposed = false;

  let framed = false;
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Re-frame until the user has moved the camera themselves.
    if (!framed) frame(boardW, boardD);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  const onWheelAny = () => { framed = true; };
  renderer.domElement.addEventListener("wheel", onWheelAny, { passive: true });

  // Look at the whole board from the near long edge, tilted ~50° down,
  // far enough back that it fits the viewport.
  function frame(w: number, d: number) {
    boardW = w; boardD = d;
    const span = Math.max(w, d);
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = 1.1 * Math.max((d * 0.75) / (2 * Math.tan(vfov / 2)), w / (2 * Math.tan(hfov / 2))) + d * 0.2;
    const tilt = (50 * Math.PI) / 180; // from vertical
    controls.target.set(0, 0, 0);
    camera.position.set(0, dist * Math.cos(tilt), dist * Math.sin(tilt));
    camera.near = span / 500;
    camera.far = span * 20;
    camera.updateProjectionMatrix();
    controls.minDistance = span * 0.05;
    controls.maxDistance = span * 3;
    sun.position.set(-span * 0.4, span * 1.1, span * 0.3);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -span * 0.75; sc.right = span * 0.75; sc.top = span * 0.75; sc.bottom = -span * 0.75;
    sc.near = 0.1; sc.far = span * 4;
    sc.updateProjectionMatrix();
    controls.update();
  }

  // Images are cached by URL; every use gets its own Texture (so each can
  // crop differently) which is disposed with the build that made it.
  const images = new Map<string, { img: HTMLImageElement; ready: boolean; waiting: (() => void)[] }>();
  function texture(url: string, onReady?: (t: THREE.Texture) => void): THREE.Texture {
    let e = images.get(url);
    if (!e) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const entry = { img, ready: false, waiting: [] as (() => void)[] };
      img.onload = () => { entry.ready = true; for (const w of entry.waiting) w(); entry.waiting = []; };
      img.src = url;
      images.set(url, entry);
      e = entry;
    }
    const t = new THREE.Texture(e.img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.userData.owned = true;
    const done = () => { t.needsUpdate = true; onReady?.(t); };
    if (e.ready) done(); else e.waiting.push(done);
    return t;
  }

  function stlGeometry(data: string): THREE.BufferGeometry | null {
    if (stlGeoms.has(data)) return stlGeoms.get(data)!;
    const m = decodeModel(data);
    let g: THREE.BufferGeometry | null = null;
    if (m) {
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeVertexNormals();
      g.userData.shared = true;
    }
    stlGeoms.set(data, g);
    return g;
  }

  // Board coordinates → world: centre the board on the origin.
  const wx = (x: number) => x - boardW / 2;
  const wz = (y: number) => y - boardD / 2;

  function build(p: Props) {
    if (disposed) return;
    scene.remove(content);
    disposeGroup(content);
    content = new THREE.Group();
    scene.add(content);
    pickables.length = 0;
    boardW = p.width; boardD = p.depth;

    // --- Ground ----------------------------------------------------------
    const groundMat = new THREE.MeshStandardMaterial({ color: p.groundColor, roughness: 0.95 });
    if (p.groundImageUrl) {
      // Swap the map in once it has loaded (a remote image without CORS
      // headers never does, and the board just keeps its plain colour).
      texture(p.groundImageUrl, (t) => {
        groundMat.map = t;
        groundMat.color.set("#ffffff");
        groundMat.needsUpdate = true;
      });
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.depth), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    content.add(ground);
    // Table edge, so the board reads as a slab.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(p.width, p.width * 0.02 + 0.2, p.depth),
      new THREE.MeshStandardMaterial({ color: "#20242c", roughness: 1 }),
    );
    slab.position.y = -(p.width * 0.01 + 0.1) - 0.001;
    content.add(slab);

    if (p.gridStep && p.gridStep > 0) {
      const pts: number[] = [];
      for (let x = 0; x <= p.width + 1e-6; x += p.gridStep) pts.push(wx(x), 0.01, wz(0), wx(x), 0.01, wz(p.depth));
      for (let y = 0; y <= p.depth + 1e-6; y += p.gridStep) pts.push(wx(0), 0.01, wz(y), wx(p.width), 0.01, wz(y));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      content.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: p.gridColor ?? "#2a3a48", transparent: true, opacity: p.gridOpacity ?? 0.8,
      })));
    }

    for (const z of p.zones ?? []) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.w, z.d),
        new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.16, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(wx(z.x + z.w / 2), 0.015, wz(z.y + z.d / 2));
      content.add(m);
    }

    if (p.overlay) {
      const t = new THREE.CanvasTexture(p.overlay);
      t.colorSpace = THREE.SRGBColorSpace;
      t.userData.owned = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.depth),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      content.add(m);
    }

    // --- Terrain ---------------------------------------------------------
    for (const b of p.blocks) {
      const bo = buildBlock(b);
      bo.traverse((o) => { o.userData.pieceId = b.id; });
      pickables.push(bo);
      content.add(bo);
    }

    // --- Pieces ----------------------------------------------------------
    const unit = Math.max(p.width, p.depth) / 400; // hairline thickness
    for (const pc of p.pieces) {
      const g = new THREE.Group();
      const standOn = surfaceUnder(p.blocks, pc.x, pc.y);
      const baseY = standOn + pc.lift;
      g.position.set(wx(pc.x), 0, wz(pc.y));
      g.rotation.y = -((pc.facing ?? 0) * Math.PI) / 180;
      const sel = pc.id === p.selectedId;
      const r = pc.footprint / 2;

      // Base disc + rim in the accent colour.
      const baseH = Math.max(0.04, pc.footprint * 0.08);
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.02, baseH, 40),
        new THREE.MeshStandardMaterial({ color: "#16181d", roughness: 0.7 }),
      );
      base.position.y = baseY + baseH / 2;
      base.castShadow = true;
      g.add(base);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.99, Math.max(unit, pc.footprint * 0.035), 8, 48),
        new THREE.MeshStandardMaterial({ color: sel ? "#ffd24a" : pc.accent, emissive: sel ? "#7a5a00" : "#000", roughness: 0.4 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = baseY + baseH;
      g.add(rim);

      // Semi-transparent unit icon on top of the base, under the model.
      if (pc.iconUrl) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
        mat.map = texture(pc.iconUrl, (tex) => {
          const img = tex.image as HTMLImageElement;
          const ar = img.naturalWidth / img.naturalHeight;
          if (!ar) return;
          // Square crop: the top of a portrait card (where the art is), or
          // the centre of anything else.
          if (ar < 1) { tex.repeat.set(1, ar); tex.offset.set(0, pc.iconCropTop ? 1 - ar : (1 - ar) / 2); }
          else if (ar > 1) { tex.repeat.set(1 / ar, 1); tex.offset.set((1 - 1 / ar) / 2, 0); }
        });
        // Sits on the surface under the piece, a little wider than the
        // base so it shows around the model (and under a flyer's stand).
        const icon = new THREE.Mesh(new THREE.CircleGeometry(r * 1.45, 48), mat);
        icon.rotation.x = -Math.PI / 2;
        icon.rotation.z = ((pc.facing ?? 0) * Math.PI) / 180;
        icon.position.y = standOn + 0.012;
        icon.renderOrder = 2;
        g.add(icon);
      }

      // Hover / flight: clear stand down to the surface + ground shadow ring.
      if (pc.lift > 0.001) {
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.08, r * 0.08, pc.lift, 12),
          new THREE.MeshStandardMaterial({ color: "#bfe3ff", transparent: true, opacity: 0.35, roughness: 0.1 }),
        );
        stand.position.y = standOn + pc.lift / 2;
        g.add(stand);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r * 0.85, r, 40),
          new THREE.MeshBasicMaterial({ color: pc.accent, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = standOn + 0.02;
        g.add(ring);
      }

      const model = buildModel(pc, stlGeometry);
      model.position.y = baseY + baseH;
      g.add(model);

      if (pc.dim) {
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m && "opacity" in m) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.45); }
        });
      }
      g.traverse((o) => { o.userData.pieceId = pc.id; });
      pickables.push(g);
      content.add(g);
    }
  }

  // --- Picking ------------------------------------------------------------
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; framed = true; };
  const onUp = (e: PointerEvent) => {
    if (!down || e.button !== 0) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return; // that was an orbit, not a click
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, true)[0];
    onPick((hit?.object.userData.pieceId as string | undefined) ?? null);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    build,
    frame,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("wheel", onWheelAny);
      controls.dispose();
      disposeGroup(content);
      for (const g of stlGeoms.values()) g?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  function buildBlock(b: Block3D): THREE.Object3D {
    const g = new THREE.Group();
    const cx = wx(b.x + b.w / 2), cz = wz(b.y + (b.shape === "circle" ? b.w : b.d) / 2);
    g.position.set(cx, 0, cz);
    g.rotation.y = -(b.rotation * Math.PI) / 180;
    const tintColor = b.tint === "clear" ? "#4ac86a" : b.tint === "block" ? "#e2554a" : null;
    const h = Math.max(0.02, b.height);

    const stlGeom = b.stl ? stlGeometry(b.stl) : null;
    if (stlGeom) {
      stlGeom.computeBoundingBox();
      const size = stlGeom.boundingBox!.getSize(new THREE.Vector3());
      const mesh = new THREE.Mesh(stlGeom, new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.8, flatShading: true,
        emissive: tintColor ?? (b.selected ? "#7a5a00" : "#000"), emissiveIntensity: tintColor || b.selected ? 0.25 : 0,
      }));
      const d = b.shape === "circle" ? b.w : b.d;
      mesh.scale.set(b.w / Math.max(size.x, 1e-3), h / Math.max(size.y, 1e-3), d / Math.max(size.z, 1e-3));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      if (tintColor || b.selected) g.add(outline(b, h, tintColor ?? "#ffd24a"));
      return g;
    }

    if (b.style === "forest") {
      // Area terrain: a low base plus a stand of trees up to the canopy
      // height. Trees are placed deterministically from the block's id.
      const floor = new THREE.Mesh(footprintGeom(b, 0.08), new THREE.MeshStandardMaterial({ color: b.color, roughness: 1 }));
      floor.position.y = 0.04;
      floor.receiveShadow = true;
      g.add(floor);
      const rnd = seeded(b.id);
      const area = b.shape === "circle" ? Math.PI * (b.w / 2) ** 2 : b.w * b.d;
      const n = Math.max(3, Math.min(40, Math.round(area / 3)));
      const leaf = new THREE.MeshStandardMaterial({ color: "#3f7a4a", roughness: 0.9 });
      const trunk = new THREE.MeshStandardMaterial({ color: "#5a4128", roughness: 1 });
      for (let i = 0; i < n; i++) {
        let px: number, pz: number;
        if (b.shape === "circle") {
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (b.w / 2) * 0.85;
          px = Math.cos(a) * rr; pz = Math.sin(a) * rr;
        } else {
          px = (rnd() - 0.5) * b.w * 0.85; pz = (rnd() - 0.5) * b.d * 0.85;
        }
        const th = h * (0.75 + rnd() * 0.25);
        const tr = Math.min(1.2, Math.max(0.4, Math.min(b.w, b.d) * 0.18));
        const t = new THREE.Mesh(new THREE.CylinderGeometry(tr * 0.12, tr * 0.15, th * 0.35, 6), trunk);
        t.position.set(px, th * 0.175, pz);
        t.castShadow = true;
        const c = new THREE.Mesh(new THREE.ConeGeometry(tr, th * 0.75, 8), leaf);
        c.position.set(px, th * 0.35 + th * 0.375, pz);
        c.castShadow = true;
        g.add(t, c);
      }
      if (tintColor || b.selected) g.add(outline(b, h, b.selected ? "#ffd24a" : tintColor!));
      return g;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: b.color, roughness: 0.85,
      emissive: tintColor ?? "#000", emissiveIntensity: tintColor ? 0.22 : 0,
    });
    const body = new THREE.Mesh(footprintGeom(b, h), mat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry, 30),
      new THREE.LineBasicMaterial({ color: b.selected ? "#ffd24a" : tintColor ?? b.edge }));
    edges.position.y = h / 2;
    g.add(edges);
    return g;
  }
}

function footprintGeom(b: Block3D, h: number): THREE.BufferGeometry {
  return b.shape === "circle"
    ? new THREE.CylinderGeometry(b.w / 2, b.w / 2, h, 40)
    : new THREE.BoxGeometry(b.w, h, b.d);
}

function outline(b: Block3D, h: number, color: string): THREE.Object3D {
  const box = footprintGeom(b, h);
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(box, 30), new THREE.LineBasicMaterial({ color }));
  l.position.y = h / 2;
  box.dispose();
  return l;
}

// Top of the tallest standable terrain under a board point (0 = table).
function surfaceUnder(blocks: Block3D[], x: number, y: number): number {
  let top = 0;
  for (const b of blocks) {
    if (!b.standable) continue;
    if (b.shape === "circle") {
      const r = b.w / 2;
      if (Math.hypot(x - (b.x + r), y - (b.y + r)) <= r) top = Math.max(top, b.height);
    } else {
      const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
      const a = (-b.rotation * Math.PI) / 180;
      const dx = x - cx, dy = y - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.d / 2) top = Math.max(top, b.height);
    }
  }
  return top;
}

// --- Piece models -----------------------------------------------------------
// Built from primitives at unit size (footprint 1) and scaled to fit.

const STYLE_COLORS: Record<FigureStyle, { body: string; trim: string; dark: string }> = {
  rebel:    { body: "#b59a6a", trim: "#6b5a3a", dark: "#3a3226" },  // tan fatigues, helmet
  imperial: { body: "#eceff2", trim: "#1b1d22", dark: "#2a2d33" },  // stormtrooper white
  clone:    { body: "#eef0f2", trim: "#d0701e", dark: "#1b1d22" },  // clone white + orange
  droid:    { body: "#c9b48a", trim: "#7a6a4a", dark: "#3d3528" },  // B1 battle droid tan
  merc:     { body: "#6a4e32", trim: "#c79a54", dark: "#2a2018" },  // hooded cloak
  pawn:     { body: "#9aa3b2", trim: "#596273", dark: "#2a2f3a" },
};

function buildModel(pc: Piece3D, stl: (d: string) => THREE.BufferGeometry | null): THREE.Object3D {
  const m = pc.model;
  const g = new THREE.Group();
  if (m.kind === "stl") {
    const geom = stl(m.data);
    if (geom) {
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: pc.color, roughness: 0.6, metalness: 0.05 }));
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

  const c = STYLE_COLORS[m.style];
  const body = std(m.style === "pawn" ? pc.color : c.body);
  const trim = std(m.style === "pawn" ? pc.accent : c.trim);
  const dark = std(c.dark);

  if (m.kind === "vehicle") {
    // Hull + turret; repulsors get a sleeker, longer hull with engine pods.
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.92), std(pc.color));
    hull.position.y = 0.2;
    g.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.7), trim);
    deck.position.y = 0.34;
    g.add(deck);
    if (m.repulsor) {
      hull.scale.set(0.8, 0.7, 1.05);
      for (const s of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 12), dark);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(s * 0.3, 0.18, 0.18);
        g.add(pod);
      }
      const seat = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), body);
      seat.position.set(0, 0.42, 0.05);
      g.add(seat);
    } else {
      for (const s of [-1, 1]) {
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.96), dark);
        tread.position.set(s * 0.36, 0.1, 0);
        g.add(tread);
      }
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.14, 16), trim);
      turret.position.y = 0.44;
      g.add(turret);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), dark);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0, 0.46, -0.3);
      g.add(gun);
    }
    fit(g, pc.footprint, pc.modelHeight);
    return g;
  }

  if (m.kind === "emplacement") {
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.5), std(pc.color));
    block.position.y = 0.125;
    g.add(block);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), dark);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0, 0.32, -0.2);
    g.add(gun);
    const crew = figure(body, trim, dark, m.style);
    crew.scale.setScalar(0.55);
    crew.position.set(0, 0.25, 0.15);
    g.add(crew);
    fit(g, pc.footprint, pc.modelHeight);
    return g;
  }

  g.add(figure(body, trim, dark, m.style));
  fit(g, pc.footprint, pc.modelHeight);
  return g;
}

// A ~1-unit-tall trooper. Each faction style changes the silhouette so a
// glance tells you whose unit it is.
function figure(
  body: THREE.Material, trim: THREE.Material, dark: THREE.Material, style: FigureStyle,
): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };

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
    const rifle = add(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8), trim, 0.22, 0.55, -0.1);
    rifle.rotation.x = 1.1;
    return g;
  }

  if (style === "droid") {
    // B1: thin limbs, narrow torso, long forward-leaning head.
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), body, s * 0.08, 0.21, 0);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), body, s * 0.17, 0.52, -0.02).rotation.z = s * 0.15;
    }
    add(new THREE.BoxGeometry(0.24, 0.2, 0.1), body, 0, 0.56, 0);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), body, 0, 0.72, 0);
    const head = add(new THREE.CapsuleGeometry(0.06, 0.2, 4, 12), body, 0, 0.84, -0.06);
    head.rotation.x = Math.PI / 2 - 0.35;
    add(new THREE.SphereGeometry(0.05, 10, 8), trim, 0, 0.83, 0.05); // backpack
    const blaster = add(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark, 0.17, 0.42, -0.15);
    blaster.rotation.x = 0.2;
    return g;
  }

  // Humanoid troopers: rebel, imperial, clone.
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.07, 0.065, 0.4, 10), style === "rebel" ? trim : body, s * 0.09, 0.2, 0);
    add(new THREE.CylinderGeometry(0.055, 0.05, 0.34, 10), body, s * 0.2, 0.55, -0.02).rotation.z = s * 0.12;
  }
  add(new THREE.BoxGeometry(0.34, 0.36, 0.2), body, 0, 0.58, 0);
  add(new THREE.BoxGeometry(0.36, 0.06, 0.22), style === "imperial" ? dark : trim, 0, 0.42, 0); // belt
  const blaster = add(new THREE.BoxGeometry(0.05, 0.07, 0.34), dark, 0.13, 0.55, -0.2);
  blaster.rotation.x = 0.15;

  if (style === "rebel") {
    add(new THREE.SphereGeometry(0.13, 16, 12), std("#c99a7a"), 0, 0.88, 0);
    // Rounded helmet with a brim, and a big field pack.
    add(new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 0.9, 0);
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 20), trim, 0, 0.9, 0);
    add(new THREE.BoxGeometry(0.28, 0.3, 0.14), dark, 0, 0.6, 0.16);
  } else if (style === "imperial") {
    // Domed stormtrooper helmet with a dark visor band.
    add(new THREE.SphereGeometry(0.15, 18, 14), body, 0, 0.9, 0);
    add(new THREE.BoxGeometry(0.2, 0.05, 0.08), dark, 0, 0.91, -0.11);
    add(new THREE.BoxGeometry(0.09, 0.06, 0.06), dark, 0, 0.84, -0.13);
    add(new THREE.BoxGeometry(0.22, 0.1, 0.08), body, 0, 0.62, 0.13); // backpack
  } else {
    // Clone: helmet with a T-visor, crest stripe and shoulder pauldron.
    add(new THREE.SphereGeometry(0.15, 18, 14), body, 0, 0.9, 0);
    add(new THREE.BoxGeometry(0.2, 0.04, 0.06), dark, 0, 0.93, -0.12);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.06), dark, 0, 0.87, -0.12);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.3), trim, 0, 1.04, 0);
    const pauldron = add(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, -0.2, 0.74, 0);
    pauldron.rotation.z = 0.4;
  }
  return g;
}

function std(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
}

function shadows(g: THREE.Object3D) {
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

// Scale a unit-sized model so its footprint matches and its height is
// modelHeight, whichever is tighter.
function fit(g: THREE.Group, footprint: number, modelHeight: number) {
  shadows(g);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  const s = Math.min((footprint * 0.9) / Math.max(size.x, size.z, 1e-3), modelHeight / Math.max(size.y, 1e-3));
  g.scale.setScalar(s);
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry?.userData.shared) m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      const mm = mat as THREE.MeshBasicMaterial;
      if (mm.map?.userData.owned) mm.map.dispose();
      mat.dispose();
    }
  });
}
