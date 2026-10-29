// Order token pools docked under the command hands: one row per side.
// Shuffle, draw the top token, then give it to a unit of the same rank.

import { RANK_LABEL, RANK_ORDER } from "../lib/factions";
import {
  assignDrawn, canDraw, discardDrawn, drawToken, eligibleEntries, entryTokens, inPool,
  poolsOf, prioritySide, returnDrawn, setPool, shufflePool, whoDraws, type Side,
} from "../lib/orderPool";
import type { TabletopState } from "../lib/tabletop";
import type { Rank } from "../lib/types";

const SIDE_NAME: Record<Side, string> = { blue: "Blue", red: "Red" };

/** An order token face up: the rank's icon on a round token. */
function RankToken({ rank, big, count, down }: { rank: Rank; big?: boolean; count?: number; down?: boolean }) {
  return (
    <span className={"tt-otok" + (big ? " tt-otok-big" : "") + (down ? " tt-otok-down" : "")}
      title={count ? `${count} ${RANK_LABEL[rank]}` : RANK_LABEL[rank]}>
      <img src={`/tokens/rank-${rank}.png`} alt={RANK_LABEL[rank]} />
      {count != null && count > 1 && <sub>{count}</sub>}
    </span>
  );
}

export function OrderPools(props: {
  state: TabletopState;
  onCommit: (s: TabletopState) => void;
  /** Whether this client may handle a side's pool (its own seat online). */
  canControl: (side: Side) => boolean;
  /** Units in the list loaded on this device, for "Use my list". */
  myList: { name: string; count: number } | null;
  onUseMyList: (side: Side) => void;
}) {
  const o = poolsOf(props.state);
  const w = whoDraws(props.state);
  const first = prioritySide(props.state);
  let hint: string;
  if (!o.blue && !o.red) hint = "Each player loads their list, then takes one order token per unit.";
  else if (w === null) hint = "Every token has been drawn. End the round to put them all back.";
  else if (w === "either") hint = "Pick command cards: the player with priority draws first.";
  else {
    const other = o[w === "blue" ? "red" : "blue"];
    const outOf = other && inPool(other).length === 0 && !other.drawn;
    hint = outOf
      ? `${SIDE_NAME[w === "blue" ? "red" : "blue"]} is out of tokens, so ${SIDE_NAME[w]} keeps drawing.`
      : `${SIDE_NAME[w]} to draw${!o.turn && first === w ? " first (priority)" : ""}.`;
  }
  return (
    <div className="tt-orders">
      <div className="tt-orders-head">
        <span className="tt-hand-label">Order tokens</span>
        <span className="muted small">{hint}</span>
      </div>
      {(["blue", "red"] as const).map((side) => (
        <PoolRow key={side} side={side} {...props} turn={w === side || w === "either"} />
      ))}
    </div>
  );
}

function PoolRow({ side, state, onCommit, canControl, myList, onUseMyList, turn }: {
  side: Side; turn: boolean;
} & Parameters<typeof OrderPools>[0]) {
  const o = poolsOf(state);
  const p = o[side];
  const mine = canControl(side);
  if (!p) {
    return (
      <div className={"tt-pool tt-hand-" + side}>
        <span className="tt-pool-side">{SIDE_NAME[side]}</span>
        {mine && myList ? (
          <button className="small" onClick={() => onUseMyList(side)}
            title="One order token per unit in the list, by rank">
            Take tokens for {myList.name} ({myList.count})
          </button>
        ) : (
          <span className="muted small">{mine ? "Load a list in Setup ▸ Your army first." : "Waiting for this player's list."}</span>
        )}
      </div>
    );
  }
  const down = inPool(p);
  const drawn = p.tokens.find((t) => t.id === p.drawn);
  const used = p.tokens.filter((t) => t.used);
  const out = p.tokens.filter((t) => t.out);
  const byRank = RANK_ORDER.map((r) => [r, down.filter((t) => t.rank === r).length] as const).filter(([, n]) => n > 0);
  const targets = drawn ? eligibleEntries(state, side) : [];
  return (
    <div className={"tt-pool tt-hand-" + side + (turn && down.length ? " tt-pool-turn" : "")}>
      <span className="tt-pool-side">{SIDE_NAME[side]}</span>
      <button className="tt-pool-stack" disabled={!mine || !canDraw(state, side)}
        onClick={() => onCommit(drawToken(state, side))}
        title={down.length ? "Draw a token at random" : "Pool is empty"}>
        <img className="tt-pool-back" src="/tokens/order.png" alt="" aria-hidden />
        Draw <b>{down.length}</b>
      </button>
      <button className="ghost-btn small" disabled={!mine || down.length < 2}
        onClick={() => onCommit(shufflePool(state, side))} title="Shuffle the face-down tokens">⤨ Shuffle</button>
      <span className="tt-pool-left" title="Face-down tokens left in the pool, by rank">
        {byRank.length ? byRank.map(([r, n]) => (
          <RankToken key={r} rank={r} count={n} down />
        )) : <span className="muted small">pool empty</span>}
      </span>

      {drawn && (
        <div className="tt-pool-drawn">
          <RankToken rank={drawn.rank} big />
          <span className="small">Drew <b>{RANK_LABEL[drawn.rank]}</b>{mine ? " — give it to:" : ", choosing a unit…"}</span>
          {mine && targets.map((t) => {
            const onBoard = entryTokens(state, t.entryId).length > 0;
            return (
              <button key={t.entryId} className="small tt-pool-target" onClick={() => onCommit(assignDrawn(state, side, t.entryId))}
                title={onBoard ? "Give this unit the order token" : "This unit isn't on the table yet"}>
                {t.unitName}{!onBoard && <span className="muted"> (not deployed)</span>}
              </button>
            );
          })}
          {mine && targets.length === 0 && (
            <button className="small" onClick={() => onCommit(discardDrawn(state, side))}
              title="No unit of this rank can take it (defeated): take the token out of the game">
              No {RANK_LABEL[drawn.rank]} unit left — remove token
            </button>
          )}
          {mine && <button className="ghost-btn small" onClick={() => onCommit(returnDrawn(state, side))}>Put back</button>}
        </div>
      )}

      {(used.length > 0 || out.length > 0) && (
        <div className="tt-pool-used">
          {used.map((t) => (
            <span key={t.id} className="tt-pool-chip" title={`${RANK_LABEL[t.rank]} order this round`}>
              <RankToken rank={t.rank} />
              {p.tokens.find((x) => x.entryId === t.assignedTo)?.unitName ?? "unit"}
            </span>
          ))}
          {out.map((t) => (
            <span key={t.id} className="tt-pool-chip out" title="Out of the game">
              <RankToken rank={t.rank} />out
            </span>
          ))}
        </div>
      )}

      {mine && (
        <span className="tt-pool-tools">
          {myList && (
            <button className="ghost-btn small" title="Rebuild this pool from the list loaded on this device"
              onClick={() => { if (confirm(`Replace ${SIDE_NAME[side]}'s order tokens with one per unit in ${myList.name}?`)) onUseMyList(side); }}>↻</button>
          )}
          <button className="ghost-btn small" title="Remove this side's order tokens"
            onClick={() => onCommit(setPool(state, side, null))}>✕</button>
        </span>
      )}
    </div>
  );
}
