import { useState } from "react";
import { BATTLE_FORCES, FACTIONS, FACTION_ORDER } from "../lib/factions";
import type { FactionId } from "../lib/types";

type Props = {
  onPick: (faction: FactionId, battleForce?: string) => void;
};

export function FactionPicker({ onPick }: Props) {
  const [selectedBf, setSelectedBf] = useState<Record<FactionId, string>>(
    {} as Record<FactionId, string>,
  );

  return (
    <div className="faction-picker">
      <h2>Choose a faction</h2>
      <p className="muted">
        Once you pick a faction your army is locked to it. Battle Force is
        optional — pick one to label the list as a themed army.
      </p>
      <div className="faction-grid">
        {FACTION_ORDER.map((id) => {
          const f = FACTIONS[id];
          const bfs = BATTLE_FORCES[id] ?? [];
          const bf = selectedBf[id] ?? "";
          return (
            <div
              key={id}
              className="faction-card"
              style={{
                background: f.color,
                borderColor: f.accent,
                color: f.accent,
              }}
            >
              <div className="faction-card-name">{f.name}</div>
              {bfs.length > 0 && (
                <select
                  className="faction-card-bf"
                  value={bf}
                  onChange={(e) =>
                    setSelectedBf((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">— Standard (no Battle Force) —</option>
                  {bfs.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="faction-card-start"
                onClick={() => onPick(id, bf || undefined)}
              >
                Start army →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
