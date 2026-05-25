import { FACTIONS, FACTION_ORDER } from "../lib/factions";
import type { FactionId } from "../lib/types";

type Props = {
  onPick: (faction: FactionId) => void;
};

export function FactionPicker({ onPick }: Props) {
  return (
    <div className="faction-picker">
      <h2>Choose a faction</h2>
      <p className="muted">
        Once you pick a faction your army is locked to it — units from other
        factions cannot be added.
      </p>
      <div className="faction-grid">
        {FACTION_ORDER.map((id) => {
          const f = FACTIONS[id];
          return (
            <button
              key={id}
              className="faction-card"
              style={{
                background: f.color,
                borderColor: f.accent,
                color: f.accent,
              }}
              onClick={() => onPick(id)}
            >
              <div className="faction-card-name">{f.name}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
