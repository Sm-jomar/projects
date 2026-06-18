import { useMemo, useState } from "react";
import manifestRaw from "../data/card-manifest.json";

type CardEntry = {
  faction: string;
  kind: string;
  title: string;
  slug: string;
  file: string;
  source: string;
  points?: number | null;
};

const MANIFEST = manifestRaw as CardEntry[];

const FACTIONS = ["rebels", "imperials", "republic", "separatists", "mercenary", "generic"] as const;
const KINDS = ["unit", "upgrade", "command", "battle", "campaign", "spec-ops"] as const;

const FACTION_LABEL: Record<string, string> = {
  rebels: "Rebels",
  imperials: "Empire",
  republic: "Republic",
  separatists: "Separatists",
  mercenary: "Mercenary",
  generic: "Generic",
};
const KIND_LABEL: Record<string, string> = {
  unit: "Units",
  upgrade: "Upgrades",
  command: "Command",
  battle: "Battle",
  campaign: "Campaign",
  "spec-ops": "Spec Ops",
};

const BASE = import.meta.env.BASE_URL;

export function CardBrowser() {
  const [faction, setFaction] = useState<string>("rebels");
  const [kind, setKind] = useState<string>("unit");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState<CardEntry | null>(null);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return MANIFEST.filter((c) => c.faction === faction && c.kind === kind).filter(
      (c) => (q ? c.title.toLowerCase().includes(q) : true),
    );
  }, [faction, kind, search]);

  const counts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const c of MANIFEST) {
      out[c.faction] ??= {};
      out[c.faction][c.kind] = (out[c.faction][c.kind] ?? 0) + 1;
    }
    return out;
  }, []);

  return (
    <div className="card-browser">
      <div className="card-browser-controls">
        <div className="cb-tabs">
          {FACTIONS.map((f) => (
            <button
              key={f}
              className={"cb-tab" + (faction === f ? " active" : "")}
              onClick={() => setFaction(f)}
            >
              {FACTION_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="cb-tabs">
          {KINDS.map((k) => {
            const n = counts[faction]?.[k] ?? 0;
            return (
              <button
                key={k}
                className={"cb-tab" + (kind === k ? " active" : "")}
                disabled={n === 0}
                onClick={() => setKind(k)}
              >
                {KIND_LABEL[k]} <span className="muted small">({n})</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="cb-search"
        />
      </div>
      <div className="card-grid">
        {cards.map((c) => (
          <button
            key={c.file}
            className="card-thumb"
            onClick={() => setZoom(c)}
            title={c.title}
          >
            <img src={BASE + c.file} alt={c.title} loading="lazy" />
            <div className="card-thumb-label">{c.title || c.slug}</div>
          </button>
        ))}
        {cards.length === 0 && (
          <div className="muted empty">No cards match.</div>
        )}
      </div>
      {zoom && (
        <div className="modal-backdrop" onClick={() => setZoom(null)}>
          <div className="card-zoom" onClick={(e) => e.stopPropagation()}>
            <img src={BASE + zoom.file} alt={zoom.title} />
            <div className="card-zoom-caption">
              <span>{zoom.title || zoom.slug}</span>
              <button className="close-btn" onClick={() => setZoom(null)}>
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
