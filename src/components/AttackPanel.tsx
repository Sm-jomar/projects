import { useState } from "react";
import {
  aimRerollStep, attackTurn, attackUnits, boardUnits, closeAttack, declareAttack, defaultWeapons, defenseDice,
  maxDodge, minisInReach, rerollable, rollAttackStep, rollDefenseStep, setDodgeStep, stageLabel, toDefenseStep,
  weaponsOf, type AttackSeq, type WeaponPick,
} from "../lib/attack";
import { FACE_GLYPH } from "../lib/dice";
import { keyword, rangeOf } from "../lib/ai/legionCombat";
import { unitGap } from "../lib/ai/legionGeometry";
import type { Side } from "../lib/orderPool";
import type { TabletopState } from "../lib/tabletop";
import type { Weapon } from "../lib/types";

/** Picking a target for an attack, before it's declared. */
export type AttackDraft = { attackerKey: string; defenderKey: string | null; weapons: WeaponPick[] | null };

type Props = {
  state: TabletopState;
  draft: AttackDraft | null;
  onDraft: (d: AttackDraft | null) => void;
  /** Make a change to the board (with undo). */
  onCommit: (next: TabletopState) => void;
  /** Whether this player may take a step for that side, and if not who is. */
  canAct: (side: Side) => boolean;
  waitingOn: (side: Side) => string;
  byName: string;
  onReplay: () => void;
};

function diceText(w: Weapon): string {
  return ([["red", "R"], ["black", "B"], ["white", "W"]] as const).map(([c, l]) => w.dice[c] ? `${w.dice[c]}${l}` : "").filter(Boolean).join(" ");
}
function rangeText(w: Weapon): string {
  if (w.max_range === 0) return "melee";
  return w.max_range == null ? `range ${w.min_range}+` : w.min_range === w.max_range ? `range ${w.min_range}` : `range ${w.min_range}–${w.max_range}`;
}
function kwText(w: Weapon): string {
  const k = w.keywords;
  if (!k) return "";
  return Array.isArray(k) ? k.join(", ") : Object.entries(k).map(([n, v]) => (v === 1 || v === "" ? n : `${n} ${v}`)).join(", ");
}

export function AttackPanel({ state, draft, onDraft, onCommit, canAct, waitingOn, byName, onReplay }: Props) {
  const a = state.attack;
  if (a && (a.stage !== "done" || !draft)) {
    return <Sequence a={a} {...{ state, onCommit, canAct, waitingOn, onReplay }} onNew={() => onCommit(closeAttack(state))} />;
  }
  if (!draft) return null;
  return <Declare {...{ state, draft, onDraft, onCommit, byName }} />;
}

