// Command card hands at the foot of the tabletop. Each player picks their
// hand at the start of the game from the cards their list can use, then
// every round selects one card from the fanned hand and locks it in face
// down. Which card stays on the player's own device until both sides have
// locked in; then each device reveals its own card and the fewer pips take
// priority (a roll-off breaks a tie).

import { useEffect, useState } from "react";
import { COMMAND_BY_ID, handComplete, type HandArmy } from "../lib/commandCards";
import { prioritySide, type Side } from "../lib/orderPool";
import {
  bothLocked, handFromCards, newCommandHand, type CommandCard, type CommandHand, type TabletopState,
} from "../lib/tabletop";
import { CommandPicker } from "./CommandHandPanel";
import { CardText } from "./UnitRules";

const SIDE_NAME: Record<Side, string> = { blue: "Blue", red: "Red" };
const SIDES: Side[] = ["blue", "red"];
const PICK_KEY = "legion-tabletop.pick";

type Pick = { round: number; index: number };
type Picks = Partial<Record<Side, Pick>>;

function loadPicks(): Picks {
  try { return JSON.parse(localStorage.getItem(PICK_KEY) ?? "{}") as Picks; } catch { return {}; }
}

const cardName = (c: CommandCard) => c.name ?? (c.pips === 4 ? "Standing Orders" : `${c.pips}-pip card`);
const pipDots = (n: number) => "●".repeat(n);

/** A command card face up. */
function CardFace({ card, small }: { card: CommandCard; small?: boolean }) {
  const def = card.id ? COMMAND_BY_ID.get(card.id) : undefined;
  return (
    <span className={"cmd-face" + (small ? " cmd-face-small" : "")}
      title={def ? `${def.name} (${def.pips} pip${def.pips === 1 ? "" : "s"})\nOrders: ${def.orders}\n\n${def.text}` : cardName(card)}>
      <span className="cmd-face-pips">{pipDots(card.pips)}</span>
      <span className="cmd-face-name">{cardName(card)}</span>
      {def && <span className="cmd-face-orders">{def.orders}</span>}
      {def?.text && !small && <span className="cmd-face-text">{def.text}</span>}
    </span>
  );
}

function CardBack({ small, label }: { small?: boolean; label?: string }) {
  return <span className={"cmd-face cmd-back" + (small ? " cmd-face-small" : "")}>{label}</span>;
}

export function CommandHands(props: {
  state: TabletopState;
  onCommit: (s: TabletopState) => void;
  /** Whether this device plays a side's hand (its own seat online). */
  canControl: (side: Side) => boolean;
  /** Online: the other side's cards are face down. */
  online: boolean;
  /** The list loaded on this device, to pick cards for. */
  myArmy: { army: HandArmy; name: string; saved: string[] } | null;
  onSaveCards: (ids: string[]) => void;
}) {
  const { state, onCommit, canControl } = props;
  const [picks, setPicks] = useState<Picks>(loadPicks);
  const [selected, setSelected] = useState<Partial<Record<Side, number>>>({});

  function savePicks(next: Picks) {
    setPicks(next);
    try { localStorage.setItem(PICK_KEY, JSON.stringify(next)); } catch { /* full or blocked */ }
  }

  // The card this device locked in for a side, if it's still good.
  const pickOf = (side: Side): number | null => {
    const p = picks[side];
    const hand = state.hands[side];
    if (!p || p.round !== state.round || !hand.locked) return null;
    const c = hand.cards[p.index];
    return c && !c.played ? p.index : null;
  };

  // Once both sides are locked in, reveal this device's own card(s).
  useEffect(() => {
    if (!bothLocked(state)) return;
    let hands = state.hands;
    for (const side of SIDES) {
      const i = pickOf(side);
      if (canControl(side) && hands[side].thisRound == null && i != null) {
        hands = { ...hands, [side]: { ...hands[side], thisRound: i } };
      }
    }
    if (hands !== state.hands) onCommit({ ...state, hands });
  });

  const setHand = (side: Side, hand: CommandHand) => onCommit({ ...state, hands: { ...state.hands, [side]: hand } });

  function lockIn(side: Side, index: number) {
    savePicks({ ...picks, [side]: { round: state.round, index } });
    setSelected({ ...selected, [side]: undefined });
    setHand(side, { ...state.hands[side], locked: true, thisRound: null });
  }

  function takeBack(side: Side) {
    const rest = { ...picks };
    delete rest[side];
    savePicks(rest);
    setHand(side, { ...state.hands[side], locked: false, thisRound: null });
  }

  /** Reveal straight from the hand (when this device lost its pick). */
  function reveal(side: Side, index: number) {
    setHand(side, { ...state.hands[side], locked: true, thisRound: index });
  }

  function rollOff() {
    let blue = 0, red = 0;
    while (blue === red) {
      blue = 1 + Math.floor(Math.random() * 6);
      red = 1 + Math.floor(Math.random() * 6);
    }
    onCommit({ ...state, priorityRoll: { blue, red } });
  }

  return (
    <div className="tt-hands tt-hands-fan">
      <HandFan side="blue" {...props} pick={pickOf("blue")} selected={selected.blue ?? null}
        onSelect={(i) => setSelected({ ...selected, blue: i ?? undefined })}
        onLock={lockIn} onTakeBack={takeBack} onReveal={reveal} onSetHand={setHand} />
      <RevealArea state={state} canRoll={SIDES.some(canControl)} onRollOff={rollOff}
        shown={(side) => !props.online || canControl(side)} pickOf={pickOf} />
      <HandFan side="red" {...props} pick={pickOf("red")} selected={selected.red ?? null}
        onSelect={(i) => setSelected({ ...selected, red: i ?? undefined })}
        onLock={lockIn} onTakeBack={takeBack} onReveal={reveal} onSetHand={setHand} />
    </div>
  );
}

