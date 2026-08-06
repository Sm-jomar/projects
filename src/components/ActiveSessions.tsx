import { useCallback, useEffect, useState } from "react";
import { legionPlayUrl, dndPlayUrl, roomsAvailableHere } from "../lib/appRouting";

export type LobbyPlayer = { name: string; color: string };
export type LobbySession = {
  code: string;
  app: "legion" | "dnd";
  players: LobbyPlayer[];
  startedAt: number;
  updatedAt: number;
};

const POLL_MS = 10_000;

// Legion identities are role words; D&D sends a hex. Map to a swatch color.
function swatch(color: string): string {
  if (color === "blue") return "#6fa8e6";
  if (color === "red") return "#e67a6f";
  if (color === "spectator") return "#8b94a8";
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8b94a8";
}

function since(ts: number, now: number): string {
  const m = Math.max(0, Math.floor((now - ts) / 60000));
  if (m < 1) return "just started";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Live directory of in-progress multiplayer games, served by the Worker's
 * /api/sessions endpoint. Polls while the tab is visible.
 */
export function ActiveSessions() {
  // null = still loading. Off the Worker-served origin there's no directory
  // to load, so start at an empty list rather than a spinner that never ends.
  const [sessions, setSessions] = useState<LobbySession[] | null>(
    () => (roomsAvailableHere() ? null : []),
  );
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Promise-chain (not async/await) so every setState lands in a callback
  // once the request settles, never synchronously during an effect.
  const load = useCallback(() => {
    return fetch("/api/sessions", { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        const list = (body as { sessions?: LobbySession[] }).sessions;
        setSessions(Array.isArray(list) ? list : []);
        setError(false);
        setNow(Date.now());
      })
      .catch(() => {
        setError(true);
        setSessions((s) => s ?? []);
        setNow(Date.now());
      });
  }, []);

  useEffect(() => {
    // The directory only exists on the Worker-served origin.
    if (!roomsAvailableHere()) return;
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const list = sessions ?? [];

  return (
    <section className="sessions">
      <div className="sessions-head">
        <h2>Live games</h2>
        <span className="muted small">
          {sessions === null ? "checking…" : `${list.length} active`}
        </span>
        <button className="ghost-btn small" onClick={() => void load()}>Refresh</button>
      </div>

      {sessions === null ? (
        <p className="muted small">Looking for games in progress…</p>
      ) : list.length === 0 ? (
        <p className="muted small">
          {error
            ? "Couldn't reach the game server just now — try Refresh."
            : "No games in progress. Start one from a game's Tabletop, and it'll show up here."}
        </p>
      ) : (
        <ul className="sessions-list">
          {list.map((s) => {
            const url = s.app === "dnd" ? dndPlayUrl(s.code) : legionPlayUrl(s.code);
            const active = s.players.filter((p) => p.color !== "spectator");
            const watchers = s.players.length - active.length;
            return (
              <li key={`${s.app}:${s.code}`} className={"session-row " + s.app}>
                <span className={"session-tag " + s.app}>
                  {s.app === "dnd" ? "D&D" : "Legion"}
                </span>
                <span className="session-code">{s.code}</span>
                <span className="session-players">
                  {active.map((p, i) => (
                    <span key={i} className="session-player">
                      <span className="session-dot" style={{ background: swatch(p.color) }} />
                      {p.name}
                    </span>
                  ))}
                  {watchers > 0 && (
                    <span className="muted small">+{watchers} watching</span>
                  )}
                </span>
                <span className="muted small session-age">{since(s.startedAt, now)}</span>
                <a className="session-join" href={url}>Join ▸</a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
