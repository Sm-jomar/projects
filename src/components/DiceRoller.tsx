import { useState } from "react";
import {
  rollAttack, rollDefense, tallyAttack, tallyDefense, FACE_GLYPH,
  type AttackPool, type DefensePool, type AttackSurge,
  type AttackDieRoll, type DefenseDieRoll,
} from "../lib/dice";

type Mode = "attack" | "defense";

type AttackEntry = {
  id: string;
  kind: "attack";
  pool: AttackPool;
  surge: AttackSurge;
  rolls: AttackDieRoll[];
  ts: number;
};
type DefenseEntry = {
  id: string;
  kind: "defense";
  pool: DefensePool;
  hasSurge: boolean;
  rolls: DefenseDieRoll[];
  ts: number;
};
type Entry = AttackEntry | DefenseEntry;

function NumStepper({ label, value, onChange, color }: { label: string; value: number; onChange: (n: number) => void; color?: string }) {
  return (
    <div className="dice-stepper">
      <span className="dice-stepper-label" style={color ? { color } : undefined}>{label}</span>
      <div className="dice-stepper-controls">
        <button onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Remove ${label}`}>−</button>
        <span className="dice-stepper-value">{value}</span>
        <button onClick={() => onChange(Math.min(20, value + 1))} aria-label={`Add ${label}`}>+</button>
      </div>
    </div>
  );
}

export function DiceRoller() {
  const [mode, setMode] = useState<Mode>("attack");
  const [atk, setAtk] = useState<AttackPool>({ red: 0, black: 0, white: 0 });
  const [surge, setSurge] = useState<AttackSurge>(null);
  const [def, setDef] = useState<DefensePool>({ red: 0, white: 0 });
  const [defSurge, setDefSurge] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);

  const atkCount = (atk.red ?? 0) + (atk.black ?? 0) + (atk.white ?? 0);
  const defCount = (def.red ?? 0) + (def.white ?? 0);

  function rollNow() {
    if (mode === "attack" && atkCount > 0) {
      const rolls = rollAttack(atk);
      const entry: AttackEntry = { id: crypto.randomUUID(), kind: "attack", pool: { ...atk }, surge, rolls, ts: Date.now() };
      setLog((l) => [entry, ...l].slice(0, 20));
    } else if (mode === "defense" && defCount > 0) {
      const rolls = rollDefense(def);
      const entry: DefenseEntry = { id: crypto.randomUUID(), kind: "defense", pool: { ...def }, hasSurge: defSurge, rolls, ts: Date.now() };
      setLog((l) => [entry, ...l].slice(0, 20));
    }
  }

  function clearLog() { setLog([]); }

  return (
    <div className="dice-roller">
      <div className="dice-mode-tabs">
        <button className={"dice-mode-tab" + (mode === "attack" ? " active" : "")} onClick={() => setMode("attack")}>Attack</button>
        <button className={"dice-mode-tab" + (mode === "defense" ? " active" : "")} onClick={() => setMode("defense")}>Defense</button>
      </div>

      {mode === "attack" ? (
        <>
          <div className="dice-pool">
            <NumStepper label="Red"   value={atk.red   ?? 0} onChange={(n) => setAtk({ ...atk, red:   n })} color="#e74c3c" />
            <NumStepper label="Black" value={atk.black ?? 0} onChange={(n) => setAtk({ ...atk, black: n })} color="#9aa0a6" />
            <NumStepper label="White" value={atk.white ?? 0} onChange={(n) => setAtk({ ...atk, white: n })} color="#dfe3eb" />
          </div>
          <div className="dice-options">
            <span className="dice-opt-label">Surge:</span>
            {(["none", "hit", "crit"] as const).map((s) => (
              <button
                key={s}
                className={"dice-opt" + ((s === "none" ? !surge : surge === s) ? " active" : "")}
                onClick={() => setSurge(s === "none" ? null : s)}
              >
                {s === "none" ? "—" : s}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="dice-pool">
            <NumStepper label="Red"   value={def.red   ?? 0} onChange={(n) => setDef({ ...def, red:   n })} color="#e74c3c" />
            <NumStepper label="White" value={def.white ?? 0} onChange={(n) => setDef({ ...def, white: n })} color="#dfe3eb" />
          </div>
          <div className="dice-options">
            <span className="dice-opt-label">Surge: Defense</span>
            <label className="dice-toggle">
              <input type="checkbox" checked={defSurge} onChange={(e) => setDefSurge(e.target.checked)} />
              <span>has it</span>
            </label>
          </div>
        </>
      )}

      <div className="dice-actions">
        <button className="dice-roll-btn" onClick={rollNow} disabled={(mode === "attack" ? atkCount : defCount) === 0}>
          Roll {mode === "attack" ? atkCount : defCount} di{(mode === "attack" ? atkCount : defCount) === 1 ? "e" : "ce"}
        </button>
        {log.length > 0 && <button className="ghost-btn" onClick={clearLog}>Clear log</button>}
      </div>

      <ul className="dice-log">
        {log.map((e) => (
          <li key={e.id} className={"dice-log-entry " + e.kind}>
            {e.kind === "attack" ? <AttackRow entry={e} /> : <DefenseRow entry={e} />}
          </li>
        ))}
        {log.length === 0 && <li className="muted empty small">Roll something to start the log.</li>}
      </ul>
    </div>
  );
}

function dieClass(color: string, face: string): string {
  return `die die-${color} die-face-${face}`;
}

function AttackRow({ entry }: { entry: AttackEntry }) {
  const t = tallyAttack(entry.rolls, entry.surge);
  return (
    <>
      <div className="dice-log-dice">
        {entry.rolls.map((r, i) => (
          <span key={i} className={dieClass(r.color, r.face)} title={`${r.color} ${r.face}`}>{FACE_GLYPH[r.face]}</span>
        ))}
      </div>
      <div className="dice-log-summary">
        <span className="dice-tag crit">✸ {t.crits}</span>
        <span className="dice-tag hit">✷ {t.hits}</span>
        {(t.surges > 0) && <span className="dice-tag surge">⌖ {t.surges}</span>}
        <span className="dice-tag blank">· {t.blanks}</span>
        <span className="muted small">total hits: <b>{t.crits + t.hits}</b></span>
      </div>
    </>
  );
}

function DefenseRow({ entry }: { entry: DefenseEntry }) {
  const t = tallyDefense(entry.rolls, entry.hasSurge);
  return (
    <>
      <div className="dice-log-dice">
        {entry.rolls.map((r, i) => (
          <span key={i} className={dieClass(r.color, r.face)} title={`${r.color} ${r.face}`}>{FACE_GLYPH[r.face]}</span>
        ))}
      </div>
      <div className="dice-log-summary">
        <span className="dice-tag block">⛨ {t.blocks}</span>
        {(t.surges > 0) && <span className="dice-tag surge">⌖ {t.surges}</span>}
        <span className="dice-tag blank">· {t.blanks}</span>
        <span className="muted small">total blocks: <b>{t.blocks}</b></span>
      </div>
    </>
  );
}
