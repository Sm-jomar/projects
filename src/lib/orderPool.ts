// Order token pool. Each player's list gives them one order token per unit,
// stamped with that unit's rank. A player shuffles the face-down pool,
// draws one at random and gives it to a unit of the same rank that has not
// gone yet this round. Drawn tokens stay out of the pool until the round
// ends; then every token goes back in and the pool is shuffled again.
// Players take turns drawing; once one side's pool is empty the other side
// keeps drawing until its own pool is empty too.

import type { Rank } from "./types";
import type { TabletopState, Token } from "./tabletop";

export type Side = "blue" | "red";

export type OrderToken = {
  id: string;
  rank: Rank;
  /** List entry this token was made for (ArmyEntry.entryId). */
  entryId: string;
  /** Unit name of that entry, so the other player can see it too. */
  unitName: string;
  /** Out of the pool for the rest of the round: drawn and given to a unit. */
  used?: boolean;
  /** The entry the token was given to this round. */
  assignedTo?: string;
  /** Taken out of the game (its unit was defeated). Never goes back. */
  out?: boolean;
};

export type OrderPool = {
  /** Shuffled pool order; the top of the face-down stack is the first
   * token that is neither used nor out. */
  tokens: OrderToken[];
  /** Name of the list the pool was made from. */
  listName: string;
  /** Token just drawn and waiting to be given to a unit. */
  drawn: string | null;
};

export type OrderPools = {
  blue: OrderPool | null;
  red: OrderPool | null;
  /** Whose draw it is, or null when either player may start. */
  turn: Side | null;
};

export const otherSide = (s: Side): Side => (s === "blue" ? "red" : "blue");