function RevealArea({ state, canRoll, onRollOff, shown, pickOf }: {
  state: TabletopState;
  canRoll: boolean;
  onRollOff: () => void;
  shown: (side: Side) => boolean;
  pickOf: (side: Side) => number | null;
}) {
  const b = state.hands.blue, r = state.hands.red;
  const revealed = b.thisRound != null && r.thisRound != null;
  const first = prioritySide(state);
  let hint: string;
  if (revealed) {
    const bp = b.cards[b.thisRound!]?.pips, rp = r.cards[r.thisRound!]?.pips;
    if (bp === rp) {
      const roll = state.priorityRoll;
      hint = first && roll
        ? `Tied at ${bp} pips. Roll-off ${roll.blue}–${roll.red}: ${SIDE_NAME[first]} has priority.`
        : `Tied at ${bp} pips: roll off for priority.`;
    } else {
      hint = `${SIDE_NAME[first!]} has priority (${Math.min(bp!, rp!)} pip${Math.min(bp!, rp!) === 1 ? "" : "s"} vs ${Math.max(bp!, rp!)}).`;
    }
  } else if (b.locked && r.locked) hint = "Revealing…";
  else if (b.locked || r.locked) hint = `${SIDE_NAME[b.locked ? "blue" : "red"]} is locked in. Waiting for ${SIDE_NAME[b.locked ? "red" : "blue"]}.`;
  else hint = "Select a card and lock it in. Fewer pips takes priority.";

  const slot = (side: Side) => {
    const h = state.hands[side];
    if (h.thisRound != null && h.cards[h.thisRound]) return <CardFace card={h.cards[h.thisRound]!} small />;
    if (h.locked) {
      // Your own locked card shows through on your device.
      const i = shown(side) ? pickOf(side) : null;
      return i != null ? <span className="cmd-locked-own"><CardFace card={h.cards[i]!} small /></span> : <CardBack small label="Locked" />;
    }
    return <span className="cmd-slot-empty">choosing…</span>;
  };

  return (
    <div className="cmd-reveal">
      <div className="cmd-reveal-head">
        <span className="tt-hand-label">Round {state.round} · priority</span>
      </div>
      <div className="cmd-reveal-cards">
        <div className={"cmd-reveal-slot tt-hand-blue" + (revealed && first === "blue" ? " first" : "")}>
          <span className="tt-hand-label">Blue</span>{slot("blue")}
        </div>
        <span className="cmd-vs">vs</span>
        <div className={"cmd-reveal-slot tt-hand-red" + (revealed && first === "red" ? " first" : "")}>
          <span className="tt-hand-label">Red</span>{slot("red")}
        </div>
      </div>
      <div className="small cmd-reveal-hint">{hint}</div>
      {revealed && !first && canRoll && (
        <button className="small" onClick={onRollOff} title="Each side rolls a die; higher roll takes priority">🎲 Roll off</button>
      )}
    </div>
  );
}

