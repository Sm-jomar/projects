import { useDndRoom, type SharedRoll } from "./dndRoom";

// Renders a shared dice-roll feed with per-player attribution. Used on the
// tabletop and in the Dice tab. Marks hidden/secret rolls and answers to
// DM roll requests (with pass/fail when a DC is known to this viewer).
export function RollFeed({ feed, emptyText }: { feed: SharedRoll[]; emptyText?: string }) {
  const room = useDndRoom();
  if (feed.length === 0) return <p className="muted small">{emptyText ?? "No rolls yet."}</p>;

  // The DM keeps unrevealed DCs locally, keyed by request id.
  const dcFor = (r: SharedRoll): number | undefined =>
    r.dc ?? (r.requestId ? room.outgoingRequests.find((o) => o.req.id === r.requestId)?.dc : undefined);

  return (
    <ul className="dnd-roll-log">
      {feed.map((r) => {
        const dc = dcFor(r);
        const hiddenBadge = r.vis === "dm"
          ? (!r.fromId ? (room.isDm ? "🔒 Hidden from players" : "🔒 Only the DM sees this") : "🔒 Secret roll")
          : null;
        return (
          <li key={r.id} className={"dnd-roll" + (r.vis === "dm" ? " hidden" : "")}>
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
            {(hiddenBadge || r.requestId || dc != null) && (
              <div className="dnd-roll-badges">
                {hiddenBadge && <span className="dnd-roll-badge hidden">{hiddenBadge}</span>}
                {r.requestId && <span className="dnd-roll-badge">↳ requested roll</span>}
                {dc != null && r.rolls.length > 0 && (
                  <span className={"dnd-roll-badge " + (r.total >= dc ? "pass" : "fail")}>
                    vs DC {dc} {r.total >= dc ? "✓ pass" : "✗ fail"}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
