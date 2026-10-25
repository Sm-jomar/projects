// Squads: several unit tokens bundled under one squad leader. A squad is
// "base locked": every member must be in base contact with the leader, or
// with another member that is itself linked back to the leader through an
// unbroken chain of base contact.
//
// Moving the leader carries the whole squad along in formation. Moving any
// other member slides it to the nearest spot that keeps the squad locked
// (around the edge of its neighbours), or leaves it where it was if there
// is no such spot.

import { newId, type TabletopState, type Token } from "./tabletop";
import { poolSquadStatus } from "./statusTokens";

/** Slack (inches) when deciding whether two round bases touch, so bases
 * that sit flush on the grid count as in contact despite float error. */
export const CONTACT_TOLERANCE = 0.05;

/** How many contact links a member may be from the leader (1 = must touch
 * the leader). Infinity allows any unbroken chain. */
export const MAX_LINKS_FROM_LEADER = Infinity;

type Pt = { x: number; y: number };

const center = (t: Token): Pt => ({ x: t.x + t.size / 2, y: t.y + t.size / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const contactDist = (a: Token, b: Token) => (a.size + b.size) / 2;

export function touching(a: Token, b: Token): boolean {
  return dist(center(a), center(b)) <= contactDist(a, b) + CONTACT_TOLERANCE;
}

function overlapping(a: Token, b: Token): boolean {
  return dist(center(a), center(b)) < contactDist(a, b) - CONTACT_TOLERANCE;
}

export function squadMembers(tokens: Token[], squadId: string): Token[] {
  return tokens.filter((t) => t.squadId === squadId);
}

export function squadLeader(tokens: Token[], squadId: string): Token | undefined {
  const members = squadMembers(tokens, squadId);
  return members.find((t) => t.squadLead) ?? members[0];
}

/** Every squad on the board, leader first, in board order. */
export function listSquads(tokens: Token[]): { id: string; leader: Token; members: Token[] }[] {
  const ids = [...new Set(tokens.map((t) => t.squadId).filter((x): x is string => !!x))];
  return ids.map((id) => ({ id, leader: squadLeader(tokens, id)!, members: squadMembers(tokens, id) }));
}

/** Ids of members linked to the leader through a chain of base contact. */
export function lockedIds(members: Token[], leaderId: string): Set<string> {
  const seen = new Set<string>();
  const leader = members.find((m) => m.id === leaderId);
  if (!leader) return seen;
  seen.add(leader.id);
  // Breadth-first, so each member is reached by its shortest chain.
  const queue = [{ tk: leader, links: 0 }];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.links >= MAX_LINKS_FROM_LEADER) continue;
    for (const m of members) {
      if (!seen.has(m.id) && touching(cur.tk, m)) {
        seen.add(m.id);
        queue.push({ tk: m, links: cur.links + 1 });
      }
    }
  }
  return seen;
}

/** Ids of every squad member on the board that isn't base locked. */
export function unlockedIds(tokens: Token[]): Set<string> {
  const out = new Set<string>();
  for (const sq of listSquads(tokens)) {
    const locked = lockedIds(sq.members, sq.leader.id);
    for (const m of sq.members) if (!locked.has(m.id)) out.add(m.id);
  }
  return out;
}

// Find the spot nearest `desired` (a top-left) where `tk` keeps its squad
// base locked: it must be linked to the leader, must not overlap another
// member, and must not cut off any member that was locked before.
// Returns null when nowhere fits.
function lockedSpot(tokens: Token[], tk: Token, desired: Pt): Pt | null {
  const squadId = tk.squadId!;
  const others = squadMembers(tokens, squadId).filter((m) => m.id !== tk.id);
  if (!others.length) return desired;
  const leaderId = squadLeader(tokens, squadId)!.id;
  const before = lockedIds(squadMembers(tokens, squadId), leaderId);

  const valid = (pos: Pt): boolean => {
    const moved = { ...tk, x: pos.x, y: pos.y };
    if (others.some((o) => overlapping(moved, o))) return false;
    const after = lockedIds([...others, moved], leaderId);
    if (!after.has(tk.id)) return false;
    for (const id of before) if (!after.has(id)) return false;
    return true;
  };

  if (valid(desired)) return desired;

  // Candidates on the contact ring of every other member: the point
  // straight toward the pointer, plus samples all the way round so the
  // token can slip past a crowded neighbour.
  const r = tk.size / 2;
  const want = { x: desired.x + r, y: desired.y + r };
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const o of others) {
    const oc = center(o);
    const R = contactDist(tk, o);
    const toward = Math.atan2(want.y - oc.y, want.x - oc.x);
    const angles = [toward];
    for (let i = 0; i < 24; i++) angles.push(toward + (i * Math.PI) / 12);
    for (const a of angles) {
      const c = { x: oc.x + Math.cos(a) * R, y: oc.y + Math.sin(a) * R };
      const d = dist(c, want);
      if (d >= bestD) continue;
      const pos = { x: c.x - r, y: c.y - r };
      if (valid(pos)) { best = pos; bestD = d; }
    }
  }
  return best;
}

