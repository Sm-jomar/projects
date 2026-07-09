import { useState } from "react";
import { useDndRoom, type RollPayload } from "./dndRoom";
import { RollFeed } from "./RollFeed";

// Standard D&D polyhedral set (d100 = percentile). d12 included since it's
// part of a normal dice set.
const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Sides = (typeof DICE)[number];

// Fair single-die roll using the crypto RNG.
function rollDie(sides: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0]! % sides) + 1;
}

function poolLabel(pool: Record<number, number>, modifier: number): string {
  const parts = DICE.filter((s) => (pool[s] ?? 0) > 0).map((s) => `${pool[s]}d${s}`);
  let label = parts.join(" + ") || "—";
  if (modifier) label += ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}`;
  return label;
}

export function DiceRoller() {
  const room = useDndRoom();
  const [pool, setPool] = useState<Record<number, number>>({});
  const [modifier, setModifier] = useState(0);

  const poolCount = DICE.reduce((n, s) => n + (pool[s] ?? 0), 0);
  const connected = room.online?.status === "open";

  function addDie(s: Sides) { setPool((p) => ({ ...p, [s]: (p[s] ?? 0) + 1 })); }
  function removeDie(s: Sides) { setPool((p) => ({ ...p, [s]: Math.max(0, (p[s] ?? 0) - 1) })); }
  function clearPool() { setPool({}); setModifier(0); }

  // All rolls flow through the room context: added to the shared feed and
  // broadcast to the other players when connected.
  function roll(payload: RollPayload) { room.sendRoll(payload); }

  function rollPool() {
    if (poolCount === 0) return;
    const rolls: { sides: number; value: number }[] = [];
    for (const s of DICE) for (let i = 0; i < (pool[s] ?? 0); i++) rolls.push({ sides: s, value: rollDie(s) });
    const sum = rolls.reduce((a, r) => a + r.value, 0);
    let note: string | undefined;
    if (rolls.length === 1 && rolls[0]!.sides === 20) {
      if (rolls[0]!.value === 20) note = "Natural 20!";
      else if (rolls[0]!.value === 1) note = "Natural 1…";
    }
    roll({ label: poolLabel(pool, modifier), rolls, modifier, total: sum + modifier, note });
  }

  function rollD20(mode: "normal" | "adv" | "dis") {
    const modLabel = modifier ? ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}` : "";
    if (mode === "normal") {
      const v = rollDie(20);
      const note = v === 20 ? "Natural 20!" : v === 1 ? "Natural 1…" : undefined;
      roll({ label: `d20${modLabel}`, rolls: [{ sides: 20, value: v }], modifier, total: v + modifier, note });
      return;
    }
    const a = rollDie(20), b = rollDie(20);
    const chosen = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
    const note = `${mode === "adv" ? "Advantage" : "Disadvantage"} — rolled ${a} & ${b}`
      + (chosen === 20 ? " · Natural 20!" : chosen === 1 ? " · Natural 1…" : "");
    roll({ label: `d20 (${mode === "adv" ? "adv" : "dis"})${modLabel}`, rolls: [{ sides: 20, value: chosen }], modifier, total: chosen + modifier, note });
  }

  function flipCoin() {
    roll({ label: "Coin flip", rolls: [], modifier: 0, total: 0, note: rollDie(2) === 1 ? "Heads" : "Tails" });
  }

  return (
    <div className="dnd-section dnd-dice">
      <div className="dnd-section-head">
        <h2>Dice</h2>
        <span className="muted small dnd-dice-share">
          {connected ? `Shared with ${room.online!.peers.length} player${room.online!.peers.length === 1 ? "" : "s"}` : "Solo — join a game to share rolls"}
        </span>
        {room.rollFeed.length > 0 && <button className="ghost-btn small" onClick={room.clearRolls}>Clear feed</button>}
      </div>

      <div className="dnd-dice-body">
        <div className="dnd-dice-left">
          <section>
            <h3>Build a roll — tap to add</h3>
            <div className="dnd-dice-grid">
              {DICE.map((s) => (
                <button key={s} className="dnd-die-btn" onClick={() => addDie(s)}
                        onContextMenu={(e) => { e.preventDefault(); removeDie(s); }}
                        title="Click to add · right-click to remove">
                  <span className="dnd-die-label">d{s}</span>
                  {(pool[s] ?? 0) > 0 && <span className="dnd-die-count">{pool[s]}</span>}
                </button>
              ))}
            </div>
            <div className="dnd-dice-controls">
              <div className="dnd-mod">
                <span>Modifier</span>
                <button onClick={() => setModifier((m) => m - 1)}>−</button>
                <b>{modifier >= 0 ? `+${modifier}` : modifier}</b>
                <button onClick={() => setModifier((m) => m + 1)}>+</button>
              </div>
              <div className="dnd-dice-expr">{poolLabel(pool, modifier)}</div>
            </div>
            <div className="dnd-dice-actions">
              <button className="dnd-primary" disabled={poolCount === 0} onClick={rollPool}>
                Roll{poolCount > 0 ? ` ${poolCount} di${poolCount === 1 ? "e" : "ce"}` : ""}
              </button>
              <button className="ghost-btn" onClick={clearPool} disabled={poolCount === 0 && modifier === 0}>Clear</button>
            </div>
          </section>

          <section>
            <h3>Quick rolls</h3>
            <div className="dnd-quick">
              <button onClick={() => rollD20("normal")}>d20</button>
              <button onClick={() => rollD20("adv")}>d20 Advantage</button>
              <button onClick={() => rollD20("dis")}>d20 Disadvantage</button>
              <button onClick={flipCoin}>Coin flip</button>
            </div>
          </section>

          <StrawPicker onResult={(note) => roll({ label: "Short straw", rolls: [], modifier: 0, total: 0, note })} />
        </div>

        <div className="dnd-dice-right">
          <h3>Roll feed</h3>
          <RollFeed feed={room.rollFeed} emptyText="Rolls appear here — and are shared with everyone in your game." />
        </div>
      </div>
    </div>
  );
}

// --- Short straw picker ----------------------------------------------------

function StrawPicker({ onResult }: { onResult: (note: string) => void }) {
  const [names, setNames] = useState("");
  const [count, setCount] = useState(4);

  function draw() {
    const list = names.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const pool = list.length >= 2 ? list : Array.from({ length: Math.max(2, count) }, (_, i) => `Player ${i + 1}`);
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const loser = pool[a[0]! % pool.length]!;
    onResult(`${loser} drew the short straw`);
  }

  return (
    <section>
      <h3>Short straw</h3>
      <p className="muted small">Enter names (comma or newline separated), or just pick a headcount. One is chosen at random.</p>
      <textarea className="dnd-straw-names" rows={2} value={names}
                placeholder="Alice, Bob, Carol…"
                onChange={(e) => setNames(e.target.value)} />
      <div className="dnd-straw-row">
        <label className="dnd-tt-field">Or headcount
          <input type="number" min={2} max={30} value={count} onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))} />
        </label>
        <button className="dnd-primary" onClick={draw}>Draw straws</button>
      </div>
    </section>
  );
}
