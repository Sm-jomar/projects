import { useEffect, useState } from "react";
import "./auditLog.css";
import { relativeTime, type LogEntry } from "../lib/auditLog";

// Shared audit-log list used by both the Legion and D&D tabletops. Move
// entries are clickable to trigger a ghost replay via onReplay.
export function AuditLogView({ log, onReplay, emptyText }: {
  log: LogEntry[] | undefined;
  onReplay: (m: LogEntry["move"]) => void;
  emptyText?: string;
}) {
  // Tick so the "Xs ago" labels stay fresh (and avoids calling Date.now
  // during render).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const entries = (log ?? []).slice().reverse(); // newest first
  if (entries.length === 0) {
    return <p className="muted small">{emptyText ?? "No actions yet. Moves and changes will show here."}</p>;
  }
  return (
    <ul className="audit-log">
      {entries.map((e) => (
        <li key={e.id}
            className={"audit-log-row" + (e.move ? " replayable" : "")}
            onClick={() => e.move && onReplay(e.move)}
            title={e.move ? "Click to replay this move" : undefined}>
          <span className="audit-log-dot" style={{ background: e.actor.color }} />
          <span className="audit-log-text"><b>{e.actor.name}</b> {e.text}{e.move && <span className="audit-log-replay"> ⟲</span>}</span>
          <span className="audit-log-time muted">{relativeTime(e.ts, now)}</span>
        </li>
      ))}
    </ul>
  );
}