/** Move a token to top-left (x, y), honouring its squad's base lock. */
export function moveToken(state: TabletopState, tokenId: string, x: number, y: number): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk) return state;
  if (!tk.squadId) {
    return { ...state, tokens: state.tokens.map((t) => t.id === tokenId ? { ...t, x, y } : t) };
  }
  const leader = squadLeader(state.tokens, tk.squadId)!;
  if (leader.id === tk.id) {
    // The leader carries the whole squad in formation.
    const dx = x - tk.x, dy = y - tk.y;
    return {
      ...state,
      tokens: state.tokens.map((t) => t.squadId === tk.squadId ? { ...t, x: t.x + dx, y: t.y + dy } : t),
    };
  }
  const spot = lockedSpot(state.tokens, tk, { x, y });
  if (!spot) return state;
  return { ...state, tokens: state.tokens.map((t) => t.id === tokenId ? { ...t, ...spot } : t) };
}

/** Make `tokenId` the leader of a new squad of one. */
export function startSquad(state: TabletopState, tokenId: string): TabletopState {
  const squadId = newId("sq");
  return {
    ...state,
    tokens: state.tokens.map((t) => t.id === tokenId ? { ...t, squadId, squadLead: true } : t),
  };
}

/** Add a token to a squad and pull it into base contact. The squad pools
 * its status tokens with the newcomer's (see lib/statusTokens). */
export function joinSquad(state: TabletopState, tokenId: string, squadId: string): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk) return state;
  const joined = { ...tk, squadId, squadLead: false };
  const tokens = state.tokens.map((t) => t.id === tokenId ? joined : t);
  const spot = lockedSpot(tokens, joined, { x: tk.x, y: tk.y });
  if (!spot) return state; // no room around the squad
  return { ...state, tokens: poolSquadStatus(tokens.map((t) => t.id === tokenId ? { ...t, ...spot } : t), squadId) };
}

/** Take a token out of its squad. If it led, the nearest member takes over. */
export function leaveSquad(state: TabletopState, tokenId: string): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk?.squadId) return state;
  const tokens = state.tokens.map((t) => t.id === tokenId ? { ...t, squadId: undefined, squadLead: undefined } : t);
  return { ...state, tokens: normalizeSquads(tokens, tk) };
}

export function makeLeader(state: TabletopState, tokenId: string): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk?.squadId) return state;
  return {
    ...state,
    tokens: state.tokens.map((t) => t.squadId === tk.squadId ? { ...t, squadLead: t.id === tokenId } : t),
  };
}

export function disbandSquad(state: TabletopState, squadId: string): TabletopState {
  return {
    ...state,
    tokens: state.tokens.map((t) => t.squadId === squadId ? { ...t, squadId: undefined, squadLead: undefined } : t),
  };
}

/** Pull every member that has drifted out of base contact back in, nearest
 * to the leader first. */
export function regroupSquad(state: TabletopState, squadId: string): TabletopState {
  let s = state;
  const leader = squadLeader(s.tokens, squadId);
  if (!leader) return s;
  const lc = center(leader);
  const loose = squadMembers(s.tokens, squadId)
    .filter((m) => !lockedIds(squadMembers(s.tokens, squadId), leader.id).has(m.id))
    .sort((a, b) => dist(center(a), lc) - dist(center(b), lc));
  for (const m of loose) {
    const cur = s.tokens.find((t) => t.id === m.id)!;
    const spot = lockedSpot(s.tokens, cur, { x: cur.x, y: cur.y });
    if (spot) s = { ...s, tokens: s.tokens.map((t) => t.id === m.id ? { ...t, ...spot } : t) };
  }
  return s;
}

