import { useState } from "react";
import { InfoDot } from "../components/InfoDot";
import type { DndToken } from "./dndTabletop";
import {
  CONDITIONS, EXHAUSTION_LEVELS, EXHAUSTION_MAX, conditionDef, setExhaustion, toggleCondition,
} from "./dndConditions";

// Conditions section of the D&D token inspector. Ticking one colours a
// slice of the token's base ring; the "i" dot shows the rules.

export function ConditionsPanel({ token, readOnly, onPatch }: {
  token: DndToken;
  readOnly?: boolean;
  onPatch: (p: Partial<DndToken>) => void;
}) {
  const on = new Set(token.conditions ?? []);
  const exh = token.exhaustion ?? 0;
  const count = on.size + (exh > 0 ? 1 : 0);
  // Applied conditions are always listed; the rest fold away once the
  // token has some, so a long list doesn't push the inspector down.
  const [showAll, setShowAll] = useState(count === 0);
  const all = showAll || count === 0;
  // A condition brought in by another one (unconscious → prone) is noted.
  const implied = new Map<string, string>();
  for (const id of on) for (const inc of conditionDef(id).includes ?? []) {
    if (!on.has(inc)) implied.set(inc, conditionDef(id).label);
  }

  return (
    <div className="dnd-cond">
      <div className="dnd-cond-head">
        <span>Conditions{count > 0 && <b> · {count}</b>}</span>
        {count > 0 && !readOnly && (
          <button type="button" className="ghost-btn small"
                  onClick={() => onPatch({ conditions: undefined, exhaustion: undefined })}>Clear</button>
        )}
      </div>
      {CONDITIONS.filter((c) => all || (c.id === "exhaustion" ? exh > 0 : on.has(c.id))).map((c) => {
        const active = c.id === "exhaustion" ? exh > 0 : on.has(c.id);
        const via = implied.get(c.id);
        return (
          <div key={c.id} className={"dnd-cond-row" + (active ? " on" : "")} data-condition={c.id}>
            <label className="dnd-cond-label">
              <input type="checkbox" checked={active} disabled={readOnly}
                     onChange={(e) => onPatch(toggleCondition(token, c.id, e.target.checked))} />
              <span className="dnd-cond-swatch" style={{ background: c.color }} />
              {c.label}
            </label>
            <InfoDot title={c.label} text={c.info} url={c.url} source="D&D Beyond" />
            {via && <span className="muted small dnd-cond-via">via {via}</span>}
            {c.id === "exhaustion" && active && (
              <div className="dnd-cond-level" title={EXHAUSTION_LEVELS.slice(0, exh).join(" · ")}>
                <button disabled={readOnly || exh <= 1} aria-label="Lower exhaustion"
                        onClick={() => onPatch(setExhaustion(exh - 1))}>−</button>
                <b>{exh}</b>
                <button disabled={readOnly || exh >= EXHAUSTION_MAX} aria-label="Raise exhaustion"
                        onClick={() => onPatch(setExhaustion(exh + 1))}>+</button>
              </div>
            )}
          </div>
        );
      })}
      {exh > 0 && (
        <p className="muted small dnd-cond-exh">Exhaustion {exh}: {EXHAUSTION_LEVELS.slice(0, exh).join("; ")}.</p>
      )}
      {count > 0 && (
        <button type="button" className="ghost-btn small dnd-cond-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show applied only" : "Add a condition…"}
        </button>
      )}
    </div>
  );
}
