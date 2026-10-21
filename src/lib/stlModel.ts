// Compact, syncable 3D models from uploaded STL files.
//
// A miniature STL straight off a slicer is often several MB, far too big to
// keep in localStorage or push through the room server (2 MB board cap). So
// on upload we:
//   1. parse the STL (binary or ASCII) into a triangle soup,
//   2. turn it upright (STLs are Z-up; the 3D board is Y-up) and normalize
//      it into a unit box: footprint fits 1×1, base sits on y = 0,
//   3. simplify it by vertex clustering until it fits a triangle budget,
//   4. quantize vertices to 16 bits and base64 the result.
// A typical mini ends up around 60–120 KB, which is small enough to sync.
//
// Format: "stl1:" + base64(header + vertices + indices)
//   header  = Uint32 vertexCount, Uint32 triCount, Float32 height
//   verts   = Uint16 × 3 × vertexCount  (x, z in [-0.5, 0.5], y in [0, height])
//   indices = Uint16 × 3 × triCount

import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export const STL_PREFIX = "stl1:";
export const STL_DEFAULT_MAX_TRIS = 8000;

export type EncodedModel = { data: string; triangles: number; bytes: number };

export async function encodeStlFile(file: File, maxTris = STL_DEFAULT_MAX_TRIS): Promise<EncodedModel> {
  const buf = await file.arrayBuffer();
  const geom = new STLLoader().parse(buf);
  const pos = geom.getAttribute("position");
  if (!pos || pos.count < 3) throw new Error("That STL has no triangles in it.");
  const soup = new Float32Array(pos.count * 3);
  // Z-up → Y-up: (x, y, z) → (x, z, -y).
  for (let i = 0; i < pos.count; i++) {
    soup[i * 3] = pos.getX(i);
    soup[i * 3 + 1] = pos.getZ(i);
    soup[i * 3 + 2] = -pos.getY(i);
  }
  geom.dispose();
  return encodeSoup(soup, maxTris);
}

export function encodeSoup(soup: Float32Array, maxTris = STL_DEFAULT_MAX_TRIS): EncodedModel {
  // Normalize: centre on x/z, base at y = 0, footprint scaled to fit 1.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i]!, y = soup[i + 1]!, z = soup[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const foot = Math.max(maxX - minX, maxZ - minZ) || 1;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const norm = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    norm[i] = (soup[i]! - cx) / foot;
    norm[i + 1] = (soup[i + 1]! - minY) / foot;
    norm[i + 2] = (soup[i + 2]! - cz) / foot;
  }
  const height = Math.max(1e-3, (maxY - minY) / foot);

  // Vertex clustering. Shrink the grid until the mesh fits the budget (and
  // the 16-bit index limit).
  let res = 256;
  let mesh = cluster(norm, height, res);
  while ((mesh.tris.length / 3 > maxTris || mesh.verts.length / 3 > 65535) && res > 8) {
    res = Math.floor(res * 0.8);
    mesh = cluster(norm, height, res);
  }
  const vCount = mesh.verts.length / 3;
  const tCount = mesh.tris.length / 3;
  if (tCount === 0) throw new Error("That STL simplified down to nothing — is it a valid model?");

  const out = new ArrayBuffer(12 + vCount * 6 + tCount * 6);
  const dv = new DataView(out);
  dv.setUint32(0, vCount, true);
  dv.setUint32(4, tCount, true);
  dv.setFloat32(8, height, true);
  const q = new Uint16Array(out, 12, vCount * 3);
  for (let i = 0; i < vCount; i++) {
    q[i * 3] = quant(mesh.verts[i * 3]! + 0.5, 1);
    q[i * 3 + 1] = quant(mesh.verts[i * 3 + 1]!, height);
    q[i * 3 + 2] = quant(mesh.verts[i * 3 + 2]! + 0.5, 1);
  }
  new Uint16Array(out, 12 + vCount * 6, tCount * 3).set(mesh.tris);
  const data = STL_PREFIX + toBase64(new Uint8Array(out));
  return { data, triangles: tCount, bytes: data.length };
}

export type DecodedModel = { positions: Float32Array; indices: Uint16Array; height: number };

export function decodeModel(data: string): DecodedModel | null {
  if (!data.startsWith(STL_PREFIX)) return null;
  try {
    const bytes = fromBase64(data.slice(STL_PREFIX.length));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vCount = dv.getUint32(0, true);
    const tCount = dv.getUint32(4, true);
    const height = dv.getFloat32(8, true);
    if (bytes.byteLength < 12 + vCount * 6 + tCount * 6) return null;
    // Copy into aligned buffers (base64 output may not be 2-byte aligned).
    const body = bytes.slice(12);
    const q = new Uint16Array(body.buffer, 0, vCount * 3);
    const positions = new Float32Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      positions[i * 3] = q[i * 3]! / 65535 - 0.5;
      positions[i * 3 + 1] = (q[i * 3 + 1]! / 65535) * height;
      positions[i * 3 + 2] = q[i * 3 + 2]! / 65535 - 0.5;
    }
    const indices = new Uint16Array(body.buffer, vCount * 6, tCount * 3).slice();
    for (const ix of indices) if (ix >= vCount) return null;
    return { positions, indices, height };
  } catch {
    return null;
  }
}

function quant(v: number, range: number): number {
  return Math.max(0, Math.min(65535, Math.round((v / range) * 65535)));
}

// Snap every vertex to a res³ grid over the model's box; each occupied cell
// becomes one vertex at the average of its members. Triangles that collapse
// (two corners in one cell) or repeat are dropped.
function cluster(soup: Float32Array, height: number, res: number): { verts: number[]; tris: number[] } {
  const cellOf = new Map<number, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const triIdx = new Int32Array(soup.length / 3);
  const yRes = Math.max(1, Math.round(res * height));
  for (let v = 0; v < soup.length / 3; v++) {
    const x = soup[v * 3]!, y = soup[v * 3 + 1]!, z = soup[v * 3 + 2]!;
    const ix = Math.min(res - 1, Math.floor((x + 0.5) * res));
    const iy = Math.min(yRes - 1, Math.floor((y / height) * yRes));
    const iz = Math.min(res - 1, Math.floor((z + 0.5) * res));
    const key = (ix * (yRes + 1) + iy) * (res + 1) + iz;
    let id = cellOf.get(key);
    if (id === undefined) {
      id = counts.length;
      cellOf.set(key, id);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[id * 3] += x; sums[id * 3 + 1] += y; sums[id * 3 + 2] += z;
    counts[id]++;
    triIdx[v] = id;
  }
  const seen = new Set<string>();
  const used = new Map<number, number>();
  const verts: number[] = [];
  const tris: number[] = [];
  const remap = (id: number) => {
    let n = used.get(id);
    if (n === undefined) {
      n = verts.length / 3;
      used.set(id, n);
      const c = counts[id]!;
      verts.push(sums[id * 3]! / c, sums[id * 3 + 1]! / c, sums[id * 3 + 2]! / c);
    }
    return n;
  };
  for (let t = 0; t < triIdx.length; t += 3) {
    const a = triIdx[t]!, b = triIdx[t + 1]!, c = triIdx[t + 2]!;
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(remap(a), remap(b), remap(c));
  }
  return { verts, tris };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
