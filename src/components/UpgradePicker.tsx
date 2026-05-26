import { useMemo, useState } from "react";
import { CATALOG } from "../data/catalog";
import { cardForUpgrade } from "../lib/cardLookup";
import type { ArmyEntry, Unit, Upgrade } from "../lib/types";
import { canAddUpgrade, slotUsage, type ArmyState } from "../lib/validation";

const SLOT_LABEL: Record<string, string> = {
  armament: "Armament",
  command: "Command",
  comms: "Comms",
  crew: "Crew",
  elite: "Elite",
  force: "Force",
  gear: "Gear",
  generator: "Generator",
  grenades: "Grenades",
  gunner: "Gunner",
  "hard-point": "Hard Point",
  "heavy-weapon": "Heavy Weapon",
  ordnance: "Ordnance",
  personnel: "Personnel",
  pilot: "Pilot",
  training: "Training",
};

type Props = {
  army: ArmyState;
  entry: ArmyEntry;
  unit: Unit;
  onAttach: (upgradeId: string) => void;
  onClose: () => void;
};

export function UpgradePicker({ army, entry, unit, onAttach, onClose }: Props) {
  const [slotFilter, setSlotFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Upgrade | null>(null);

  const usage = slotUsage(entry);

  const slotsForUnit = useMemo(() => Object.keys(usage.available), [usage]);

  const candidates = useMemo(() => {
    const upgrades = CATALOG.upgrades ?? [];
    const q = search.trim().toLowerCase();
    return upgrades
      .filter((u) => (slotFilter === "all" ? true : u.type === slotFilter))
      .filter((u) => (usage.available[u.type] ?? 0) > 0)
      .filter((u) =>
        u.restricted_to_unit && u.restricted_to_unit.length > 0
          ? u.restricted_to_unit.some((r) => r.id === unit.id)
          : true,
      )
      .filter((u) => (q ? u.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
      });
  }, [search, slotFilter, unit.id, usage.available]);

  const previewCard = preview ? cardForUpgrade({ id: preview.id, name: preview.name, faction: unit.faction }) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="upgrade-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>Upgrades · {unit.name}</h2>
            <div className="slot-pills">
              {slotsForUnit.map((slot) => {
                const used = usage.used[slot] ?? 0;
                const avail = usage.available[slot] ?? 0;
                const full = used >= avail;
                return (
                  <span
                    key={slot}
                    className={"slot-pill" + (full ? " full" : "")}
                  >
                    {SLOT_LABEL[slot] ?? slot} {used}/{avail}
                  </span>
                );
              })}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="upgrade-picker-body">
          <div className="upgrade-list-pane">
            <div className="upgrade-controls">
              <input
                type="search"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                value={slotFilter}
                onChange={(e) => setSlotFilter(e.target.value)}
              >
                <option value="all">All slots</option>
                {slotsForUnit.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
            <ul className="upgrade-list">
              {candidates.map((up) => {
                const check = canAddUpgrade(army, entry, up);
                return (
                  <li
                    key={up.id}
                    className={"upgrade-row" + (preview?.id === up.id ? " active" : "")}
                    onClick={() => setPreview(up)}
                  >
                    <div className="upgrade-row-main">
                      <div className="upgrade-row-name">
                        {up.name}
                        {up.is_unique && (
                          <span className="badge unique">Unique</span>
                        )}
                      </div>
                      <div className="muted small">
                        {SLOT_LABEL[up.type] ?? up.type} · {up.points} pts
                        {up.restricted_to_unit &&
                          up.restricted_to_unit.length > 0 && (
                            <>
                              {" · "}
                              <em>
                                {up.restricted_to_unit.length === 1
                                  ? "Only this unit"
                                  : `Restricted (${up.restricted_to_unit.length} units)`}
                              </em>
                            </>
                          )}
                      </div>
                    </div>
                    <button
                      className="add-btn"
                      disabled={!check.ok}
                      title={check.ok ? "Attach" : check.reason}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (check.ok) onAttach(up.id);
                      }}
                    >
                      +
                    </button>
                  </li>
                );
              })}
              {candidates.length === 0 && (
                <li className="muted empty">No matching upgrades.</li>
              )}
            </ul>
          </div>
          <div className="upgrade-preview-pane">
            {preview ? (
              previewCard ? (
                <img src={previewCard} alt={preview.name} />
              ) : (
                <div className="muted empty" style={{ padding: 24 }}>
                  No card image found for "{preview.name}".
                </div>
              )
            ) : (
              <div className="muted empty" style={{ padding: 24 }}>
                Select an upgrade to preview its card.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
