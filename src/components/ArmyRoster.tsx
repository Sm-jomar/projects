import { useState } from "react";
import { unitById, upgradeById } from "../data/catalog";
import { FACTIONS, RANK_LABEL, RANK_LIMITS, RANK_ORDER } from "../lib/factions";
import type { ArmyEntry, FactionId, Rank } from "../lib/types";
import {
  entryPoints,
  slotUsage,
  validateArmy,
  type ArmyState,
} from "../lib/validation";
import { UpgradePicker } from "./UpgradePicker";

type Props = {
  army: ArmyState;
  faction: FactionId;
  name: string;
  onNameChange: (name: string) => void;
  onCapChange: (cap: number) => void;
  onRemove: (entryId: string) => void;
  onAttachUpgrade: (entryId: string, upgradeId: string) => void;
  onDetachUpgrade: (entryId: string, upgradeId: string) => void;
};

export function ArmyRoster({
  army,
  faction,
  name,
  onNameChange,
  onCapChange,
  onRemove,
  onAttachUpgrade,
  onDetachUpgrade,
}: Props) {
  const [pickerEntryId, setPickerEntryId] = useState<string | null>(null);
  const pickerEntry = pickerEntryId
    ? army.entries.find((e) => e.entryId === pickerEntryId) ?? null
    : null;
  const report = validateArmy(army);
  const f = FACTIONS[faction];

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

  const pickerUnit = pickerEntry ? unitById(pickerEntry.unitId) : null;

  return (
    <section className="panel army-roster">
      <header className="panel-head roster-head">
        <input
          className="list-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Untitled list"
        />
        <div
          className="faction-pill"
          style={{ background: f.color, color: f.accent }}
        >
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
          className={"legal-pill " + (report.isLegal ? "legal" : "illegal")}
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
                    const usage = slotUsage(entry);
                    const hasSlots = Object.keys(usage.available).length > 0;
                    const total = entryPoints(entry);
                    const upgrades = entry.upgrades ?? [];
                    return (
                      <li key={entry.entryId} className="entry-row-wrap">
                        <div className="entry-row">
                          <div className="entry-row-main">
                            <span className="entry-name">{u.name}</span>
                            <span className="muted small">
                              {" "}
                              · {total} pts
                              {upgrades.length > 0 ? (
                                <span> ({u.points} base)</span>
                              ) : null}
                            </span>
                          </div>
                          <div className="entry-actions">
                            {hasSlots && (
                              <button
                                className="upgrade-btn"
                                onClick={() => setPickerEntryId(entry.entryId)}
                                title="Add upgrade"
                              >
                                + Upgrade
                              </button>
                            )}
                            <button
                              className="remove-btn"
                              onClick={() => onRemove(entry.entryId)}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        {upgrades.length > 0 && (
                          <ul className="attached-upgrades">
                            {upgrades.map((upId) => {
                              const up = upgradeById(upId);
                              if (!up) {
                                return (
                                  <li key={upId} className="attached-upgrade missing">
                                    <span className="muted small">
                                      Unknown upgrade ({upId})
                                    </span>
                                    <button
                                      className="remove-btn small-x"
                                      onClick={() =>
                                        onDetachUpgrade(entry.entryId, upId)
                                      }
                                    >
                                      ×
                                    </button>
                                  </li>
                                );
                              }
                              return (
                                <li key={upId} className="attached-upgrade">
                                  <span className="up-name">↳ {up.name}</span>
                                  <span className="muted small">
                                    {" "}
                                    · {up.points} pts
                                  </span>
                                  <button
                                    className="remove-btn small-x"
                                    onClick={() =>
                                      onDetachUpgrade(entry.entryId, upId)
                                    }
                                    title="Remove upgrade"
                                  >
                                    ×
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {pickerEntry && pickerUnit && (
        <UpgradePicker
          army={army}
          entry={pickerEntry}
          unit={pickerUnit}
          onAttach={(upgradeId) =>
            onAttachUpgrade(pickerEntry.entryId, upgradeId)
          }
          onClose={() => setPickerEntryId(null)}
        />
      )}
    </section>
  );
}