function Declare({ state, draft, onDraft, onCommit, byName }: Pick<Props, "state" | "onDraft" | "onCommit" | "byName"> & { draft: AttackDraft }) {
  const units = boardUnits(state);
  const att = units.find((u) => u.key === draft.attackerKey);
  if (!att) return null;
  const foes = units.filter((u) => u.side !== att.side)
    .map((u) => ({ u, gap: unitGap(att.tokens, u.tokens) }))
    .sort((x, y) => x.gap - y.gap);
  const def = foes.find((f) => f.u.key === draft.defenderKey)?.u;
  const weapons = weaponsOf(att.unit);
  const picks = def ? (draft.weapons ?? defaultWeapons(state, att, def)) : [];
  const total = picks.reduce((n, p) => n + p.minis, 0);
  const setMinis = (w: Weapon, n: number) => {
    const rest = picks.filter((p) => p.name !== w.name);
    const used = rest.reduce((m, p) => m + p.minis, 0);
    const cap = Math.min(minisInReach(w, att.tokens, def!.tokens), att.tokens.length - used);
    const v = Math.max(0, Math.min(cap, n));
    onDraft({ ...draft, weapons: [...rest, ...(v ? [{ name: w.name, minis: v }] : [])] });
  };

  return (
    <div className="tt-attack" role="dialog" aria-label="Declare an attack">
      <div className="tt-attack-head">
        <b>⚔ {att.name} attacks</b>
        <button className="ghost-btn small" onClick={() => onDraft(null)} aria-label="Cancel the attack">×</button>
      </div>
      <label className="tt-attack-row">
        Target
        <select value={def?.key ?? ""} onChange={(e) => onDraft({ ...draft, defenderKey: e.target.value || null, weapons: null })}>
          <option value="">Click an enemy unit, or pick…</option>
          {foes.map(({ u, gap }) => (
            <option key={u.key} value={u.key}>{u.name} · {gap.toFixed(1)}" (range {rangeOf(gap)})</option>
          ))}
        </select>
      </label>
      {!def && <p className="muted small">Click an enemy unit on the board to target it.</p>}
      {def && (
        <>
          <div className="tt-attack-weapons">
            {weapons.length === 0 && <p className="muted small">This unit has no weapons listed.</p>}
            {weapons.map((w) => {
              const reach = minisInReach(w, att.tokens, def.tokens);
              const n = picks.find((p) => p.name === w.name)?.minis ?? 0;
              return (
                <div key={w.name} className={"tt-attack-weapon" + (reach ? "" : " out")}>
                  <div>
                    <b>{w.name}</b> <span className="small">{diceText(w)} · {rangeText(w)}</span>
                    {kwText(w) && <div className="muted small">{kwText(w)}</div>}
                    {!reach && <div className="muted small">Out of range</div>}
                  </div>
                  {reach > 0 && (
                    <div className="dice-stepper-controls" title="Minis firing this weapon">
                      <button onClick={() => setMinis(w, n - 1)} aria-label={`Fewer minis fire ${w.name}`}>−</button>
                      <span className="dice-stepper-value">{n}</span>
                      <button onClick={() => setMinis(w, n + 1)} aria-label={`More minis fire ${w.name}`}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">Each mini fires one weapon ({total} of {att.tokens.length} firing).</p>
          <button className="dice-roll-btn" disabled={total === 0}
                  onClick={() => { onDraft(null); onCommit(declareAttack(state, att, def, picks, byName)); }}>
            Declare attack on {def.name}
          </button>
        </>
      )}
    </div>
  );
}

function Sequence({ a, state, onCommit, canAct, waitingOn, onReplay, onNew }: Pick<Props, "state" | "onCommit" | "canAct" | "waitingOn" | "onReplay"> & { a: AttackSeq; onNew: () => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const turn = attackTurn(a);
  const mine = turn ? canAct(turn) : true;
  const { att } = attackUnits(state, a);
  const aimDice = a.dice.map((d, i) => (rerollable(a, d, state) ? i : -1)).filter((i) => i >= 0);
  const togglePick = (i: number) => {
    if (a.stage !== "rolled" || a.aimLeft <= 0 || !mine) return;
    setPicked((p) => p.includes(i) ? p.filter((x) => x !== i) : p.length < a.rerollsPerAim ? [...p, i] : p);
  };
  const dodgeMax = maxDodge(a);
  const defCount = defenseDice(a);
  const precise = keyword(att?.unit?.keywords, "Precise");

  return (
    <div className="tt-attack" role="region" aria-label="Attack">
      <div className="tt-attack-head">
        <b className={`tt-attack-side ${a.attacker.side}`}>{a.attacker.name}</b>
        <span className="muted">{a.melee ? "⚔" : "➶"}</span>
        <b className={`tt-attack-side ${a.defender.side}`}>{a.defender.name}</b>
        {a.stage === "done" && <button className="ghost-btn small" onClick={onNew} aria-label="Close">×</button>}
      </div>
      <div className="small muted">
        {a.weapons.map((w) => `${w.name} ×${w.minis}`).join(" · ")}
        {a.by ? ` · declared by ${a.by}` : ""}
      </div>

      {a.dice.length > 0 && (
        <div className="tt-attack-dice" aria-label="Attack dice">
          {a.dice.map((d, i) => (
            <button key={i} type="button"
              className={`die die-${d.color} die-face-${d.face}` + (picked.includes(i) ? " picked" : "") + (d.rerolled ? " rerolled" : "")}
              title={`${d.color} ${d.face}${d.surged ? " (from a surge)" : ""}${d.rerolled ? " (rerolled)" : ""}`}
              onClick={() => togglePick(i)}>
              {FACE_GLYPH[d.face]}{d.surged && <sup>⌖</sup>}
            </button>
          ))}
        </div>
      )}

      {a.stage === "defend" || a.stage === "done" ? (
        <div className="tt-attack-tally small">
          <span className="dice-tag crit">✸ {a.crits}</span>
          <span className="dice-tag hit">✷ {a.hits + a.coverCancel + a.armorCancel}</span>
          {a.armorCancel > 0 && <span className="dice-tag blank">armor −{a.armorCancel}</span>}
          {a.coverCancel > 0 && <span className="dice-tag blank">{a.cover === 2 ? "heavy" : "light"} cover −{a.coverCancel}</span>}
          {a.dodgeSpent > 0 && <span className="dice-tag blank">dodge −{a.dodgeSpent}</span>}
          <span className="dice-tag blank">miss {a.dice.filter((d) => d.face === "blank" || d.face === "surge").length}</span>
        </div>
      ) : null}

      {a.defense.length > 0 && (
        <div className="tt-attack-dice" aria-label="Defense dice">
          {a.defense.map((d, i) => (
            <span key={i} className={`die die-${d.color} die-face-${d.face}`} title={`${d.color} ${d.face}`}>
              {FACE_GLYPH[d.face]}{d.surged && <sup>⌖</sup>}
            </span>
          ))}
        </div>
      )}

      {a.stage === "done" ? (
        <div className="tt-attack-result">
          <div className="tt-attack-big">
            {a.wounds ? <><b className="hit">{a.wounds}</b> wound{a.wounds === 1 ? "" : "s"}</> : <b>No wounds</b>}
            {a.blocks > 0 && <> · {a.blocks} blocked</>}
            {a.pierce > 0 && <> · pierce {a.pierce}</>}
            {a.defeated > 0 && <> · {a.wiped ? "unit defeated!" : `${a.defeated} down`}</>}
          </div>
          <div className="tt-attack-actions">
            <button className="ghost-btn small" onClick={onReplay}>▶ Replay effects</button>
            <button className="ghost-btn small" onClick={onNew}>Done</button>
          </div>
        </div>
      ) : (
        <>
          <div className={"tt-attack-turn small" + (mine ? " mine" : "")}>
            {mine ? stageLabel(a) : `Waiting for ${waitingOn(turn!)}…`}
          </div>
          {mine && a.stage === "declared" && (
            <button className="dice-roll-btn" onClick={() => onCommit(rollAttackStep(state))}>
              🎲 Roll {a.dice.length || Object.values(a.pool).reduce((n, v) => n + (v ?? 0), 0)} attack dice
            </button>
          )}
          {mine && a.stage === "rolled" && (
            <div className="tt-attack-actions">
              {a.aimLeft > 0 && aimDice.length > 0 && (
                <button className="dice-roll-btn" onClick={() => { onCommit(aimRerollStep(state, picked.length ? picked : undefined)); setPicked([]); }}
                        title={`Each aim token rerolls up to ${a.rerollsPerAim} dice${precise ? ` (Precise ${precise})` : ""}. Click dice to choose, or let it pick blanks.`}>
                  🎯 Aim: reroll {picked.length || Math.min(a.rerollsPerAim, aimDice.length)} ({a.aimLeft} left)
                </button>
              )}
              <button className={a.aimLeft > 0 && aimDice.length > 0 ? "ghost-btn" : "dice-roll-btn"} onClick={() => onCommit(toDefenseStep(state))}>
                Convert surges, check cover ▸
              </button>
            </div>
          )}
          {a.stage === "rolled" && a.aimLeft > 0 && mine && <p className="muted small">Click dice to pick which to reroll.</p>}
          {mine && a.stage === "defend" && (
            <>
              {a.noDodge ? <p className="muted small">{a.noDodge}.</p> : a.dodgeAvail > 0 && a.hits > 0 && (
                <div className="tt-attack-row small">
                  Dodge tokens to spend ({a.dodgeAvail} held, cancels a hit each)
                  <div className="dice-stepper-controls">
                    <button onClick={() => onCommit(setDodgeStep(state, a.dodgeSpent - 1))} aria-label="Spend fewer dodge tokens">−</button>
                    <span className="dice-stepper-value">{a.dodgeSpent}</span>
                    <button onClick={() => onCommit(setDodgeStep(state, a.dodgeSpent + 1))} disabled={a.dodgeSpent >= dodgeMax} aria-label="Spend another dodge token">+</button>
                  </div>
                </div>
              )}
              <button className="dice-roll-btn" onClick={() => onCommit(rollDefenseStep(state))}>
                🛡 {defCount ? `Roll ${defCount} defense ${defCount === 1 ? "die" : "dice"}` : "Nothing got through: resolve"}
              </button>
            </>
          )}
        </>
      )}

      <ul className="tt-attack-notes small muted">
        {a.notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
  );
}
