import { unitById } from "../data/catalog";
import { FACTIONS, RANK_LABEL, RANK_LIMITS, RANK_ORDER } from "../lib/factions";
import type { ArmyEntry, FactionId, Rank } from "../lib/types";
import { validateArmy, type ArmyState } from "../lib/validation";

type Props = {
  army: ArmyState;
  faction: FactionId;
  name: string;
  onNameChange: (name: string) => void;
  onCapChange: (cap: number) => void;
  onRemove: (entryId: string) => void;
};

export function ArmyRoster({
  army,
  faction,
  name,
  onNameChange,
  onCapChange,
  onRemove,
}: Props) {
  const report = validateArmy(army);
  const f = FACTIONS[faction];

  // Group entries by rank
  const grouped: Record<Rank, ArmyEntry[]> = {
    commander: [],
    operative: [],
    corps: [],
    "special-forces": [],
    support: [],
    heavy: [],
  };
  for (const entry of army.entries) {
    const u = unitById(entry.unitId);
    if (u) grouped[u.rank].push(entry);
  }

  return (
    <section className="panel army-roster">
      <header className="panel-head roster-head">
        <input
          className="list-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Untitled list"
        />
        <div className="faction-pill" style={{ background: f.color, color: f.accent }}>
          {f.short}
        </div>
      </header>

      <div className="points-bar">
        <div className="points-current">
          <strong>{report.totalPoints}</strong>
          <span className="muted"> / </span>
          <label>
            <input
              type="number"
              className="cap-input"
              min={0}
              step={50}
              value={army.pointsCap}
              onChange={(e) => onCapChange(Number(e.target.value) || 0)}
            />
            <span className="muted"> pts</span>
          </label>
        </div>
        <div
          className={
            "legal-pill " + (report.isLegal ? "legal" : "illegal")
          }
        >
          {report.isLegal ? "Legal" : "Illegal"}
        </div>
      </div>

      {report.issues.length > 0 && (
        <ul className="issues">
          {report.issues.map((i, idx) => (
            <li key={idx} className={`issue ${i.severity}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="rank-groups">
        {RANK_ORDER.map((rank) => {
          const entries = grouped[rank];
          const limit = RANK_LIMITS[rank];
          return (
            <div key={rank} className="rank-group">
              <div className="rank-group-head">
                <span className="rank-label">{RANK_LABEL[rank]}</span>
                <span className="muted">
                  {entries.length} / {limit.min}–{limit.max}
                </span>
              </div>
              {entries.length === 0 ? (
                <div className="muted small empty-rank">— empty —</div>
              ) : (
                <ul className="entry-list">
                  {entries.map((entry) => {
                    const u = unitById(entry.unitId)!;
                    return (
                      <li key={entry.entryId} className="entry-row">
                        <div className="entry-row-main">
                          <span className="entry-name">{u.name}</span>
                          <span className="muted small"> · {u.points} pts</span>
                        </div>
                        <button
                          className="remove-btn"
                          onClick={() => onRemove(entry.entryId)}
                          title="Remove"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
