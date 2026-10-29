// The Legion adapter for an AI seat: it plays one side the way a person at
// the table would, through the same board state.
//
//   Setup     deploy a list into its Territory, take its order tokens and
//             a command hand (blue goes first so the two don't collide).
//   Command   lock in a command card face down, reveal once both have,
//             roll off a tie.
//   Activate  on its draw: draw an order token, give it to a unit of that
//             rank, take up to two actions (move, attack, aim, dodge,
//             recover), then mark the unit activated.
//   End       when both pools are empty, one AI ends the round: score the
//             objectives, clean up, advance the round; after round 6 (or a
//             wipe-out) it declares the result.
//
// Every step that needs judgement is a decision with options, so Claude
// can make it; each option also carries a built-in tactics score.

import { unitById } from "../../data/catalog";
import { RANK_LABEL } from "../factions";
import { missionById } from "../missions";
import {
  assignDrawn, discardDrawn, drawToken, eligibleEntries, poolsOf, prioritySide, whoDraws,
  otherSide, type Side,
} from "../orderPool";
import { endRound } from "../round";
import { diffLegion, bothLocked, isStandingOrders, territories, type TabletopState, type Token } from "../tabletop";
import { appendLog } from "../auditLog";
import type { Unit, Weapon } from "../types";
import type { AiApplied, AiOption, AiStep, GameAdapter, SeatContext } from "./types";
import { deployArmy, poolFromBoard, starterArmy, armyPoints, type ArmyChoice, FACTION_NAME } from "./legionArmy";
import { attackPool, expectedWounds, rangeOf, weaponReaches, RANGE_INCHES } from "./legionCombat";
import {
  aimRerollStep, boardUnits, declareAttack, maxDodge, rerollable, rollAttackStep, rollDefenseStep,
  setDodgeStep, toDefenseStep, weaponsOf, type BoardUnit,
} from "../attack";
import { center, coverAgainst, dist, planMove, terrainCenter, terrainDistance, unitGap, type Pt } from "./legionGeometry";

export const LAST_ROUND = 6;
const SIDE_NAME: Record<Side, string> = { blue: "Blue", red: "Red" };
const SEGMENT = 2.5; // inches per speed (see TEMPLATE_SEGMENT_INCHES)

export { boardUnits, type BoardUnit };

const unitsOf = (s: TabletopState, side: Side) => boardUnits(s).filter((u) => u.side === side);
const objectives = (s: TabletopState) => s.tokens.filter((t) => t.kind === "objective");
const fmt = (p: Pt) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

