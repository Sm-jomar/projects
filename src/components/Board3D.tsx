// Semi-3D view of a tabletop, shared by the Legion and D&D boards.
//
// Terrain is extruded to its set height, pieces stand on whatever they're on
// top of, and hovering/flying pieces float at their elevation on a clear
// stand with a shadow on the ground beneath. With the camera locked, pieces
// can be dragged right here; the D-pad (or arrow keys) steps the selected
// piece, and a floating readout shows how far it has moved this move.
//
// Coordinates: the caller works in its own board units (inches for Legion,
// grid cells for D&D) with x to the right and y down the board. Here that
// maps to three.js x and z, with y up.

import { useEffect, useRef, useState } from "react";
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
  /** Floats this far above the table (board units): a floating rock, a
   * balcony, an upper floor. Pieces under it stay on the ground; a piece
   * lifted to its underside or higher stands on top of it. */
  base?: number;
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
  /** "cover" keeps the image's aspect and crops the overhang (default stretch). */
  groundImageFit?: "stretch" | "cover";
  /** 0..1: darkens the ground image. */
  groundImageDim?: number;
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
  /** Move a piece so its centre lands on (x, y), board units. Absent = view only. */
  onMove?: (id: string, x: number, y: number) => void;
  /** D-pad / arrow-key step, board units (default 1). */
  moveStep?: number;
  /** Describe a move of (dx, dy) board units from where the piece started;
   * tone colours the readout (dash = past its speed but within double). */
  measure?: (id: string, dx: number, dy: number) => MoveMeasure;
};

