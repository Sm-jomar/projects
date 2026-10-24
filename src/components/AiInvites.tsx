import { useState } from "react";
import type { Peer, RoomApp } from "../lib/roomClient";
import { aiJoinUrl, aiPermissions, aiRoleLabel, type AiRole } from "../lib/aiInvite";
import { canManageAiInvites, type AiInvitesState } from "./useAiInvites";
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
export function AiInvitePanel({ app, ai, you, peers }: {
  app: RoomApp; ai: AiInvitesState; you: Peer | null; peers: Peer[];
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
      {open && canManage && (
        <div className="ai-inv-body">
          <p className="muted small">
            Make a code that lets an AI (like ChatGPT) join this game. Open it yourself
            with <b>Preview as AI</b> to see exactly what it can do.
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
        <button className="ghost-btn small" onClick={() => setExpanded((v) => !v)}>{expanded ? "Hide" : "Show"} permissions</button>
        <button className="ghost-btn small" onClick={onLeave}>Leave preview</button>
      </div>
      {error && <p className="ai-seat-error">{error}</p>}
      {expanded && !error && <PermissionList app={app} role={inv.role} board={inv.board} />}
    </div>
  );
}