export function emptyPools(): OrderPools {
  return { blue: null, red: null, turn: null };
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A fresh, shuffled pool with one token per list entry. */
export function buildPool(
  listName: string,
  entries: { entryId: string; rank: Rank; unitName: string }[],
): OrderPool {
  // Two units of the same name get numbered so their tokens can be told apart.
  const total = new Map<string, number>();
  for (const e of entries) total.set(e.unitName, (total.get(e.unitName) ?? 0) + 1);
  const seen = new Map<string, number>();
  const tokens = entries.map((e, i): OrderToken => {
    const n = (seen.get(e.unitName) ?? 0) + 1;
    seen.set(e.unitName, n);
    const unitName = total.get(e.unitName)! > 1 ? `${e.unitName} ${n}` : e.unitName;
    return { id: `ot_${i}_${e.entryId}`, rank: e.rank, entryId: e.entryId, unitName };
  });
  return { tokens: shuffle(tokens), listName, drawn: null };
}

/** Tokens still face down in the pool. */
export function inPool(p: OrderPool | null): OrderToken[] {
  return p ? p.tokens.filter((t) => !t.used && !t.out && t.id !== p.drawn) : [];
}

/** Whether a side still has anything to do this round: tokens to draw, or
 * one drawn and not yet given out. */
export function hasDraws(p: OrderPool | null): boolean {
  return !!p && (inPool(p).length > 0 || !!p.drawn);
}

export function poolsOf(s: TabletopState): OrderPools {
  return s.orders ?? emptyPools();
}

function withPool(s: TabletopState, side: Side, pool: OrderPool | null, turn?: Side | null): TabletopState {
  const o = poolsOf(s);
  return { ...s, orders: { ...o, [side]: pool, turn: turn === undefined ? o.turn : turn } };
}

export function setPool(s: TabletopState, side: Side, pool: OrderPool | null): TabletopState {
  return withPool(s, side, pool);
}

/** Reshuffle the face-down tokens. Used and drawn ones keep their place. */
export function shufflePool(s: TabletopState, side: Side): TabletopState {
  const p = poolsOf(s)[side];
  if (!p) return s;
  const down = shuffle(inPool(p));
  let i = 0;
  const tokens = p.tokens.map((t) => (!t.used && !t.out && t.id !== p.drawn ? down[i++]! : t));
  return withPool(s, side, { ...p, tokens });
}

/** The side whose command card has fewer pips takes priority and draws
 * first. Null until both have revealed a card, or on a tie until the
 * roll-off is made. */
export function prioritySide(s: Pick<TabletopState, "hands" | "priorityRoll">): Side | null {
  const pips = (side: Side) => {
    const h = s.hands[side];
    return h.thisRound == null ? null : h.cards[h.thisRound]?.pips ?? null;
  };
  const b = pips("blue"), r = pips("red");
  if (b == null || r == null) return null;
  if (b === r) {
    const roll = s.priorityRoll;
    return roll && roll.blue !== roll.red ? (roll.blue > roll.red ? "blue" : "red") : null;
  }
  return b < r ? "blue" : "red";
}

/** Who may draw now. Null when nobody can (pools empty) and "either" when
 * the round's first draw has not been made and no one has priority. */
export function whoDraws(s: TabletopState): Side | "either" | null {
  const o = poolsOf(s);
  const b = hasDraws(o.blue), r = hasDraws(o.red);
  if (!b && !r) return null;
  if (b !== r) return b ? "blue" : "red";
  return o.turn ?? prioritySide(s) ?? "either";
}

export function canDraw(s: TabletopState, side: Side): boolean {
  const p = poolsOf(s)[side];
  if (!p || p.drawn || inPool(p).length === 0) return false;
  const w = whoDraws(s);
  return w === "either" || w === side;
}

/** Turn the top token of the face-down stack over. */
export function drawToken(s: TabletopState, side: Side): TabletopState {
  if (!canDraw(s, side)) return s;
  const p = poolsOf(s)[side]!;
  const top = inPool(p)[0]!;
  return withPool(s, side, { ...p, drawn: top.id }, side);
}

/** Put a drawn token back face down and reshuffle. */
export function returnDrawn(s: TabletopState, side: Side): TabletopState {
  const p = poolsOf(s)[side];
  if (!p?.drawn) return s;
  return shufflePool(withPool(s, side, { ...p, drawn: null }), side);
}

// After a side finishes its draw the turn passes to the other side, unless
// the other side has run out — then the same side keeps drawing.
function passTurn(o: OrderPools, side: Side): Side | null {
  if (hasDraws(o[otherSide(side)])) return otherSide(side);
  if (hasDraws(o[side])) return side;
  return null;
}

/** Board tokens of one list entry (the squad, or the single mini). */
export function entryTokens(s: TabletopState, entryId: string): Token[] {
  return s.tokens.filter((t) => t.armyEntryId === entryId);
}

/** Entries the drawn token can go to: same rank, no token yet this round
 * and not activated on the board. */
export function eligibleEntries(s: TabletopState, side: Side): OrderToken[] {
  const p = poolsOf(s)[side];
  const drawn = p?.tokens.find((t) => t.id === p.drawn);
  if (!p || !drawn) return [];
  const taken = new Set(p.tokens.filter((t) => t.used && t.assignedTo).map((t) => t.assignedTo!));
  const seen = new Set<string>();
  return p.tokens.filter((t) => {
    if (t.rank !== drawn.rank || t.out || taken.has(t.entryId) || seen.has(t.entryId)) return false;
    seen.add(t.entryId);
    return !entryTokens(s, t.entryId).some((k) => k.activated);
  });
}

/** Give the drawn token to a unit: it leaves the pool for the round and
 * the unit's minis get the order. */
export function assignDrawn(s: TabletopState, side: Side, entryId: string): TabletopState {
  const o = poolsOf(s);
  const p = o[side];
  if (!p?.drawn) return s;
  const tokens = p.tokens.map((t) => (t.id === p.drawn ? { ...t, used: true, assignedTo: entryId } : t));
  const pool = { ...p, tokens, drawn: null };
  const next = { ...o, [side]: pool };
  return {
    ...s,
    tokens: s.tokens.map((t) => (t.armyEntryId === entryId ? { ...t, ordered: true } : t)),
    orders: { ...next, turn: passTurn(next, side) },
  };
}

/** The drawn token's unit is gone: take the token out of the game. */
export function discardDrawn(s: TabletopState, side: Side): TabletopState {
  const o = poolsOf(s);
  const p = o[side];
  if (!p?.drawn) return s;
  const tokens = p.tokens.map((t) => (t.id === p.drawn ? { ...t, out: true } : t));
  const next = { ...o, [side]: { ...p, tokens, drawn: null } };
  return { ...s, orders: { ...next, turn: passTurn(next, side) } };
}

/** End of round: every token not out of the game goes back in, shuffled. */
export function resetPools(o: OrderPools | undefined): OrderPools | undefined {
  if (!o) return o;
  const reset = (p: OrderPool | null): OrderPool | null =>
    p && {
      ...p,
      drawn: null,
      tokens: shuffle(p.tokens.map((t) => ({ ...t, used: undefined, assignedTo: undefined }))),
    };
  return { blue: reset(o.blue), red: reset(o.red), turn: null };
}

/** A new game: everything back in, including tokens taken out. */
export function restartPools(o: OrderPools | undefined): OrderPools | undefined {
  if (!o) return o;
  const fresh = (p: OrderPool | null) => p && { ...p, tokens: p.tokens.map((t) => ({ ...t, out: undefined })) };
  return resetPools({ ...o, blue: fresh(o.blue), red: fresh(o.red) });
}