function inZone(s: TabletopState, side: Side, p: Pt): boolean {
  return (territories(s)?.[side] ?? []).some((z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h);
}

/** Units of each side contesting an objective (a mini within range 1). */
function contest(s: TabletopState, poi: Token): Record<Side, number> {
  const c = { blue: 0, red: 0 };
  for (const u of boardUnits(s)) if (unitGap(u.tokens, [poi]) <= RANGE_INCHES) c[u.side]++;
  return c;
}

/** End Phase VP for each side, with a line saying where they came from. */
export function scoreRound(s: TabletopState): { vp: Record<Side, number>; lines: string[] } {
  const vp = { blue: 0, red: 0 };
  const pois = objectives(s);
  if (s.round < 2 || pois.length === 0) return { vp, lines: [] };
  const m = missionById(s.mission);
  const mid = { x: s.map.widthInches / 2, y: s.map.heightInches / 2 };
  const centerPoi = pois.reduce((a, b) => (dist(center(b), mid) < dist(center(a), mid) ? b : a));
  const lines: string[] = [];
  for (const side of ["blue", "red"] as Side[]) {
    const foe = otherSide(side);
    let got = 0;
    const contested = pois.filter((p) => contest(s, p)[side] > 0).length;
    if (m?.id === "recover-the-research") {
      got = contested >= 4 ? 3 : contested === 3 ? 2 : contested === 2 ? 1 : 0;
    } else {
      for (const p of pois) {
        const c = contest(s, p);
        const secure = c[side] > c[foe];
        if (m?.id === "breakthrough") {
          if (inZone(s, side, center(p)) && c[side] > 0 && c[foe] === 0) got += 1;
          else if (inZone(s, foe, center(p)) && secure) got += 2;
        } else if (m?.id === "intercept-signals") {
          if (secure && !inZone(s, side, center(p))) got += 1;
        } else if (secure) {
          got += m && /center/i.test(m.scoring) && p === centerPoi ? 2 : 1;
        }
      }
    }
    vp[side] = got;
    if (got) lines.push(`${SIDE_NAME[side]} scores ${got} VP (${contested} objective${contested === 1 ? "" : "s"} contested).`);
  }
  return { vp, lines };
}

/** The best weapon this unit can fire at that one now, if any. */
function bestShot(s: TabletopState, me: BoardUnit, foe: BoardUnit): { w: Weapon; score: number; dice: number } | null {
  let best: { w: Weapon; score: number; dice: number } | null = null;
  const gap = unitGap(me.tokens, foe.tokens);
  for (const w of weaponsOf(me.unit)) {
    if (!weaponReaches(w, gap)) continue;
    const { pool } = attackPool(w, me.tokens, foe.tokens);
    const dice = (pool.red ?? 0) + (pool.black ?? 0) + (pool.white ?? 0);
    if (!dice) continue;
    const score = expectedWounds(pool, foe.unit, coverAgainst(s, center(me.lead), foe.tokens));
    if (!best || score > best.score) best = { w, score, dice };
  }
  return best;
}

function longestReach(u: Unit | undefined): number {
  return Math.max(1, ...weaponsOf(u).map((w) => Math.min(w.max_range ?? 4, 4)));
}

type Activation = { key: string; left: number; attacked: boolean; moved: number };

export class LegionAdapter implements GameAdapter<TabletopState> {
  private pick: { round: number; index: number } | null = null;
  private act: Activation | null = null;
  private lessonDone = false;
  /** Attacks this seat declared, and the last one it reported. */
  private declared = new Set<string>();
  private announced: string | null = null;
  /** The seat's name, for "declared by". */
  private name = "AI";
  private side: Side | null = null;
  private readonly army: ArmyChoice | null;

  /** `army`: what to deploy when the side has nothing on the table. */
  constructor(army: ArmyChoice | null) { this.army = army; }

  over(s: TabletopState): boolean { return !!s.result; }

  log(prev: TabletopState, next: TabletopState, actorName: string): TabletopState {
    const color = this.side === "red" ? "#e67a6f" : "#6fa8e6";
    const entries = diffLegion(prev, next, { name: actorName, color });
    return entries.length ? { ...next, log: appendLog(next.log, entries) } : next;
  }

  next(s: TabletopState, ctx: SeatContext): AiStep<TabletopState> | null {
    const side = ctx.you.color as Side;
    if (side !== "blue" && side !== "red") return null;
    this.side = side;
    this.name = ctx.you.name || "AI";
    const foe = otherSide(side);
    if (s.result) return this.lessonStep(s, side);
    const pools = poolsOf(s);
    const seated = (sd: Side) => ctx.peers.some((p) => p.color === sd);

    // --- Setup ---------------------------------------------------------
    if (!pools[side]) {
      // Blue sets up first, so two AIs never deploy over each other.
      if (side === "red" && seated("blue") && !pools.blue) return null;
      return this.setupStep(s, side);
    }
    if (!pools[foe]) return null;

    // --- An attack being rolled -----------------------------------------
    if (s.attack && s.attack.stage !== "done") return this.attackStep(s, side, ctx);
    if (s.attack?.stage === "done" && s.attack.attacker.side === side && this.announced !== s.attack.id && this.declared.has(s.attack.id)) {
      const a = s.attack;
      return { label: "Report the attack", apply: (st) => { this.announced = a.id; return { state: st, chat: [a.text ?? "", ...a.notes.filter((n) => /VP/.test(n))].filter(Boolean) }; } };
    }

    // A side with nothing left on the table has lost.
    const alive = (sd: Side) => unitsOf(s, sd).length > 0;
    if ((!alive("blue") || !alive("red")) && this.isEnder(side, ctx)) return this.gameOverStep(s);

    // --- Command phase -----------------------------------------------
    const hand = s.hands[side];
    if (hand.thisRound == null) {
      if (!hand.locked) return this.lockStep(s, side);
      if (!bothLocked(s)) return null;
      return this.revealStep(side);
    }
    if (s.hands[foe].thisRound == null) return null;
    if (prioritySide(s) == null && this.isEnder(side, ctx)) {
      const b = s.hands.blue.cards[s.hands.blue.thisRound!]?.pips, r = s.hands.red.cards[s.hands.red.thisRound!]?.pips;
      if (b === r && !(s.priorityRoll && s.priorityRoll.blue !== s.priorityRoll.red)) return this.rollOffStep();
    }

    // --- Activation phase ---------------------------------------------
    const w = whoDraws(s);
    if (w === null) {
      if (!this.isEnder(side, ctx)) return null;
      return this.endRoundStep(s);
    }
    if (w !== side && !(w === "either" && side === "blue")) return null;
    const pool = pools[side]!;
    if (!pool.drawn) {
      this.act = null;
      return { label: "Draw an order token", apply: (st) => ({ state: drawToken(st, side) }) };
    }
    if (!this.act) return this.giveOrderStep(s, side);
    return this.actionStep(s, side);
  }

  // The AI that ends rounds and declares the result: blue's if blue is an
  // AI, else red's (a person ends their own rounds otherwise).
  private isEnder(side: Side, ctx: SeatContext): boolean {
    const blueAi = ctx.peers.some((p) => p.color === "blue" && p.ai);
    return side === "blue" || !blueAi;
  }

  private setupStep(s: TabletopState, side: Side): AiStep<TabletopState> {
    const mine = unitsOf(s, side).filter((u) => u.entryId && u.unit);
    if (mine.length) {
      return {
        label: "Take order tokens for the units on the table",
        apply: (st) => ({
          state: poolFromBoard(st, side, unitsOf(st, side).filter((u) => u.entryId && u.unit).map((u) => ({ entryId: u.entryId!, unit: u.unit! }))),
          chat: [`${SIDE_NAME[side]} takes order tokens for its ${mine.length} units on the table.`],
        }),
      };
    }
    const army = this.army?.kind === "saved" ? this.army.army
      : starterArmy(this.army?.kind === "starter" ? this.army.faction : side === "blue" ? "rebels" : "imperials", side);
    return {
      label: `Deploy ${army.name}`,
      apply: (st) => {
        const next = deployArmy(st, side, army);
        const names = army.entries.map((e) => unitById(e.unitId)?.name).filter(Boolean);
        return {
          state: next,
          chat: [`${SIDE_NAME[side]} deploys ${army.name} (${FACTION_NAME[army.faction]}, ${armyPoints(army)} pts): ${names.join(", ")}.`],
        };
      },
    };
  }

  private lockStep(s: TabletopState, side: Side): AiStep<TabletopState> {
    const hand = s.hands[side];
    const options: AiOption[] = hand.cards.flatMap((c, i) => c.played ? [] : [{
      id: String(i),
      label: `${c.name ?? (c.pips === 4 ? "Standing Orders" : `${c.pips}-pip card`)} (${c.pips} pip${c.pips === 1 ? "" : "s"})`,
      // Tactics: spend low cards early for priority, keep Standing Orders.
      score: (isStandingOrders(c) ? -2 : 0) + (c.pips === 1 ? 3 : c.pips === 2 ? 2 : 1) + Math.random(),
    }]);
    return {
      label: "pick a command card",
      decision: {
        kind: "command-card",
        question: `Round ${s.round}: which command card do you lock in? Fewer pips takes priority (you draw order tokens first); a spent card is gone for the game, except Standing Orders.`,
        options,
      },
      observe: () => this.observe(s, side),
      apply: (st, choice) => {
        const index = Number(choice);
        this.pick = { round: st.round, index };
        return { state: { ...st, hands: { ...st.hands, [side]: { ...st.hands[side], locked: true, thisRound: null } } },
          chat: [`${SIDE_NAME[side]} locks in a command card.`] };
      },
    };
  }

  private revealStep(side: Side): AiStep<TabletopState> {
    return {
      label: "Reveal the command card",
      apply: (st) => {
        const hand = st.hands[side];
        let index = this.pick && this.pick.round === st.round ? this.pick.index : -1;
        if (!hand.cards[index] || hand.cards[index]!.played) {
          // Lost the pick (page reloaded): reveal the cheapest card left.
          index = hand.cards.reduce((b, c, i) => !c.played && (b < 0 || c.pips < hand.cards[b]!.pips) ? i : b, -1);
        }
        const c = hand.cards[index]!;
        return {
          state: { ...st, hands: { ...st.hands, [side]: { ...hand, locked: true, thisRound: index } } },
          chat: [`${SIDE_NAME[side]} reveals ${c.name ?? `a ${c.pips}-pip card`} (${c.pips} pip${c.pips === 1 ? "" : "s"}).`],
        };
      },
    };
  }

  private rollOffStep(): AiStep<TabletopState> {
    return {
      label: "Roll off for priority",
      apply: (st) => {
        let blue = 0, red = 0;
        while (blue === red) { blue = 1 + Math.floor(Math.random() * 6); red = 1 + Math.floor(Math.random() * 6); }
        return { state: { ...st, priorityRoll: { blue, red } }, chat: [`Tied pips: roll-off Blue ${blue}, Red ${red}. ${blue > red ? "Blue" : "Red"} has priority.`] };
      },
    };
  }

  private giveOrderStep(s: TabletopState, side: Side): AiStep<TabletopState> {
    const pool = poolsOf(s)[side]!;
    const drawn = pool.tokens.find((t) => t.id === pool.drawn)!;
    const live = new Map(unitsOf(s, side).filter((u) => u.entryId).map((u) => [u.entryId!, u]));
    const eligible = eligibleEntries(s, side).filter((t) => live.has(t.entryId));
    if (eligible.length === 0) {
      return {
        label: "Discard an order token with no unit left",
        apply: (st) => ({ state: discardDrawn(st, side), chat: [`${SIDE_NAME[side]} has no ${RANK_LABEL[drawn.rank].toLowerCase()} unit left for that order token, so it leaves the game.`] }),
      };
    }
    const foes = unitsOf(s, otherSide(side));
    const start = (key: string): AiApplied<TabletopState> => {
      const u = live.get(key)!;
      const supp = u.lead.suppression ?? 0;
      const suppressed = supp > 0 && supp >= (u.unit?.courage ?? 99);
      this.act = { key, left: suppressed ? 1 : 2, attacked: false, moved: 0 };
      return {
        state: { ...s, tokens: s.tokens.map((t) => t.armyEntryId === key ? { ...t, ordered: true } : t) },
        chat: [`${SIDE_NAME[side]} draws a ${RANK_LABEL[drawn.rank]} order and activates ${u.name}${suppressed ? " (suppressed: one action)" : ""}.`],
      };
    };
    if (eligible.length === 1) return { label: "Give the order token", apply: () => start(eligible[0]!.entryId) };
    const options = eligible.map((t): AiOption => {
      const u = live.get(t.entryId)!;
      const shot = Math.max(0, ...foes.map((f) => bestShot(s, u, f)?.score ?? 0));
      const near = Math.min(...foes.map((f) => unitGap(u.tokens, f.tokens)), 99);
      return { id: t.entryId, label: `${u.name} at ${fmt(center(u.lead))}${shot ? ", can shoot now" : `, nearest enemy ${near.toFixed(0)}" away`}`, score: shot * 3 + 10 / (1 + near) };
    });
    return {
      label: "choose a unit to activate",
      decision: { kind: "order", question: `You drew a ${RANK_LABEL[drawn.rank]} order token. Which ${RANK_LABEL[drawn.rank].toLowerCase()} unit activates now?`, options },
      observe: () => this.observe(s, side),
      apply: (_st, choice) => start(choice ?? eligible[0]!.entryId),
    };
  }

  private finish(s: TabletopState, side: Side, key: string): TabletopState {
    const done = { ...s, tokens: s.tokens.map((t) => t.armyEntryId === key ? { ...t, activated: true, ordered: true } : t) };
    this.act = null;
    return assignDrawn(done, side, key);
  }

  private actionStep(s: TabletopState, side: Side): AiStep<TabletopState> {
    const act = this.act!;
    const me = unitsOf(s, side).find((u) => u.key === act.key);
    if (!me) {
      // Defeated mid-activation (or removed by a person): hand the token in.
      return { label: "End activation", apply: (st) => ({ state: this.finish(st, side, act.key) }) };
    }
    if (act.left <= 0) return { label: "End activation", apply: (st) => ({ state: this.finish(st, side, act.key) }) };

    const foes = unitsOf(s, otherSide(side));
    const options: AiOption[] = [];
    type Do = (st: TabletopState) => AiApplied<TabletopState>;
    const doers = new Map<string, Do>();
    const add = (o: AiOption, fn: Do) => { options.push(o); doers.set(o.id, fn); };
    const spend = (fn: Do): Do => (st) => { const out = fn(st); act.left--; return out; };
    const from = center(me.lead);
    const speed = me.unit?.speed ?? 2;
    const reach = speed * SEGMENT;

    // Attacks (one per activation).
    const shots = act.attacked ? [] : foes.map((f) => ({ f, shot: bestShot(s, me, f) })).filter((x) => x.shot);
    for (const { f, shot } of shots) {
      const gap = unitGap(me.tokens, f.tokens);
      add({ id: `attack:${f.key}`, label: `Attack ${f.name} with ${shot!.w.name} (range ${rangeOf(gap)}, ${shot!.dice} dice, ~${shot!.score.toFixed(1)} wounds expected)`, score: 8 + shot!.score * 2 }, spend((st) => {
        act.attacked = true;
        const cur = unitsOf(st, side).find((u) => u.key === me.key) ?? me;
        const tgt = unitsOf(st, otherSide(side)).find((u) => u.key === f.key) ?? f;
        // Declared here; the dice are rolled in the steps that follow
        // (see attackStep), the same way a person at the table does it.
        const minis = attackPool(shot!.w, cur.tokens, tgt.tokens).minis;
        return {
          state: declareAttack(st, cur, tgt, [{ name: shot!.w.name, minis }], this.name),
          chat: [`${cur.name} attacks ${tgt.name} with ${shot!.w.name}.`],
        };
      }));
    }

    // Moves: toward each objective, the nearest enemy, cover, or home.
    const move = (id: string, label: string, phrase: string, target: Pt, stopAt: number, score: number) => {
      const d = planMove(s, me.tokens, from, target, reach, stopAt);
      const len = Math.hypot(d.x, d.y);
      if (len < 0.5) return;
      const heading = Math.round((Math.atan2(d.x, -d.y) * 180) / Math.PI);
      add({ id, label: `${label} (${len.toFixed(1)}")`, score }, spend((st) => {
        act.moved++;
        const keys = new Set(me.tokens.map((t) => t.id));
        return {
          state: { ...st, tokens: st.tokens.map((t) => keys.has(t.id) ? { ...t, x: t.x + d.x, y: t.y + d.y, ...(t.rotation != null ? { rotation: heading } : {}) } : t) },
          chat: [`${me.name} moves ${len.toFixed(1)}" ${phrase}.`],
        };
      }));
    };
    const pois = objectives(s);
    pois.forEach((p, i) => {
      const c = contest(s, p);
      const held = c[side] > c[otherSide(side)];
      const gap = unitGap(me.tokens, [p]);
      if (gap <= 1) return;
      move(`move:poi:${i}`, `Move toward ${p.label} ${i + 1} at ${fmt(center(p))}${held ? " (we hold it)" : ""}`, `toward ${p.label} ${i + 1}`, center(p), 1 + p.size / 2,
        (held ? 2 : 6) - gap / 12 + (shots.length && !act.attacked ? -3 : 0));
    });
    const nearest = foes.reduce<{ f: BoardUnit; gap: number } | null>((b, f) => {
      const gap = unitGap(me.tokens, f.tokens);
      return !b || gap < b.gap ? { f, gap } : b;
    }, null);
    if (nearest) {
      const want = longestReach(me.unit) * RANGE_INCHES - 1;
      if (nearest.gap > want) move(`move:enemy:${nearest.f.key}`, `Advance toward ${nearest.f.name}`, `toward ${nearest.f.name}`, center(nearest.f.lead), want, shots.length ? 1 : 5);
    }
    const cover = s.terrain.filter((t) => t.kind !== "objective")
      .map((t) => ({ t, gap: terrainDistance(t, from) }))
      .filter((x) => x.gap > 1 && x.gap < reach * 1.5)
      .sort((a, b) => a.gap - b.gap)[0];
    if (cover) move(`move:cover`, `Move into cover by the ${cover.t.label || cover.t.kind}`, `into cover by the ${cover.t.label || cover.t.kind}`, terrainCenter(cover.t), Math.max(cover.t.width, cover.t.height) / 2 + 1, 2.5);
    if (!inZone(s, side, from) && territories(s)) {
      const home = territories(s)![side][0]!;
      move("move:home", "Fall back toward our Territory", "back toward its Territory", { x: home.x + home.w / 2, y: home.y + home.h / 2 }, 2, 0.5);
    }

    // Tokens.
    const aim = me.lead.status?.aim ?? 0;
    if (shots.length && !aim && act.left > 1) {
      add({ id: "aim", label: "Aim (take an aim token: reroll up to 2 attack dice)", score: 9 }, spend((st) => ({
        state: { ...st, tokens: st.tokens.map((t) => t.armyEntryId === me.key || t.id === me.lead.id ? { ...t, status: { ...t.status, aim: (t.status?.aim ?? 0) + 1 } } : t) },
        chat: [`${me.name} aims.`],
      })));
    }
    if (!(me.lead.status?.dodge)) {
      add({ id: "dodge", label: "Dodge (take a dodge token: cancel a hit when attacked)", score: nearest && nearest.gap < 18 ? 1.5 : 0.3 }, spend((st) => ({
        state: { ...st, tokens: st.tokens.map((t) => me.tokens.some((m) => m.id === t.id) ? { ...t, status: { ...t.status, dodge: 1 } } : t) },
        chat: [`${me.name} takes a dodge token.`],
      })));
    }
    if ((me.lead.suppression ?? 0) > 0) {
      add({ id: "recover", label: `Recover (remove ${me.lead.suppression} suppression)`, score: 1 + (me.lead.suppression ?? 0) }, spend((st) => ({
        state: { ...st, tokens: st.tokens.map((t) => me.tokens.some((m) => m.id === t.id) ? { ...t, suppression: 0 } : t) },
        chat: [`${me.name} recovers.`],
      })));
    }
    add({ id: "end", label: "End this unit's activation", score: -1 }, (st) => ({ state: this.finish(st, side, act.key) }));

    return {
      label: `${me.name}: action ${3 - act.left - (act.left > 2 ? 1 : 0)}`,
      decision: {
        kind: "action",
        question: `${me.name} has ${act.left} action${act.left === 1 ? "" : "s"} left${act.attacked ? " (it has already attacked)" : ""}. What does it do?`,
        options,
      },
      observe: () => this.observe(s, side, me),
      apply: (st, choice) => (doers.get(choice ?? "end") ?? doers.get("end")!)(st),
    };
  }

  /** Seconds to wait for a person to roll their defense before the AI
   * rolls it for them. */
  static readonly DEFENSE_WAIT_MS = 25000;

  wakeIn(s: TabletopState): number | null {
    const a = s.attack;
    if (!a || a.stage !== "defend" || a.defender.side === this.side) return null;
    return Math.max(500, a.ts + LegionAdapter.DEFENSE_WAIT_MS - Date.now() + 100);
  }

  // Each step of the attack sequence is its own move, so the table sees
  // the dice come up one stage at a time.
  private attackStep(s: TabletopState, side: Side, ctx: SeatContext): AiStep<TabletopState> | null {
    const a = s.attack!;
    if (a.stage === "declared" && a.attacker.side === side) {
      this.declared.add(a.id);
      return { label: "Roll attack dice", apply: (st) => ({ state: rollAttackStep(st) }) };
    }
    if (a.stage === "rolled" && a.attacker.side === side) {
      const want = a.dice.filter((d) => rerollable(a, d, s)).length;
      if (a.aimLeft > 0 && want > 0) {
        return { label: "Spend aim to reroll", apply: (st) => ({ state: aimRerollStep(st), chat: [`${a.attacker.name} spends an aim token to reroll ${Math.min(want, a.rerollsPerAim)} dice.`] }) };
      }
      return { label: "Convert surges and check cover", apply: (st) => ({ state: toDefenseStep(st) }) };
    }
    if (a.stage === "defend") {
      const mine = a.defender.side === side;
      // A person defending rolls their own dice; after a while (or with
      // nobody in that seat) the attacking AI rolls for them.
      const person = ctx.peers.some((p) => p.color === a.defender.side && !p.ai);
      const seated = ctx.peers.some((p) => p.color === a.defender.side);
      const late = Date.now() - a.ts > LegionAdapter.DEFENSE_WAIT_MS;
      if (!mine && !(a.attacker.side === side && (!seated || (person && late)))) return null;
      const dodge = maxDodge(a);
      return {
        label: "Roll defense",
        apply: (st) => {
          const out = rollDefenseStep(dodge ? setDodgeStep(st, dodge) : st);
          return { state: out, chat: [
            ...(mine && dodge ? [`${a.defender.name} spends ${dodge === 1 ? "a dodge token" : `${dodge} dodge tokens`}.`] : []),
            ...(!mine ? [`(Rolling defense for ${a.defender.name}.)`] : []),
          ] };
        },
      };
    }
    return null;
  }

  private endRoundStep(s: TabletopState): AiStep<TabletopState> {
    return {
      label: `End round ${s.round}`,
      apply: (st) => {
        const { vp, lines } = scoreRound(st);
        let next: TabletopState = { ...st, vp: { blue: st.vp.blue + vp.blue, red: st.vp.red + vp.red } };
        const chat = [`End of round ${st.round}.`, ...lines, `Score: Blue ${next.vp.blue}, Red ${next.vp.red}.`];
        if (st.round >= LAST_ROUND) return this.declare(next, chat, `after ${LAST_ROUND} rounds`);
        next = endRound(next);
        chat.push(`Round ${next.round} begins: pick command cards.`);
        return { state: next, chat };
      },
    };
  }

  private gameOverStep(s: TabletopState): AiStep<TabletopState> {
    const wiped = (["blue", "red"] as Side[]).filter((sd) => unitsOf(s, sd).length === 0);
    return {
      label: "Declare the result",
      apply: (st) => {
        const chat: string[] = [];
        if (wiped.length === 1) {
          // Wiping out the enemy ends the game; the survivor wins.
          const winner = otherSide(wiped[0]!);
          const text = `${SIDE_NAME[wiped[0]!]} has no units left. ${SIDE_NAME[winner]} wins (${st.vp.blue}–${st.vp.red} VP)!`;
          return { state: { ...st, result: { winner, text } }, chat: [text] };
        }
        return this.declare(st, chat, "with both armies gone");
      },
    };
  }

  private declare(st: TabletopState, chat: string[], when: string): AiApplied<TabletopState> {
    const winner = st.vp.blue === st.vp.red ? "draw" : st.vp.blue > st.vp.red ? "blue" : "red";
    const text = winner === "draw"
      ? `Game over ${when}: a draw, ${st.vp.blue}–${st.vp.red} VP.`
      : `Game over ${when}: ${SIDE_NAME[winner]} wins, ${st.vp.blue}–${st.vp.red} VP!`;
    return { state: { ...st, result: { winner, text } }, chat: [...chat, text] };
  }

  private lessonStep(s: TabletopState, side: Side): AiStep<TabletopState> | null {
    if (this.lessonDone) return null;
    const won = s.result?.winner === side;
    const summary = `${won ? "Won" : s.result?.winner === "draw" ? "Drew" : "Lost"} as ${SIDE_NAME[side]} ${s.vp[side]}–${s.vp[otherSide(side)]} VP` +
      `${s.mission ? ` on ${missionById(s.mission)?.name}` : ""} by round ${Math.min(s.round, LAST_ROUND)}; ${unitsOf(s, side).length} of my units left.`;
    return {
      label: "write down what it learned",
      decision: {
        kind: "lesson",
        question: "The game is over. Write one short lesson for your next game in `say` and pick \"save\", or pick \"summary\" to keep only the result.",
        options: [{ id: "save", label: "Save my lesson (written in say)", score: 0 }, { id: "summary", label: "Keep just the result", score: 1 }],
      },
      observe: () => this.observe(s, side),
      apply: (st, choice) => {
        this.lessonDone = true;
        return { state: st, ...(choice === "summary" ? { lesson: summary } : {}) };
      },
    };
  }

  /** The board as text, from this side's point of view. */
  observe(s: TabletopState, side: Side, active?: BoardUnit): string {
    const foe = otherSide(side);
    const m = missionById(s.mission);
    const lines: string[] = [];
    lines.push(`You are ${SIDE_NAME[side]}. Round ${s.round} of ${LAST_ROUND}. VP: you ${s.vp[side]}, enemy ${s.vp[foe]}.`);
    lines.push(`Board ${s.map.widthInches}" × ${s.map.heightInches}" (x right, y down, inches). Range 1 = 6".`);
    if (m) lines.push(`Mission ${m.name}: ${m.scoring}`);
    else if (objectives(s).length) lines.push("Scoring: from round 2, 1 VP per objective you Secure each End Phase (more of your units than enemy units within range 1).");
    else lines.push("Scoring: no objectives on the table, so each enemy unit you defeat is worth 1 VP.");
    const t = territories(s);
    if (t) lines.push(`Your Territory: ${t[side].map((z) => `x ${z.x.toFixed(0)}–${(z.x + z.w).toFixed(0)}, y ${z.y.toFixed(0)}–${(z.y + z.h).toFixed(0)}`).join("; ")}.`);
    const mine = s.hands[side];
    lines.push(`Your command cards left: ${mine.cards.filter((c) => !c.played).map((c) => `${c.name ?? "card"} (${c.pips})`).join(", ") || "none"}.`);
    const unitLine = (u: BoardUnit) => {
      const tags = [
        u.unit ? RANK_LABEL[u.unit.rank] : "",
        `${u.tokens.length} mini${u.tokens.length === 1 ? "" : "s"}`,
        u.tokens.some((k) => k.wounds) ? `${u.tokens.reduce((n, k) => n + (k.wounds ?? 0), 0)} wounds` : "",
        u.lead.suppression ? `suppression ${u.lead.suppression}` : "",
        u.lead.status?.aim ? "aim" : "", u.lead.status?.dodge ? "dodge" : "",
        u.lead.activated ? "activated" : u.lead.ordered ? "ordered" : "",
      ].filter(Boolean).join(", ");
      const extra = active && u.side !== side ? `, ${unitGap(active.tokens, u.tokens).toFixed(1)}" from ${active.name} (range ${rangeOf(unitGap(active.tokens, u.tokens))})` : "";
      return `- ${u.name} at ${fmt(center(u.lead))} [${tags}]${extra}`;
    };
    lines.push("Your units:", ...unitsOf(s, side).map(unitLine));
    lines.push("Enemy units:", ...unitsOf(s, foe).map(unitLine));
    const pois = objectives(s);
    if (pois.length) {
      lines.push("Objectives:", ...pois.map((p, i) => {
        const c = contest(s, p);
        return `- ${p.label} ${i + 1} at ${fmt(center(p))}: contested by ${c[side]} of yours, ${c[foe]} enemy`;
      }));
    }
    if (s.terrain.length) {
      lines.push(`Terrain: ${s.terrain.slice(0, 20).map((tr) => `${tr.label || tr.kind} at ${fmt(terrainCenter(tr))}`).join("; ")}.`);
    }
    if (active?.unit) {
      const u = active.unit;
      lines.push(`Active unit ${active.name}: speed ${u.speed ?? 2} (moves up to ${((u.speed ?? 2) * SEGMENT).toFixed(1)}"), ${u.defense} defense, courage ${u.courage ?? "-"}, weapons: ` +
        weaponsOf(u).map((w) => `${w.name} range ${w.min_range}-${w.max_range ?? "∞"}`).join("; ") + ".");
    }
    return lines.join("\n");
  }
}
