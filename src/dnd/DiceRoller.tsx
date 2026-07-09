import { useState } from "react";

// Standard D&D polyhedral set (d100 = percentile). d12 included since it's
// part of a normal dice set.
const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Sides = (typeof DICE)[number];

type DieRoll = { sides: number; value: number };
type RollResult = {
  id: string;
  label: string;
  rolls: DieRoll[];
  modifier: number;
  total: number;
  note?: string;
};

// Fair single-die roll using the crypto RNG.
function rollDie(sides: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0]! % sides) + 1;
}

let rid = 0;
function newRid(): string { rid = (rid + 1) % 100000; return `r${Date.now().toString(36)}${rid}`; }

function poolLabel(pool: Record<number, number>, modifier: number): string {
  const parts = DICE.filter((s) => (pool[s] ?? 0) > 0).map((s) => `${pool[s]}d${s}`);
  let label = parts.join(" + ") || "—";
  if (modifier) label += ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}`;
  return label;
}

export function DiceRoller() {
  const [pool, setPool] = useState<Record<number, number>>({});
  const [modifier, setModifier] = useState(0);
  const [history, setHistory] = useState<RollResult[]>([]);

  const poolCount = DICE.reduce((n, s) => n + (pool[s] ?? 0), 0);

  function addDie(s: Sides) { setPool((p) => ({ ...p, [s]: (p[s] ?? 0) + 1 })); }
  function removeDie(s: Sides) { setPool((p) => ({ ...p, [s]: Math.max(0, (p[s] ?? 0) - 1) })); }
  function clearPool() { setPool({}); setModifier(0); }

  function push(r: RollResult) { setHistory((h) => [r, ...h].slice(0, 40)); }

  function rollPool() {
    if (poolCount === 0) return;
    const rolls: DieRoll[] = [];
    for (const s of DICE) for (let i = 0; i < (pool[s] ?? 0); i++) rolls.push({ sides: s, value: rollDie(s) });
    const sum = rolls.reduce((a, r) => a + r.value, 0);
    // Crit flavor only for a lone d20.
    let note: string | undefined;
    if (rolls.length === 1 && rolls[0]!.sides === 20) {
      if (rolls[0]!.value === 20) note = "Natural 20!";
      else if (rolls[0]!.value === 1) note = "Natural 1…";
    }
    push({ id: newRid(), label: poolLabel(pool, modifier), rolls, modifier, total: sum + modifier, note });
  }

  function rollD20(mode: "normal" | "adv" | "dis") {
    if (mode === "normal") {
      const v = rollDie(20);
      const note = v === 20 ? "Natural 20!" : v === 1 ? "Natural 1…" : undefined;
      push({ id: newRid(), label: `d20${modifier ? ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}` : ""}`, rolls: [{ sides: 20, value: v }], modifier, total: v + modifier, note });
      return;
    }
    const a = rollDie(20), b = rollDie(20);
    const chosen = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
    const note = `${mode === "adv" ? "Advantage" : "Disadvantage"} — rolled ${a} & ${b}` + (chosen === 20 ? " · Natural 20!" : chosen === 1 ? " · Natural 1…" : "");
    push({ id: newRid(), label: `d20 (${mode === "adv" ? "adv" : "dis"})${modifier ? ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}` : ""}`, rolls: [{ sides: 20, value: chosen }], modifier, total: chosen + modifier, note });
  }

  function flipCoin() {
    const heads = rollDie(2) === 1;
    push({ id: newRid(), label: "Coin flip", rolls: [], modifier: 0, total: 0, note: heads ? "Heads" : "Tails" });
  }

  return (
    <div className="dnd-section dnd-dice">
      <div className="dnd-section-head">
        <h2>Dice</h2>
        {history.length > 0 && <button className="ghost-btn small" onClick={() => setHistory([])}>Clear history</button>}
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

          <StrawPicker onResult={(note) => push({ id: newRid(), label: "Short straw", rolls: [], modifier: 0, total: 0, note })} />
        </div>

        <div className="dnd-dice-right">
          <h3>History</h3>
          {history.length === 0 ? (
            <p className="muted small">Rolls appear here.</p>
          ) : (
            <ul className="dnd-roll-log">
              {history.map((r) => (
                <li key={r.id} className="dnd-roll">
                  <div className="dnd-roll-top">
                    <span className="dnd-roll-label">{r.label}</span>
                    {r.rolls.length > 0 && (
                      <span className="dnd-roll-total">{r.total}</span>
                    )}
                  </div>
                  {r.rolls.length > 0 && (
                    <div className="dnd-roll-dice">
                      {r.rolls.map((d, i) => (
                        <span key={i} className={"dnd-roll-die" + (d.sides === 20 && d.value === 20 ? " crit" : d.sides === 20 && d.value === 1 ? " fumble" : "")}
                              title={`d${d.sides}`}>{d.value}</span>
                      ))}
                      {r.modifier !== 0 && <span className="dnd-roll-mod">{r.modifier >= 0 ? `+${r.modifier}` : r.modifier}</span>}
                    </div>
                  )}
                  {r.note && <div className={"dnd-roll-note" + (r.note.includes("Natural 20") ? " crit" : r.note.includes("Natural 1") ? " fumble" : "")}>{r.note}</div>}
                </li>
              ))}
            </ul>
          )}
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