export type MoveMeasure = { label: string; tone: "ok" | "dash" | "over" };

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

  const [locked, setLocked] = useState(false);
  useEffect(() => { ctxRef.current?.setLocked(locked); }, [locked]);

  const selected = props.onMove ? props.pieces.find((pc) => pc.id === props.selectedId) : undefined;
  // Step the selected piece. Directions follow the camera, snapped to the
  // board's axes: "up" is away from you, whichever side you're looking from.
  function step(sx: number, sy: number) {
    if (!selected || !props.onMove) return;
    const a = Math.round((ctxRef.current?.azimuth() ?? 0) / (Math.PI / 2)) * (Math.PI / 2);
    const fx = -Math.sin(a), fy = -Math.cos(a); // forward, board x/y
    const rx = Math.cos(a), ry = -Math.sin(a); // right
    const n = props.moveStep ?? 1;
    const dx = Math.round(rx * sx + fx * sy), dy = Math.round(ry * sx + fy * sy);
    props.onMove(selected.id, selected.x + dx * n, selected.y + dy * n);
  }
  function onKey(e: React.KeyboardEvent) {
    const dir: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dir[e.key];
    if (!d || !selected) return;
    e.preventDefault();
    step(d[0], d[1]);
  }

  return (
    <div className="board3d" ref={hostRef} tabIndex={0} onKeyDown={onKey}>
      <div className="board3d-hint small">
        {locked
          ? "Camera locked · drag a piece to move it · right-drag to pan · scroll to zoom"
          : "Drag to orbit · right-drag to pan · scroll to zoom · click a piece or terrain to select"}
      </div>
      {props.onMove && (
        <div className="board3d-move">
          <button className={"ghost-btn small" + (locked ? " active" : "")} onClick={() => setLocked(!locked)}
                  title="Lock the camera so dragging moves pieces instead of turning the view">
            {locked ? "🔒 Camera locked" : "🔓 Lock camera"}
          </button>
          {selected && (
            <div className="board3d-dpad" aria-label="Move the selected piece">
              {([[-1, 1, "↖"], [0, 1, "↑"], [1, 1, "↗"], [-1, 0, "←"], null, [1, 0, "→"], [-1, -1, "↙"], [0, -1, "↓"], [1, -1, "↘"]] as const).map((d, i) =>
                d ? <button key={i} className="ghost-btn small" onClick={() => step(d[0], d[1])}>{d[2]}</button>
                  : <button key={i} className="ghost-btn small" title="Start a new move from here" onClick={() => ctxRef.current?.resetMove()}>⟲</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type SceneCtx = {
  build: (p: Props) => void;
  frame: (w: number, d: number) => void;
  setLocked: (on: boolean) => void;
  /** Camera's angle around the board (0 = looking up the board). */
  azimuth: () => number;
  /** Measure the selected piece's next move from where it stands now. */
  resetMove: () => void;
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
  // Piece groups by id (for dragging), with their board-space centre.
  const pieceGroups = new Map<string, { g: THREE.Group; x: number; y: number; top: number }>();
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

  // Decoding is async (the meshopt codec is WebAssembly): the first build
  // that meets a model shows a placeholder and kicks off the decode, and the
  // scene rebuilds once it's ready.
  const stlPending = new Set<string>();
  let lastProps: Props | null = null;
  function stlGeometry(data: string): THREE.BufferGeometry | null {
    if (stlGeoms.has(data)) return stlGeoms.get(data)!;
    if (!stlPending.has(data)) {
      stlPending.add(data);
      void decodeModel(data).then((m) => {
        stlPending.delete(data);
        if (disposed) return;
        let g: THREE.BufferGeometry | null = null;
        if (m) {
          // Smooth across gentle curves, keep hard edges (armour plates,
          // building corners) crisp instead of smearing light across them.
          g = creasedGeometry(m.positions, m.indices, (40 * Math.PI) / 180);
          g.computeBoundingBox();
          g.userData.shared = true;
        }
        stlGeoms.set(data, g);
        if (lastProps) build(lastProps);
      });
    }
    return null;
  }

  // Board coordinates → world: centre the board on the origin.
  const wx = (x: number) => x - boardW / 2;
  const wz = (y: number) => y - boardD / 2;

  function build(p: Props) {
    if (disposed) return;
    lastProps = p;
    scene.remove(content);
    disposeGroup(content);
    content = new THREE.Group();
    scene.add(content);
    pickables.length = 0;
    pieceGroups.clear();
    boardW = p.width; boardD = p.depth;

    // --- Ground ----------------------------------------------------------
    const groundMat = new THREE.MeshStandardMaterial({ color: p.groundColor, roughness: 0.95 });
    if (p.groundImageUrl) {
      // Swap the map in once it has loaded (a remote image without CORS
      // headers never does, and the board just keeps its plain colour).
      texture(p.groundImageUrl, (t) => {
        const img = t.image as HTMLImageElement;
        if (p.groundImageFit === "cover" && img.width && img.height) {
          // Show the centred slice of the image that has the board's shape.
          const k = (img.width / img.height) / (p.width / p.depth);
          if (k > 1) { t.repeat.set(1 / k, 1); t.offset.set((1 - 1 / k) / 2, 0); }
          else { t.repeat.set(1, k); t.offset.set(0, (1 - k) / 2); }
        }
        groundMat.map = t;
        groundMat.color.setScalar(1 - Math.min(1, Math.max(0, p.groundImageDim ?? 0)));
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
      // standOn: the surface the piece rests on (or flies above); baseY:
      // the bottom of its base.
      const { standOn, baseY } = footing(p.blocks, pc.x, pc.y, pc.lift);
      const flyH = baseY - standOn;
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
      if (flyH > 0.001) {
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.08, r * 0.08, flyH, 12),
          new THREE.MeshStandardMaterial({ color: "#bfe3ff", transparent: true, opacity: 0.35, roughness: 0.1 }),
        );
        stand.position.y = standOn + flyH / 2;
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
      g.traverse((o) => { o.userData.pieceId = pc.id; o.userData.isPiece = true; });
      pickables.push(g);
      content.add(g);
      pieceGroups.set(pc.id, { g, x: pc.x, y: pc.y, top: baseY + baseH + pc.modelHeight });
    }

    // A move is measured from where the selected piece stood when it was
    // selected (or when the player started a new move).
    const sel = p.selectedId ? pieceGroups.get(p.selectedId) : undefined;
    if (!sel) moveFrom = null;
    else if (moveFrom?.id !== p.selectedId) moveFrom = { id: p.selectedId!, x: sel.x, y: sel.y };
    if (drag && pieceGroups.has(drag.id)) placeDragged();
    else showMeasure();
  }

  // --- Move readout ---------------------------------------------------------
  let moveFrom: { id: string; x: number; y: number } | null = null;
  const measureLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: "#ffd24a", dashSize: 0.3, gapSize: 0.2, depthTest: false }));
  measureLine.renderOrder = 5;
  measureLine.visible = false;
  scene.add(measureLine);
  const label = document.createElement("div");
  label.className = "board3d-measure";
  label.hidden = true;
  host.appendChild(label);
  let labelAt: THREE.Vector3 | null = null;

  function showMeasure(at?: { x: number; y: number }) {
    const pc = moveFrom && pieceGroups.get(moveFrom.id);
    const cur = at ?? pc;
    if (!moveFrom || !pc || !cur || Math.hypot(cur.x - moveFrom.x, cur.y - moveFrom.y) < 1e-3) {
      measureLine.visible = false;
      label.hidden = true;
      labelAt = null;
      return;
    }
    const dx = cur.x - moveFrom.x, dy = cur.y - moveFrom.y;
    const m = lastProps?.measure?.(moveFrom.id, dx, dy) ?? { label: Math.hypot(dx, dy).toFixed(1), tone: "ok" as const };
    const color = m.tone === "over" ? "#ff6b5e" : m.tone === "dash" ? "#ffb347" : "#ffd24a";
    measureLine.geometry.dispose();
    measureLine.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(wx(moveFrom.x), 0.04, wz(moveFrom.y)),
      new THREE.Vector3(wx(cur.x), 0.04, wz(cur.y)),
    ]);
    measureLine.computeLineDistances();
    const lm = measureLine.material as THREE.LineDashedMaterial;
    lm.color.set(color);
    const span = Math.max(boardW, boardD);
    lm.dashSize = span / 120; lm.gapSize = span / 200;
    measureLine.visible = true;
    label.textContent = m.label;
    label.dataset.tone = m.tone;
    label.hidden = false;
    labelAt = new THREE.Vector3(wx(cur.x), pc.top + span * 0.02, wz(cur.y));
  }

  // --- Picking and dragging ---------------------------------------------
  const ray = new THREE.Raycaster();
  const table = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let down: { x: number; y: number } | null = null;
  let locked = false;
  // A piece being dragged (camera locked): board-space offset from the
  // pointer to the piece centre, and where it is now.
  let drag: { id: string; offX: number; offY: number; x: number; y: number } | null = null;

  function aim(e: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  // Where the pointer meets the table, in board units.
  function onTable(e: PointerEvent): { x: number; y: number } | null {
    aim(e);
    const v = ray.ray.intersectPlane(table, new THREE.Vector3());
    return v ? { x: v.x + boardW / 2, y: v.z + boardD / 2 } : null;
  }
  function placeDragged() {
    const pg = drag && pieceGroups.get(drag.id);
    if (!drag || !pg) return;
    pg.g.position.set(wx(drag.x), 0, wz(drag.y));
    showMeasure(drag);
  }

  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
    framed = true;
    if (!locked || e.button !== 0 || !lastProps?.onMove) return;
    aim(e);
    const hit = ray.intersectObjects(pickables, true).find((h) => h.object.userData.isPiece);
    const id = hit?.object.userData.pieceId as string | undefined;
    const pg = id ? pieceGroups.get(id) : undefined;
    const at = onTable(e);
    if (!id || !pg || !at) return;
    drag = { id, offX: pg.x - at.x, offY: pg.y - at.y, x: pg.x, y: pg.y };
    renderer.domElement.setPointerCapture(e.pointerId);
    if (lastProps.selectedId !== id) onPick(id);
  };
  const onMoveEvt = (e: PointerEvent) => {
    if (!drag) return;
    const at = onTable(e);
    if (!at) return;
    drag.x = Math.max(0, Math.min(boardW, at.x + drag.offX));
    drag.y = Math.max(0, Math.min(boardD, at.y + drag.offY));
    placeDragged();
  };
  const onUp = (e: PointerEvent) => {
    if (drag) {
      const d = drag;
      drag = null;
      down = null;
      const pg = pieceGroups.get(d.id);
      if (pg && Math.hypot(d.x - pg.x, d.y - pg.y) > 1e-3) lastProps?.onMove?.(d.id, d.x, d.y);
      else showMeasure();
      return;
    }
    if (!down || e.button !== 0) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return; // that was an orbit, not a click
    aim(e);
    const hit = ray.intersectObjects(pickables, true)[0];
    onPick((hit?.object.userData.pieceId as string | undefined) ?? null);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointermove", onMoveEvt);
  renderer.domElement.addEventListener("pointerup", onUp);

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
    if (labelAt) {
      // Pin the readout above the piece, in screen space.
      const v = labelAt.clone().project(camera);
      label.style.transform = `translate(${((v.x + 1) / 2) * host.clientWidth}px, ${((1 - v.y) / 2) * host.clientHeight}px) translate(-50%, -100%)`;
    }
  };
  loop();

  return {
    build,
    frame,
    setLocked(on) {
      locked = on;
      // Locked: the left button moves pieces; right-drag still pans, the
      // wheel still zooms.
      controls.enableRotate = !on;
    },
    azimuth: () => controls.getAzimuthalAngle(),
    resetMove() {
      const pg = moveFrom && pieceGroups.get(moveFrom.id);
      if (moveFrom && pg) moveFrom = { id: moveFrom.id, x: pg.x, y: pg.y };
      showMeasure();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMoveEvt);
      renderer.domElement.removeEventListener("pointerup", onUp);
      measureLine.geometry.dispose();
      (measureLine.material as THREE.Material).dispose();
      label.remove();
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
    const base = Math.max(0, b.base ?? 0);
    g.position.set(cx, base, cz);
    g.rotation.y = -(b.rotation * Math.PI) / 180;
    if (base > 0.001) {
      // A floating piece leaves a faint footprint on the table so you can
      // tell where it hangs, and what's underneath it.
      const foot = new THREE.Mesh(
        b.shape === "circle" ? new THREE.CircleGeometry(b.w / 2, 40) : new THREE.PlaneGeometry(b.w, b.d),
        new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.22, depthWrite: false }),
      );
      foot.rotation.x = -Math.PI / 2;
      foot.position.y = 0.015 - base;
      foot.renderOrder = 1;
      g.add(foot);
      const ring = new THREE.LineSegments(
        new THREE.EdgesGeometry(b.shape === "circle" ? new THREE.CircleGeometry(b.w / 2, 40) : new THREE.PlaneGeometry(b.w, b.d)),
        new THREE.LineDashedMaterial({ color: b.edge, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.6 }),
      );
      ring.computeLineDistances();
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02 - base;
      g.add(ring);
    }
    const tintColor = b.tint === "clear" ? "#4ac86a" : b.tint === "block" ? "#e2554a" : null;
    const h = Math.max(0.02, b.height);

    const stlGeom = b.stl ? stlGeometry(b.stl) : null;
    if (stlGeom) {
      stlGeom.computeBoundingBox();
      const size = stlGeom.boundingBox!.getSize(new THREE.Vector3());
      const mesh = new THREE.Mesh(stlGeom, new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.8, side: THREE.DoubleSide, shadowSide: THREE.BackSide,
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

// Unindexed geometry with "creased" normals: each corner averages the
// normals of the faces around its vertex that bend less than `crease` from
// its own face. Faces are weighted by area, so the long thin slivers a
// simplifier leaves behind don't streak the shading.
function creasedGeometry(pos: Float32Array, idx: ArrayLike<number>, crease: number): THREE.BufferGeometry {
  const triCount = idx.length / 3;
  const fn = new Float32Array(triCount * 3); // area-weighted face normals
  const fu = new Float32Array(triCount * 3); // unit face normals
  const vCount = pos.length / 3;
  const deg = new Uint32Array(vCount + 1);
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
    fu[t * 3] = nx / len; fu[t * 3 + 1] = ny / len; fu[t * 3 + 2] = nz / len;
    deg[idx[t * 3]!]!++; deg[idx[t * 3 + 1]!]!++; deg[idx[t * 3 + 2]!]!++;
  }
  // Faces around each vertex (CSR layout).
  const start = new Uint32Array(vCount + 1);
  for (let v = 0; v < vCount; v++) start[v + 1] = start[v]! + deg[v]!;
  const fill = start.slice(0, vCount);
  const faces = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) faces[fill[idx[t * 3 + k]!]!++] = t;

  // Each corner's normal averages the faces around its vertex that lie
  // within the crease angle. Corners of one vertex that land on the same
  // normal share an output vertex, so the mesh stays indexed and only
  // splits along hard edges (a 500k-triangle model stays a few MB on the GPU).
  const cos = Math.cos(crease);
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outIdx = new Uint32Array(triCount * 3);
  const slot = new Uint32Array(triCount * 3); // per vertex: output ids made so far
  const used = new Uint32Array(vCount);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      let sx = 0, sy = 0, sz = 0;
      for (let j = start[v]!; j < start[v + 1]!; j++) {
        const f = faces[j]!;
        // Treat flipped faces as facing the same way, so stray winding
        // doesn't punch dark spots into the shading.
        const d = fu[f * 3]! * fu[t * 3]! + fu[f * 3 + 1]! * fu[t * 3 + 1]! + fu[f * 3 + 2]! * fu[t * 3 + 2]!;
        if (Math.abs(d) < cos) continue;
        const sgn = d < 0 ? -1 : 1;
        sx += fn[f * 3]! * sgn; sy += fn[f * 3 + 1]! * sgn; sz += fn[f * 3 + 2]! * sgn;
      }
      const len = Math.hypot(sx, sy, sz) || 1;
      sx /= len; sy /= len; sz /= len;
      let out = -1;
      for (let j = 0; j < used[v]!; j++) {
        const o = slot[start[v]! + j]!;
        if (outNrm[o * 3]! * sx + outNrm[o * 3 + 1]! * sy + outNrm[o * 3 + 2]! * sz > 0.9999) { out = o; break; }
      }
      if (out < 0) {
        out = outPos.length / 3;
        outPos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
        outNrm.push(sx, sy, sz);
        slot[start[v]! + used[v]!++] = out;
      }
      outIdx[t * 3 + k] = out;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(outNrm, 3));
  g.setIndex(new THREE.BufferAttribute(outIdx, 1));
  return g;
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

function blockContains(b: Block3D, x: number, y: number): boolean {
  if (b.shape === "circle") {
    const r = b.w / 2;
    return Math.hypot(x - (b.x + r), y - (b.y + r)) <= r;
  }
  const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
  const a = (-b.rotation * Math.PI) / 180;
  const dx = x - cx, dy = y - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.d / 2;
}

// Where a piece at a board point stands. Grounded standable terrain
// (buildings, rocks) lifts it onto its roof as before. Floating terrain
// (floors, platforms, balconies) only catches a piece lifted to its
// underside or higher, so a piece can stand under it, on it, or on the
// floor above. `lift` is the piece's height above the grounded surface.
function footing(blocks: Block3D[], x: number, y: number, lift: number): { standOn: number; baseY: number } {
  let ground = 0;
  for (const b of blocks) {
    if (b.standable && !((b.base ?? 0) > 0) && blockContains(b, x, y)) ground = Math.max(ground, b.height);
  }
  const alt = ground + lift;
  let floor = ground;
  for (const b of blocks) {
    const base = b.base ?? 0;
    if (!b.standable || !(base > 0) || base > alt + 1e-6 || !blockContains(b, x, y)) continue;
    floor = Math.max(floor, base + b.height);
  }
  // On a floor, the piece stands on it (any lift up to it is used up
  // getting there); anything above its top is still flight.
  return { standOn: floor, baseY: Math.max(alt, floor) };
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
