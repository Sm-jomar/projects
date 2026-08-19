import { useMemo, useState } from "react";
import { CATALOG } from "../data/catalog";
import { cardForUnit } from "../lib/cardLookup";
import { FACTIONS } from "../lib/factions";
import type { FactionId, Unit } from "../lib/types";

type Props = {
  /** Pre-selected faction (usually the register's faction). Still
   * changeable in the picker — a campaign can field the odd ally. */
  initialFaction?: FactionId | "";
  onPick: (unit: Unit) => void;
  onClose: () => void;
};

// A compact catalog browser for picking a single unit — used by the ToD
// Register's dossiers to link a real catalog unit (and its card image)
// instead of a free-typed name. Deliberately smaller than the army
// builder's UnitBrowser: no points/upgrades, just find-and-pick.
export function UnitPickerModal({ initialFaction, onPick, onClose }: Props) {
  const [faction, setFaction] = useState<FactionId | "">(initialFaction ?? "");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.units
      .filter((u) => !faction || u.faction === faction)
      .filter((u) => !q || u.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [faction, query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal unit-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Pick a unit</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="unit-picker-controls">
          <select value={faction} onChange={(e) => setFaction(e.target.value as FactionId | "")}>
            <option value="">All factions</option>
            {Object.values(FACTIONS).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <input
            type="search"
            autoFocus
            placeholder="Search unit name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="unit-picker-list">
          {results.length === 0 ? (
            <p className="muted small empty">
              {faction || query ? "No units match." : "Pick a faction or start typing to search."}
            </p>
          ) : (
            results.map((u) => {
              const card = cardForUnit(u);
              return (
                <button key={u.id} className="unit-picker-row" onClick={() => onPick(u)}>
                  <span className="unit-picker-thumb" style={card ? { backgroundImage: `url(${card})` } : undefined} />
                  <span className="unit-picker-info">
                    <span className="unit-picker-name">{u.name}</span>
                    <span className="muted small">{FACTIONS[u.faction]?.short ?? u.faction} · {u.type}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
