// Detailed, shareable 3D models from uploaded STL files.
//
// On upload we:
//   1. parse the STL (binary or ASCII) into a triangle soup,
//   2. turn it upright (STLs are Z-up; the 3D board is Y-up) and normalize
//      it into a unit box: footprint fits 1×1, base sits on y = 0,
//   3. weld the soup into a connected mesh (shared vertices), so the
//      simplifier sees the real surface instead of loose triangles,
//   4. simplify it (only if it's over the limit) with meshoptimizer's
//      quadric edge collapse, which keeps the silhouette and thin parts and
//      never tears holes along open edges,
//   5. quantize vertices to 16 bits and pack vertices + indices with the
//      meshopt codec (the one glTF uses).
//
// A model keeps up to 500k triangles, a few MB, which is too big for the
// 2 MB board a room syncs. So the packed model is uploaded once to the
// site's model store (see stlStore.ts) and the board carries only
// "stlref:" + its SHA-256; everyone's browser fetches and caches it. If the
// upload fails (offline, or a copy of the site without the server) we fall
// back to an inline "stl2:" model trimmed to fit the board, as before.
//
// Packed layout (stlref bytes, and the base64 body of "stl2:")
//   header = Uint32 vertexCount, Uint32 indexCount, Float32 height,
//            Uint32 vertexStreamBytes
//   vertex stream = meshopt-encoded Uint16 × 4 per vertex
//                   (x, z in [-0.5, 0.5], y in [0, height], pad)
//   index stream  = meshopt-encoded Uint32 triangle list
// The older "stl1:" format (vertex-clustered, raw Uint16 buffers) still
// decodes, so models saved before these changes keep working.

import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { loadModel, sha256Hex, uploadModel } from "./stlStore";

export const STL_PREFIX = "stl2:";
const STL1_PREFIX = "stl1:";
export const STL_REF_PREFIX = "stlref:";

/** Most triangles a shared (server-stored) model keeps. */
export const STL_MAX_TRIS = 500_000;
/** Shared models are kept under this; the server takes up to 16 MB. */
const SHARED_BYTE_BUDGET = 12_000_000;
/** Inline fallback: sized to leave room for several models on one board. */
export const STL_INLINE_BUDGET = 160_000;
const INLINE_MAX_TRIS = 40_000;

/**
 * size: the model's normalized extents (largest footprint side = 1).
 * shared: false when the upload failed and the model was trimmed to fit
 * inline in the board instead.
 */
export type EncodedModel = {
  data: string; triangles: number; bytes: number; shared: boolean;
  size: { x: number; y: number; z: number };
};

export async function encodeStlFile(file: File): Promise<EncodedModel> {
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
  return encodeSoup(soup);
}

export async function encodeSoup(soup: Float32Array): Promise<EncodedModel> {
  const mesh = await prepareMesh(soup);
  const full = await packWithin(mesh, STL_MAX_TRIS, SHARED_BYTE_BUDGET);
  try {
    const hash = await sha256Hex(full.bytes);
    await uploadModel(hash, full.bytes);
    return { data: STL_REF_PREFIX + hash, triangles: full.triangles, bytes: full.bytes.length, shared: true, size: mesh.size };
  } catch {
    const small = await packWithin(mesh, INLINE_MAX_TRIS, STL_INLINE_BUDGET * 3 / 4);
    const data = STL_PREFIX + toBase64(small.bytes);
    return { data, triangles: small.triangles, bytes: data.length, shared: false, size: mesh.size };
  }
}

type Mesh = { positions: Float32Array; indices: Uint32Array; height: number; size: EncodedModel["size"] };

async function prepareMesh(soup: Float32Array): Promise<Mesh> {
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
  const height = Math.max(1e-3, (maxY - minY) / foot);
  const size = { x: (maxX - minX) / foot, y: height, z: (maxZ - minZ) / foot };

  const { positions, indices } = weld(soup, (x) => (x - cx) / foot, (y) => (y - minY) / foot, (z) => (z - cz) / foot);
  if (indices.length === 0) throw new Error("That STL has no usable triangles in it.");
  return { positions, indices, height, size };
}

// Spend detail up to a triangle cap and a byte budget: simplify, encode,
// and if it came out too big, aim lower in proportion and try again from
// the original.
async function packWithin(mesh: Mesh, maxTris: number, budget: number): Promise<{ bytes: Uint8Array; triangles: number }> {
  const [{ MeshoptSimplifier }, { MeshoptEncoder }] = await Promise.all([
    import("meshoptimizer/simplifier"),
    import("meshoptimizer/encoder"),
  ]);
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  const { positions, indices, height } = mesh;
  let target = Math.min(indices.length / 3, maxTris);
  let out = packMesh(simplifyTo(MeshoptSimplifier, indices, positions, target), positions, height, MeshoptEncoder);
  for (let i = 0; i < 6 && out.bytes.length > budget; i++) {
    target = Math.max(500, Math.floor(target * (budget / out.bytes.length) * 0.92));
    out = packMesh(simplifyTo(MeshoptSimplifier, indices, positions, target), positions, height, MeshoptEncoder);
  }
  return out;
}

type Simplifier = typeof import("meshoptimizer/simplifier").MeshoptSimplifier;
type Encoder = typeof import("meshoptimizer/encoder").MeshoptEncoder;

