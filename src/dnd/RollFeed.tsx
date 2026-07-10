import type { SharedRoll } from "./dndRoom";

// Renders a shared dice-roll feed with per-player attribution. Used on the
// tabletop and in the Dice tab.
export function RollFeed({ feed, emptyText }: { feed: SharedRoll[]; emptyText?: string }) {
  if (feed.length === 0) return <p className="muted small">{emptyText ?? "No rolls yet."}</p>;
  return (
    <ul className="dnd-roll-log">
      {feed.map((r) => (
        <li key={r.id} className="dnd-roll">
          <div className="dnd-roll-top">
            <span className="dnd-roll-who">
              <span className="dnd-roll-dot" style={{ background: r.actor.color }} />
              <b>{r.actor.name}</b>
              <span className="dnd-roll-label"> · {r.label}</span>
            </span>
            {r.rolls.length > 0 && <span className="dnd-roll-total">{r.total}</span>}
          </div>
          {r.rolls.length > 0 && (
            <div className="dnd-roll-dice">
              {r.rolls.map((d, i) => (
                <span key={i}
                      className={"dnd-roll-die" + (d.sides === 20 && d.value === 20 ? " crit" : d.sides === 20 && d.value === 1 ? " fumble" : "")}
                      title={`d${d.sides}`}>{d.value}</span>
              ))}
              {r.modifier !== 0 && <span className="dnd-roll-mod">{r.modifier >= 0 ? `+${r.modifier}` : r.modifier}</span>}
            </div>
          )}
          {r.note && (
            <div className={"dnd-roll-note" + (r.note.includes("Natural 20") ? " crit" : r.note.includes("Natural 1") ? " fumble" : "")}>{r.note}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
