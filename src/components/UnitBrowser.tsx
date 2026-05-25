import { useMemo, useState } from "react";
import { CATALOG } from "../data/catalog";
import { RANK_LABEL, RANK_ORDER } from "../lib/factions";
import type { FactionId, Rank, Unit } from "../lib/types";
import { canAdd, type ArmyState } from "../lib/validation";

type Props = {
  faction: FactionId;
  army: ArmyState;
  onAdd: (unit: Unit) => void;
};

export function UnitBrowser({ faction, army, onAdd }: Props) {
  const [rankFilter, setRankFilter] = useState<Rank | "all">("all");
  const [search, setSearch] = useState("");

  const units = useMemo(() => {
    return CATALOG.units
      .filter((u) => u.faction === faction)
      .filter((u) => (rankFilter === "all" ? true : u.rank === rankFilter))
      .filter((u) =>
        search.trim() === ""
          ? true
          : u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.sub_title?.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        const ra = RANK_ORDER.indexOf(a.rank);
        const rb = RANK_ORDER.indexOf(b.rank);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
  }, [faction, rankFilter, search]);

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
          return (
            <li key={u.id} className="unit-row">
              <div className="unit-row-main">
                <div className="unit-row-name">
                  {u.name}
                  {u.is_unique && <span className="badge unique">Unique</span>}
                </div>
                {u.sub_title && (
                  <div className="unit-row-sub muted">{u.sub_title}</div>
                )}
                <div className="unit-row-meta muted">
                  {RANK_LABEL[u.rank]} · {u.points} pts · {u.miniatures} mini
                  {u.miniatures > 1 ? "s" : ""}
                </div>
              </div>
              <button
                className="add-btn"
                disabled={!check.ok}
                title={check.ok ? "Add to army" : check.reason}
                onClick={() => onAdd(u)}
              >
                +
              </button>
            </li>
          );
        })}
        {units.length === 0 && (
          <li className="muted empty">No units match your filter.</li>
        )}
      </ul>
    </section>
  );
}