function HandFan({ side, state, canControl, online, myArmy, onSaveCards, pick, selected, onSelect, onLock, onTakeBack, onReveal, onSetHand }: {
  side: Side;
  pick: number | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onLock: (side: Side, i: number) => void;
  onTakeBack: (side: Side) => void;
  onReveal: (side: Side, i: number) => void;
  onSetHand: (side: Side, hand: CommandHand) => void;
} & Parameters<typeof CommandHands>[0]) {
  const hand = state.hands[side];
  const other = state.hands[side === "blue" ? "red" : "blue"];
  const mine = canControl(side);
  const [hidden, setHidden] = useState(false);
  const [picking, setPicking] = useState<string[] | null>(null);
  const faceUp = mine && !hidden;
  const inHand = hand.cards.map((c, i) => ({ c, i })).filter(({ c, i }) => !c.played && i !== pick && i !== hand.thisRound);
  const played = hand.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.played);
  const picked = hand.cards.some((c) => c.id);
  // The hand can be picked until the first card is locked in or played.
  const atStart = !hand.locked && hand.thisRound == null && played.length === 0;
  const sel = selected != null && inHand.some(({ i }) => i === selected) ? selected : null;
  const selCard = sel != null ? hand.cards[sel] : undefined;
  const selDef = selCard?.id ? COMMAND_BY_ID.get(selCard.id) : undefined;
  const lostPick = hand.locked && bothLocked(state) && hand.thisRound == null && pick == null;

  function startPicking() {
    const fromHand = hand.cards.map((c) => c.id).filter((id): id is string => !!id && id !== "standing-orders");
    const start = handComplete(fromHand) ? fromHand : myArmy?.saved ?? [];
    setPicking(start);
  }

  function togglePlayed(i: number) {
    const cards = hand.cards.map((c, j) => (j === i ? { ...c, played: !c.played } : c));
    onSetHand(side, { ...hand, cards });
  }

  const n = inHand.length;
  return (
    <div className={"cmd-fan-wrap tt-hand-" + side}>
      <div className="cmd-fan-head">
        <span className="tt-hand-label">{SIDE_NAME[side]} hand</span>
        <span className="muted small cmd-fan-list">{hand.listName ?? (picked ? "" : "pip cards")}</span>
        <span className="muted small tt-hand-meta">{hand.cards.filter((c) => !c.played).length}/{hand.cards.length} left</span>
        {mine && (
          <span className="cmd-fan-tools">
            {atStart && myArmy && (
              <button className={picked ? "ghost-btn small" : "small"} onClick={startPicking}
                title={`Choose six command cards for ${myArmy.name}`}>
                {picked ? "Change cards" : "Pick command cards"}
              </button>
            )}
            {!online && (
              <button className="ghost-btn small" onClick={() => setHidden(!hidden)}
                title={hidden ? "Show this hand" : "Turn this hand face down (pass-and-play)"}>{hidden ? "Show" : "Hide"}</button>
            )}
            <button className="ghost-btn small" title="Put every card back in hand (keeps the picked cards)"
              onClick={() => {
                if (!confirm(`Put all of ${SIDE_NAME[side]}'s command cards back in hand?`)) return;
                onSetHand(side, { ...hand, cards: hand.cards.map((c) => ({ ...c, played: false })), thisRound: null, locked: false });
              }}>↻</button>
            {picked && atStart && (
              <button className="ghost-btn small" title="Go back to plain 1-4 pip cards"
                onClick={() => onSetHand(side, newCommandHand())}>✕</button>
            )}
          </span>
        )}
      </div>

      {mine && !picked && atStart && !myArmy && (
        <div className="muted small">Load a list in Setup ▸ Your army to pick the command cards it can use.</div>
      )}

      <div className="cmd-fan" style={{ ["--n" as string]: n }}>
        {inHand.map(({ c, i }, k) => {
          const off = k - (n - 1) / 2;
          const style = { ["--off" as string]: off, ["--abs" as string]: Math.abs(off) };
          if (!faceUp) return <span key={i} className="cmd-fan-card" style={style}><CardBack /></span>;
          const canSelect = mine && !hand.locked || lostPick;
          return (
            <button key={i} className={"cmd-fan-card" + (sel === i ? " selected" : "")} style={style}
              disabled={!canSelect} onClick={() => onSelect(sel === i ? null : i)}>
              <CardFace card={c} />
            </button>
          );
        })}
        {n === 0 && <span className="muted small">No cards in hand.</span>}
      </div>

      <div className="cmd-fan-foot small">
        {mine && faceUp && !hand.locked && (
          <>
            <button className="primary small" disabled={sel == null} onClick={() => sel != null && onLock(side, sel)}>
              {selCard ? `Lock in ${cardName(selCard)}` : "Select a card to lock in"}
            </button>
            {selDef?.text && <span className="cmd-fan-detail">Orders {selDef.orders}. <CardText text={selDef.text} weapon={selDef.weapon} /></span>}
          </>
        )}
        {mine && hand.locked && hand.thisRound == null && !lostPick && (
          <>
            <span>Locked in{pick != null ? `: ${cardName(hand.cards[pick]!)}` : ""}.</span>
            {!other.locked && <button className="ghost-btn small" onClick={() => onTakeBack(side)}>Take back</button>}
          </>
        )}
        {mine && lostPick && (
          <button className="primary small" disabled={sel == null} onClick={() => sel != null && onReveal(side, sel)}>
            {selCard ? `Reveal ${cardName(selCard)}` : "Select the card you locked in"}
          </button>
        )}
        {!mine && <span className="muted">{hand.thisRound != null ? "Revealed." : hand.locked ? "Locked in." : "Choosing a card…"}</span>}
        {played.length > 0 && (
          <span className="cmd-played">
            Played:{" "}
            {played.map(({ c, i }) => (
              <button key={i} className="tt-pool-chip" disabled={!mine} onClick={() => togglePlayed(i)}
                title={mine ? "Put back in hand" : ""}>{pipDots(c.pips)} {cardName(c)}</button>
            ))}
          </span>
        )}
      </div>

      {picking && myArmy && (
        <CommandPicker army={myArmy.army} cards={picking} onChange={setPicking}
          onClose={() => setPicking(null)} doneLabel={`Use this hand for ${SIDE_NAME[side]}`}
          onDone={() => {
            onSetHand(side, handFromCards(picking, myArmy.name));
            onSaveCards(picking);
            setPicking(null);
          }} />
      )}
    </div>
  );
}
