import { useState } from "react";
import type { Peer, RoomApp } from "../lib/roomClient";
import { aiJoinUrl, aiPermissions, aiRoleLabel, type AiRole } from "../lib/aiInvite";
import { canManageAiInvites, type AiInvitesState } from "./useAiInvites";
import type { AiPlayersState } from "./useAiPlayers";
import type { AiInvite } from "../lib/aiInvite";
import "./aiInvites.css";

function PermissionList({ app, role, board }: { app: RoomApp; role: AiRole; board: boolean }) {
  return (
    <ul className="ai-perms">
      {aiPermissions(app, role, board).map((p) => (
        <li key={p.label} className={p.allowed ? "yes" : "no"}>
          <span className="ai-perm-mark" aria-label={p.allowed ? "Allowed" : "Not allowed"}>{p.allowed ? "✓" : "✕"}</span>
          {p.label}
        </li>
      ))}
    </ul>
  );
}

// The "Invite an AI" section of the multiplayer panel: pick a role, mint a
// code, then copy it, preview it in a new tab, or revoke it.
// "Let Claude play" for one player invite: pick what it fields, start it in
// this tab, and see what it's doing.
function ClaudePlayer({ inv, players, you, peers, onSpectate }: {
  inv: AiInvite; players: AiPlayersState; you: Peer | null; peers: Peer[];
  /** Give up my side so the AI can have it. */
  onSpectate?: () => void;
}) {
  const [army, setArmy] = useState(players.armies[0]?.key ?? "auto");
  const st = players.running[inv.id];
  if (inv.role !== "player") return null;
  if (!inv.board) {
    return <p className="muted small ai-play-note">To let Claude play this seat on its own, make a code with <b>Can move pieces</b>.</p>;
  }
  if (st) {
    const side = st.you?.color;
    const who = st.fallback ? "built-in tactics" : st.lastBy === "claude" ? "Claude" : st.lastBy === "tactics" ? "built-in tactics" : "Claude";
    return (
      <div className="ai-play">
        <span className={"ai-play-dot" + (st.conn === "open" ? " live" : "")} />
        <span className="small">
          {side === "blue" || side === "red" ? <><b className={`ai-play-side ${side}`}>{side === "blue" ? "Blue" : "Red"}</b> · </> : null}
          {st.over ? "Game over" : st.activity}
          {st.conn === "open" && !st.over && <span className="muted"> · {who}</span>}
        </span>
        <button className="ghost-btn small" onClick={() => players.stop(inv.id)}>Stop</button>
        {st.fallback && <span className="muted small ai-play-why">Claude isn't answering ({st.fallback}), so it plays with built-in tactics.</span>}
      </div>
    );
  }
  const connected = peers.some((p) => p.aiInvite === inv.id);
  const taken = new Set(peers.map((p) => p.color));
  const free = ["blue", "red"].filter((c) => !taken.has(c)).length;
  const mine = you?.color === "blue" || you?.color === "red";
  const handOver = free === 0 && mine && !!onSpectate;
  function go() {
    if (handOver) {
      // Watch instead, then seat the AI once my side is free.
      onSpectate!();
      setTimeout(() => players.start(inv, army), 900);
    } else players.start(inv, army);
  }
  return (
    <div className="ai-play">
      <label className="small">Army
        <select value={army} onChange={(e) => setArmy(e.target.value)}>
          {players.armies.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </label>
      <button className="ai-play-go" disabled={connected || (free === 0 && !handOver)} onClick={go}
        title={connected ? "This code is already in the game (close its preview first)" : free === 0 && !handOver ? "Both sides are taken" : "Run this AI in this tab with Claude making its choices"}>
        ▶ Let Claude play{handOver ? " (you watch)" : ""}
      </button>
    </div>
  );
}

export function AiInvitePanel({ app, ai, you, peers, players, onSpectate }: {
  app: RoomApp; ai: AiInvitesState; you: Peer | null; peers: Peer[];
  /** "Let Claude play" seats (Legion). */
  players?: AiPlayersState;
  onSpectate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AiRole>("player");
  const [name, setName] = useState("");
  const [board, setBoard] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const canManage = canManageAiInvites(app, you, peers);
  const canDm = app === "dnd" && !!you?.dm;
  const pickedRole: AiRole = role === "dm" && !canDm ? "player" : role;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && canManage) ai.refresh();
  }
  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
  }

  return (
    <div className="ai-inv">
      <button className="ghost-btn small ai-inv-toggle" onClick={toggle} aria-expanded={open}>
        <span className="ai-tag">AI</span> Invite an AI {open ? "▾" : "▸"}
      </button>
      {open && !canManage && (
        <p className="muted small">
          {you?.color === "spectator" ? "Spectators can't invite an AI." : "Only the DM can invite an AI while a DM is seated."}
        </p>
      )}
      {!canManage && players && ai.invites.some((inv) => players.running[inv.id]) && (
        <div className="ai-inv-list">
          {ai.invites.filter((inv) => players.running[inv.id]).map((inv) => (
            <div key={inv.id} className="ai-inv-item">
              <div className="ai-inv-item-head"><span className="ai-tag">AI</span><b>{inv.name}</b></div>
              <ClaudePlayer inv={inv} players={players} you={you} peers={peers} />
            </div>
          ))}
        </div>
      )}
      {open && canManage && (
        <div className="ai-inv-body">
          <p className="muted small">
            Make a code that lets an AI (like ChatGPT) join this game. Open it yourself
            with <b>Preview as AI</b> to see exactly what it can do.
            {players && <> Or press <b>Let Claude play</b> to have Claude play that seat from this tab; two player codes make an AI vs AI game.</>}
          </p>
          <div className="ai-inv-roles" role="radiogroup" aria-label="Invite the AI as">
            <label className={"ai-role" + (pickedRole === "player" ? " active" : "")}>
              <input type="radio" checked={pickedRole === "player"} onChange={() => setRole("player")} /> Player
            </label>
            {app === "dnd" && (
              <label className={"ai-role" + (pickedRole === "dm" ? " active" : "") + (canDm ? "" : " disabled")}
                     title={canDm ? "The AI takes the DM seat when it joins" : "Take the DM seat first to hand it to an AI"}>
                <input type="radio" checked={pickedRole === "dm"} disabled={!canDm} onChange={() => setRole("dm")} /> DM
              </label>
            )}
          </div>
          {app === "dnd" && !canDm && <span className="muted small">To invite an AI DM, become the DM first.</span>}
          <label className="ai-inv-field">Name it goes by
            <input value={name} maxLength={24} placeholder={aiRoleLabel(pickedRole)} onChange={(e) => setName(e.target.value)} />
          </label>
          {pickedRole === "player" && (
            <label className="ai-inv-check">
              <input type="checkbox" checked={board} onChange={(e) => setBoard(e.target.checked)} />
              Can move pieces on the board
            </label>
          )}
          {pickedRole === "dm" && (
            <p className="muted small ai-inv-warn">When the AI joins with this code it takes the DM seat from you. Revoke the code to take it back.</p>
          )}
          <span className="muted small">With this code the AI can:</span>
          <PermissionList app={app} role={pickedRole} board={board} />
          <button className="ai-inv-create" onClick={() => ai.create(pickedRole, name.trim(), board)}>
            Create {aiRoleLabel(pickedRole)} code
          </button>
          {ai.notice && <p className="small ai-inv-error">{ai.notice}</p>}

          {ai.invites.length > 0 && (
            <div className="ai-inv-list">
              {ai.invites.map((inv) => {
                const connected = peers.some((p) => p.aiInvite === inv.id);
                return (
                  <div key={inv.id} className="ai-inv-item">
                    <div className="ai-inv-item-head">
                      <span className={"ai-tag" + (inv.role === "dm" ? " dm" : "")}>{inv.role === "dm" ? "AI DM" : "AI"}</span>
                      <b>{inv.name}</b>
                      <span className="muted small">{inv.role === "dm" ? "DM" : inv.board ? "player · can move pieces" : "player · watch & chat"}</span>
                      {connected && <span className="ai-inv-live small">● in game</span>}
                    </div>
                    <code className="ai-inv-code">{inv.code}</code>
                    {players && <ClaudePlayer inv={inv} players={players} you={you} peers={peers} onSpectate={onSpectate} />}
                    <div className="ai-inv-actions">
                      <button className="ghost-btn small" onClick={() => copy(inv.code, inv.id + "c")}>{copied === inv.id + "c" ? "Copied" : "Copy code"}</button>
                      <button className="ghost-btn small" onClick={() => copy(aiJoinUrl(app, inv.code), inv.id + "l")}>{copied === inv.id + "l" ? "Copied" : "Copy link"}</button>
                      <button className="ghost-btn small" onClick={() => window.open(aiJoinUrl(app, inv.code), "_blank", "noopener")}>Preview as AI ↗</button>
                      <button className="ghost-btn small danger-text" onClick={() => ai.revoke(inv.id)}>Revoke</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shown to a connection that joined with an AI invite: which seat it holds
// and the full list of what it may and may not do. For a person previewing
// the code this is the point; for a real AI it's the same facts.
export function AiSeatBanner({ app, ai, onLeave, error }: {
  app: RoomApp; ai: AiInvitesState; onLeave: () => void;
  /** Why the connection ended (e.g. the invite was revoked). */
  error?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const inv = ai.self;
  if (!inv) return null;
  return (
    <div className="ai-seat" role="status">
      <div className="ai-seat-head">
        <span className={"ai-tag" + (inv.role === "dm" ? " dm" : "")}>{inv.role === "dm" ? "AI DM" : "AI"}</span>
        <span>
          You're in this game as <b>{inv.name}</b>, with an AI {inv.role === "dm" ? "DM" : "player"} invite.
          This is exactly what an AI with this code sees and can do.
        </span>
        {inv.briefing && <a className="ghost-btn small" href={inv.briefing} target="_blank" rel="noopener">AI briefing ↗</a>}
        <button className="ghost-btn small" onClick={() => setExpanded((v) => !v)}>{expanded ? "Hide" : "Show"} permissions</button>
        <button className="ghost-btn small" onClick={onLeave}>Leave preview</button>
      </div>
      {error && <p className="ai-seat-error">{error}</p>}
      {expanded && !error && <PermissionList app={app} role={inv.role} board={inv.board} />}
    </div>
  );
}
