// Blaster bolts, impact flashes and their light for Board3D, drawn from a
// lib/attackFx frame. Meshes, sprites and lights are pooled: the lights
// always stay in the scene (at zero when idle) so adding a bolt never
// makes three.js recompile every material.

import * as THREE from "three";
import type { FxFrame } from "../lib/attackFx";

const LIGHTS = 4;

type Bolt = { g: THREE.Group; core: THREE.Mesh; glow: THREE.Mesh; head: THREE.Sprite };

export type FxPlace = {
  wx: (x: number) => number;
  wz: (y: number) => number;
  /** Height of a piece's chest (where bolts leave and land), if it's on the board. */
  heightOf: (id: string) => number | null;
};

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFx3D(scene: THREE.Scene) {
  const group = new THREE.Group();
  scene.add(group);
  const tex = glowTexture();
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const bolts: Bolt[] = [];
  const flashes: THREE.Sprite[] = [];
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < LIGHTS; i++) {
    const l = new THREE.PointLight("#ff5a3a", 0, 9, 2);
    l.castShadow = false;
    scene.add(l);
    lights.push(l);
  }
  const additive = (color: string, opacity: number) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const sprite = (color: string) => new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));

  function bolt(i: number): Bolt {
    if (bolts[i]) return bolts[i]!;
    const g = new THREE.Group();
    const core = new THREE.Mesh(cyl, additive("#ffffff", 1));
    const glow = new THREE.Mesh(cyl, additive("#ff4a3a", 0.55));
    const head = sprite("#ff4a3a");
    g.add(glow, core, head);
    group.add(g);
    return (bolts[i] = { g, core, glow, head });
  }
  function flash(i: number): THREE.Sprite {
    if (flashes[i]) return flashes[i]!;
    const s = sprite("#ffffff");
    group.add(s);
    return (flashes[i] = s);
  }

  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();

  function update(frame: FxFrame | null, place: FxPlace) {
    // The brightest things this frame get the lights.
    const glows: { x: number; y: number; z: number; color: string; power: number }[] = [];
    const fs = frame?.bolts ?? [];
    fs.forEach((f, i) => {
      const bo = bolt(i);
      bo.g.visible = true;
      const h0 = place.heightOf(f.fromId) ?? 0.8;
      const h1 = f.kind === "miss" || f.kind === "dodge" || f.kind === "cover" ? h0 * 0.85 : place.heightOf(f.toId) ?? h0;
      // Height along the flight: from the muzzle to the target's chest.
      const hAt = (q: number) => h0 + (h1 - h0) * Math.min(1, q);
      a.set(place.wx(f.x1), hAt(f.p), place.wz(f.y1));
      b.set(place.wx(f.x2), hAt(f.p), place.wz(f.y2));
      d.subVectors(b, a);
      const l = Math.max(0.05, d.length());
      bo.g.position.copy(a).addScaledVector(d, 0.5);
      bo.g.quaternion.setFromUnitVectors(up, d.normalize());
      bo.core.scale.set(0.03, l, 0.03);
      bo.glow.scale.set(0.15, l * 1.05, 0.15);
      (bo.glow.material as THREE.MeshBasicMaterial).color.set(f.color);
      (bo.head.material as THREE.SpriteMaterial).color.set(f.color);
      bo.head.position.set(0, l / 2, 0);
      bo.head.scale.setScalar(1.1);
      glows.push({ x: b.x, y: b.y, z: b.z, color: f.color, power: 12 });
    });
    for (let i = fs.length; i < bolts.length; i++) bolts[i]!.g.visible = false;

    const fl = frame?.flashes ?? [];
    fl.forEach((f, i) => {
      const s = flash(i);
      s.visible = true;
      const h = f.id ? place.heightOf(f.id) ?? 0.6 : 0.6;
      s.position.set(place.wx(f.x), f.kind === "down" ? h * 0.6 : f.kind === "cover" ? h * 0.6 : h, place.wz(f.y));
      s.scale.setScalar(f.r * 2.6);
      const m = s.material as THREE.SpriteMaterial;
      m.color.set(f.color);
      m.opacity = f.alpha;
      const power = f.kind === "crit" ? 26 : f.kind === "hit" ? 18 : f.kind === "down" ? 30 : f.kind === "muzzle" ? 10 : 9;
      glows.push({ x: s.position.x, y: s.position.y, z: s.position.z, color: f.color, power: power * f.alpha });
    });
    for (let i = fl.length; i < flashes.length; i++) flashes[i]!.visible = false;

    glows.sort((p, q) => q.power - p.power);
    lights.forEach((l, i) => {
      const g = glows[i];
      if (!g) { l.intensity = 0; return; }
      l.position.set(g.x, g.y + 0.15, g.z);
      l.color.set(g.color);
      l.intensity = g.power;
    });
  }

  function dispose() {
    for (const l of lights) scene.remove(l);
    scene.remove(group);
    cyl.dispose();
    tex.dispose();
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose();
    });
  }

  return { update, dispose };
}