function simplifyTo(S: Simplifier, indices: Uint32Array, positions: Float32Array, targetTris: number): Uint32Array {
  if (indices.length / 3 <= targetTris) return indices;
  const want = targetTris * 3;
  // Quadric collapse with a generous error ceiling (5% of the model size).
  // It stops early where collapsing would visibly change the shape, so if
  // it can't reach the target, finish with the sloppy (clustering)
  // simplifier on what's left rather than blowing the budget.
  const [res] = S.simplify(indices, positions, 3, want, 0.05, ["Regularize"]);
  if (res.length <= want * 1.15) return res;
  const [sloppy] = S.simplifySloppy(res, positions, 3, null, want, 0.05);
  return sloppy.length ? sloppy : res;
}

function packMesh(indices: Uint32Array, positions: Float32Array, height: number, E: Encoder): { bytes: Uint8Array; triangles: number } {
  const idx = indices.slice();
  // Reorder for vertex-cache locality and drop unused vertices; this is
  // what lets the meshopt codec compress the streams well.
  const [remap, unique] = E.reorderMesh(idx, true, false);
  const q = new Uint16Array(unique * 4);
  const total = positions.length / 3;
  for (let i = 0; i < total; i++) {
    const r = remap[i]!;
    if (r === 0xffffffff || r >= unique) continue;
    q[r * 4] = quant(positions[i * 3]! + 0.5, 1);
    q[r * 4 + 1] = quant(positions[i * 3 + 1]!, height);
    q[r * 4 + 2] = quant(positions[i * 3 + 2]! + 0.5, 1);
  }
  const vs = E.encodeVertexBuffer(new Uint8Array(q.buffer), unique, 8);
  const is = E.encodeIndexBuffer(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), idx.length, 4);
  const out = new Uint8Array(16 + vs.length + is.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, unique, true);
  dv.setUint32(4, idx.length, true);
  dv.setFloat32(8, height, true);
  dv.setUint32(12, vs.length, true);
  out.set(vs, 16);
  out.set(is, 16 + vs.length);
  return { bytes: out, triangles: idx.length / 3 };
}

// Merge coincident corners (STL repeats every vertex per triangle) on a
// ~1/130000-of-the-model grid, normalizing as we go. Degenerate triangles
// are dropped.
function weld(
  soup: Float32Array,
  nx: (v: number) => number, ny: (v: number) => number, nz: (v: number) => number,
): { positions: Float32Array; indices: Uint32Array } {
  const Q = 131072;
  const step = Q / 4; // x, z span ~1 and y spans the height; keep each key part under Q
  let yMax = 0;
  for (let v = 1; v < soup.length; v += 3) yMax = Math.max(yMax, ny(soup[v]!));
  const yStep = step / Math.max(1, yMax / 3);
  const map = new Map<number, number>();
  const pos: number[] = [];
  const corner = new Uint32Array(soup.length / 3);
  for (let v = 0; v < corner.length; v++) {
    const x = nx(soup[v * 3]!), y = ny(soup[v * 3 + 1]!), z = nz(soup[v * 3 + 2]!);
    const key = (Math.round((x + 1) * step) * Q + Math.round(y * yStep)) * Q + Math.round((z + 1) * step);
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(x, y, z);
    }
    corner[v] = id;
  }
  const tris: number[] = [];
  for (let t = 0; t < corner.length; t += 3) {
    const a = corner[t]!, b = corner[t + 1]!, c = corner[t + 2]!;
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(tris) };
}

export type DecodedModel = { positions: Float32Array; indices: Uint32Array | Uint16Array; height: number };

/** Decode any model format. Resolves to null for anything unreadable. */
export async function decodeModel(data: string): Promise<DecodedModel | null> {
  try {
    if (data.startsWith(STL_REF_PREFIX)) {
      const bytes = await loadModel(data.slice(STL_REF_PREFIX.length));
      return bytes && decodePacked(bytes);
    }
    if (data.startsWith(STL1_PREFIX)) return decodeV1(fromBase64(data.slice(STL1_PREFIX.length)));
    if (data.startsWith(STL_PREFIX)) return decodePacked(fromBase64(data.slice(STL_PREFIX.length)));
    return null;
  } catch {
    return null;
  }
}

async function decodePacked(bytes: Uint8Array): Promise<DecodedModel | null> {
  try {
    await MeshoptDecoder.ready;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vCount = dv.getUint32(0, true);
    const iCount = dv.getUint32(4, true);
    const height = dv.getFloat32(8, true);
    const vsLen = dv.getUint32(12, true);
    if (16 + vsLen > bytes.length || iCount % 3) return null;
    const q = new Uint16Array(vCount * 4);
    MeshoptDecoder.decodeVertexBuffer(new Uint8Array(q.buffer), vCount, 8, bytes.subarray(16, 16 + vsLen));
    const indices = new Uint32Array(iCount);
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), iCount, 4, bytes.subarray(16 + vsLen));
    for (const ix of indices) if (ix >= vCount) return null;
    const positions = new Float32Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      positions[i * 3] = q[i * 4]! / 65535 - 0.5;
      positions[i * 3 + 1] = (q[i * 4 + 1]! / 65535) * height;
      positions[i * 3 + 2] = q[i * 4 + 2]! / 65535 - 0.5;
    }
    return { positions, indices, height };
  } catch {
    return null;
  }
}

// Legacy "stl1:" layout: Uint32 vCount, Uint32 triCount, Float32 height,
// then raw Uint16 xyz vertices and Uint16 indices.
function decodeV1(bytes: Uint8Array): DecodedModel | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vCount = dv.getUint32(0, true);
  const tCount = dv.getUint32(4, true);
  const height = dv.getFloat32(8, true);
  if (bytes.byteLength < 12 + vCount * 6 + tCount * 6) return null;
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
}

function quant(v: number, range: number): number {
  return Math.max(0, Math.min(65535, Math.round((v / range) * 65535)));
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
