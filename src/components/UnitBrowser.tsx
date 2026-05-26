import { useMemo, useState } from "react";
import { CATALOG } from "../data/catalog";
import {
  isUnitVisibleInBattleForce,
  RANK_LABEL,
  RANK_ORDER,
} from "../lib/factions";
import { effectiveUnitPoints } from "../lib/points";
import type { FactionId, Rank, Unit } from "../lib/types";
import { canAdd, type ArmyState } from "../lib/validation";
import { cardForUnit } from "../lib/cardLookup";

type Props = {
  faction: FactionId;
  battleForce?: string;
  army: ArmyState;
  onAdd: (unit: Unit) => void;
  onOpenReference?: () => void;
};

export function UnitBrowser({
  faction,
  battleForce,
  army,
  onAdd,
  onOpenReference,
}: Props) {
  const [rankFilter, setRankFilter] = useState<Rank | "all">("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Unit | null>(null);

  const units = useMemo(() => {
    return CATALOG.units
      .filter(
        (u) =>
          u.faction === faction ||
          (u.also_factions && u.also_factions.includes(faction)),
      )
      .filter((u) =>
        battleForce ? isUnitVisibleInBattleForce(u.name, battleForce) : true,
      )
      .filter((u) => (rankFilter === "all" ? true : u.rank === rankFilter))
      .filter((u) =>
        search.trim() === ""
          ? true
          : u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.sub_title?.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => {
        const ra = RANK_ORDER.indexOf(a.rank);
        const rb = RANK_ORDER.indexOf(b.rank);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
  }, [faction, battleForce, rankFilter, search]);

  const factionHasAnyUnits = useMemo(
    () => CATALOG.units.some((u) => u.faction === faction),
    [faction],
  );

  const previewCard = preview ? cardForUnit(preview) : null;

  return (
    <section className="panel unit-browser">
      <header className="panel-head">
        <h2>Units</h2>
        <div className="controls">
          <input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={rankFilter}
            onChange={(e) => setRankFilter(e.target.value as Rank | "all")}
          >
            <option value="all">All ranks</option>
            {RANK_ORDER.map((r) => (
              <option key={r} value={r}>
                {RANK_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </header>
      <ul className="unit-list">
        {units.map((u) => {
          const check = canAdd(army, u);
          const cost = effectiveUnitPoints(u, army.pointsMode);
          const adjusted = army.pointsMode === "v2_6" && cost !== u.points;
          return (
            <li
              key={u.id}
              className="unit-row clickable"
              onClick={() => setPreview(u)}
              title="Click to preview card"
            >
              <div className="unit-row-main">
                <div className="unit-row-name">
                  {u.name}
                  {u.is_unique && <span className="badge unique">Unique</span>}
                </div>
                {u.sub_title && (
                  <div className="unit-row-sub muted">{u.sub_title}</div>
                )}
                <div className="unit-row-meta muted">
                  {RANK_LABEL[u.rank]} · {cost} pts
                  {adjusted && <span className="adj-hint"> (was {u.points})</span>}
                  {" · "}
                  {u.miniatures} mini{u.miniatures > 1 ? "s" : ""}
                </div>
              </div>
              <button
                className="add-btn"
                disabled={!check.ok}
                title={check.ok ? "Add to army" : check.reason}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(u);
                }}
              >
                +
              </button>
            </li>
          );
        })}
        {units.length === 0 && (
          <li className="muted empty">
            {factionHasAnyUnits ? (
              "No units match your filter."
            ) : (
              <>
                <div>No units in the catalog for this faction yet.</div>
                {onOpenReference && (
                  <button
                    style={{ marginTop: 12 }}
                    onClick={onOpenReference}
                  >
                    Browse cards in Reference
                  </button>
                )}
              </>
            )}
          </li>
        )}
      </ul>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="card-zoom" onClick={(e) => e.stopPropagation()}>
            {previewCard ? (
              <img src={previewCard} alt={preview.name} />
            ) : (
              <div className="empty muted" style={{ padding: 40 }}>
                No card image found for "{preview.name}".
              </div>
            )}
            <div className="card-zoom-caption">
              <div>
                <strong>{preview.name}</strong>
                <span className="muted small">
                  {" "}
                  · {RANK_LABEL[preview.rank]} · {preview.points} pts
                </span>
              </div>
              <div className="saved-row-actions">
                <button
                  disabled={!canAdd(army, preview).ok}
                  onClick={() => {
                    onAdd(preview);
                    setPreview(null);
                  }}
                >
                  Add to army
                </button>
                <button className="close-btn" onClick={() => setPreview(null)}>
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