/** Make sure every squad still has exactly one leader after tokens were
 * removed. `gone` is the token that left, used to pick the nearest heir. */
export function normalizeSquads(tokens: Token[], gone?: Token): Token[] {
  let out = tokens;
  for (const sq of listSquads(tokens)) {
    if (sq.members.some((m) => m.squadLead)) continue;
    const from = gone && gone.squadId === sq.id ? center(gone) : center(sq.members[0]!);
    const heir = sq.members.reduce((a, b) => dist(center(a), from) <= dist(center(b), from) ? a : b);
    out = out.map((t) => t.id === heir.id ? { ...t, squadLead: true } : t);
  }
  return out;
}

// --- Deploying a list entry as a squad ------------------------------------
// An army-list entry becomes one squad: the unit's printed miniatures plus
// one per upgrade that adds a mini (heavy weapons and personnel), dropped
// as a base-locked cluster around the point the player let go.

type SquadUpgrade = { id: string; name: string; type: string; adds_miniature?: boolean };

/** Whether an upgrade puts another mini in the unit. Older catalog rows
 * flag it; Tabletop Admiral rows don't, so fall back on the slot type. */
export function addsMiniature(u: SquadUpgrade): boolean {
  return u.adds_miniature ?? (u.type === "heavy-weapon" || u.type === "personnel");
}

/** The minis a list entry fields, leader first: the unit's own minis, then
 * one per mini-adding upgrade (named after the upgrade). */
export function squadMinis(
  unit: { name: string; miniatures: number },
  upgrades: SquadUpgrade[],
): { label: string; badge?: string }[] {
  const own = Array.from({ length: Math.max(0, unit.miniatures) }, () => ({ label: unit.name }));
  const extra = upgrades.filter(addsMiniature).map((u) => ({
    label: u.name,
    badge: u.type === "heavy-weapon" ? "HW" : "P",
  }));
  // A unit printed with 0 minis (The Bad Batch) is made of its upgrades;
  // without any it still needs a piece on the table.
  const minis = [...own, ...extra];
  return minis.length ? minis : [{ label: unit.name }];
}

/** Centres for `n` bases of diameter `size` packed around (0, 0): the
 * points of a hex lattice nearest the middle, so every base touches the
 * one it grew from and the squad starts base locked. */
export function squadFormation(n: number, size: number): Pt[] {
  const pts: Pt[] = [];
  const reach = Math.ceil(Math.sqrt(n)) + 1;
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      pts.push({ x: (i + j / 2) * size, y: (j * Math.sqrt(3) / 2) * size });
    }
  }
  // Nearest first; ties go clockwise from the top so the cluster grows evenly.
  const ang = (p: Pt) => (Math.atan2(p.x, -p.y) + 2 * Math.PI) % (2 * Math.PI);
  pts.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || ang(a) - ang(b));
  return pts.slice(0, n);
}

/** Lay out a squad's tokens around `at` (centre, inches), kept on the map.
 * The first token leads. Tokens get fresh ids and, for more than one mini,
 * a shared squad id. */
export function deploySquad(state: TabletopState, minis: Partial<Token>[], at: Pt): TabletopState {
  if (!minis.length) return state;
  const size = minis[0]!.size ?? 1;
  const spots = squadFormation(minis.length, size);
  const xs = spots.map((p) => p.x), ys = spots.map((p) => p.y);
  const r = size / 2;
  // Slide the whole cluster back onto the table if it hangs off an edge.
  const W = state.map.widthInches, H = state.map.heightInches;
  const cx = Math.min(Math.max(at.x, r - Math.min(...xs)), W - r - Math.max(...xs));
  const cy = Math.min(Math.max(at.y, r - Math.min(...ys)), H - r - Math.max(...ys));
  const squadId = minis.length > 1 ? newId("sq") : undefined;
  const added: Token[] = minis.map((m, i) => ({
    kind: "unit",
    label: "Unit",
    color: "neutral",
    ...m,
    id: newId("tk"),
    size,
    x: cx + spots[i]!.x - r,
    y: cy + spots[i]!.y - r,
    ...(squadId ? { squadId, squadLead: i === 0 } : {}),
  }));
  return { ...state, tokens: [...state.tokens, ...added] };
}
