import { useState } from "react";
import { emptySpellSlots, type DndCharacter, type SpellSlot } from "./dndTypes";

// Fast in-play edits (HP, slots, death saves, coin, loot) shown above the
// read-only sheet in the tabletop drawer — no need to open the full editor
// to note damage or a spent slot.
export function CharacterQuickBar({ c, onChange, disabled }: {
  c: DndCharacter;
  onChange: (c: DndCharacter) => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const slots = c.spellSlots ?? emptySpellSlots();

  function damage() {
    if (!n) return;
    const fromTemp = Math.min(c.hpTemp, n);
    onChange({ ...c, hpTemp: c.hpTemp - fromTemp, hpCurrent: Math.max(0, c.hpCurrent - (n - fromTemp)) });
    setAmount("");
  }
  function heal() {
    if (!n) return;
    const cap = c.hpMax > 0 ? c.hpMax : Infinity;
    const hpCurrent = Math.min(cap, c.hpCurrent + n);
    // Regaining any HP from 0 resets death saves (5e).
    const revived = c.hpCurrent === 0 && hpCurrent > 0;
    onChange({ ...c, hpCurrent, ...(revived ? { deathSuccesses: 0, deathFailures: 0 } : {}) });
    setAmount("");
  }
  function setSlots(next: SpellSlot[]) { onChange({ ...c, spellSlots: next }); }
  function clickSlot(level: number, i: number) {
    const s = slots[level]!;
    const used = i < s.used ? i : i + 1;
    setSlots(slots.map((x, j) => (j === level ? { ...x, used } : x)));
  }
  function longRest() {
    if (!confirm("Long rest: restore HP, clear temp HP, recover all spell slots and reset death saves?")) return;
    onChange({
      ...c,
      hpCurrent: c.hpMax || c.hpCurrent,
      hpTemp: 0,
      deathSuccesses: 0,
      deathFailures: 0,
      spellSlots: slots.map((s) => ({ ...s, used: 0 })),
    });
  }

  const hpFrac = c.hpMax > 0 ? Math.max(0, Math.min(1, c.hpCurrent / c.hpMax)) : null;
  const hasSlots = slots.some((s) => s.total > 0);

  return (
    <fieldset className="dnd-quick-bar" disabled={disabled}>
      <div className="dnd-qb-hp">
        <div className="dnd-qb-hp-read">
          <span className="dnd-qb-label">HP</span>
          <b>{c.hpCurrent}</b>
          <span className="muted">/ {c.hpMax || "—"}</span>
          {c.hpTemp > 0 && <span className="dnd-qb-temp">+{c.hpTemp} temp</span>}
        </div>
        {hpFrac != null && (
          <div className="dnd-qb-hpbar">
            <div style={{ width: `${hpFrac * 100}%`, background: hpFrac > 0.5 ? "var(--ok)" : hpFrac > 0.25 ? "var(--accent)" : "var(--danger)" }} />
          </div>
        )}
        <div className="dnd-qb-hp-ctrl">
          <input type="number" min={0} inputMode="numeric" placeholder="Amount" value={amount}
                 onChange={(e) => setAmount(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") damage(); }} />
          <button className="danger" onClick={damage} disabled={!n}>Damage</button>
          <button onClick={heal} disabled={!n}>Heal</button>
          <label className="dnd-qb-mini">Temp
            <input type="number" min={0} value={c.hpTemp}
                   onChange={(e) => onChange({ ...c, hpTemp: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
      </div>

      {c.hpCurrent === 0 && (
        <div className="dnd-qb-row">
          <span className="dnd-qb-label">Death saves</span>
          <Pips count={c.deathSuccesses} tone="ok" label="Success" onChange={(v) => onChange({ ...c, deathSuccesses: v })} />
          <Pips count={c.deathFailures} tone="bad" label="Failure" onChange={(v) => onChange({ ...c, deathFailures: v })} />
        </div>
      )}

      {hasSlots && (
        <div className="dnd-qb-slots">
          <span className="dnd-qb-label">Spell slots</span>
          {slots.map((s, level) => s.total > 0 && (
            <div key={level} className="dnd-qb-slot">
              <span className="muted small">{["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"][level]}</span>
              <div className="dnd-qb-slot-pips">
                {Array.from({ length: s.total }, (_, i) => (
                  <button key={i} type="button"
                          className={"dnd-qb-slot-pip" + (i < s.used ? " spent" : "")}
                          title={i < s.used ? "Spent — click to recover" : "Available — click to spend"}
                          onClick={() => clickSlot(level, i)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dnd-qb-row">
        <label className="dnd-check">
          <input type="checkbox" checked={c.inspiration} onChange={(e) => onChange({ ...c, inspiration: e.target.checked })} />
          Inspiration
        </label>
        <button className="ghost-btn small" onClick={longRest}>Long rest</button>
      </div>

      <div className="dnd-coin">
        {(["cp", "sp", "ep", "gp", "pp"] as const).map((k) => (
          <label key={k} className="dnd-mini-field">{k.toUpperCase()}
            <input value={c[k]} onChange={(e) => onChange({ ...c, [k]: e.target.value })} />
          </label>
        ))}
      </div>

      <label className="dnd-field dnd-textarea">
        <span>Equipment &amp; loot</span>
        <textarea rows={4} value={c.equipment} onChange={(e) => onChange({ ...c, equipment: e.target.value })} />
      </label>
    </fieldset>
  );
}

function Pips({ count, tone, label, onChange }: {
  count: number; tone: "ok" | "bad"; label: string; onChange: (n: number) => void;
}) {
  return (
    <div className={"dnd-death-pips " + tone} title={label + "es"}>
      {[1, 2, 3].map((i) => (
        <button key={i} type="button" className={"dnd-pip" + (count >= i ? " filled" : "")}
                onClick={() => onChange(count === i ? i - 1 : i)} aria-label={`${label} ${i}`} />
      ))}
    </div>
  );
}
