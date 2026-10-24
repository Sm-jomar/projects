import { useState } from "react";
import type { Peer, RoomApp } from "../lib/roomClient";
import { AI_DENIED_TEXT, parseAiInvite, type AiInvite, type AiRole } from "../lib/aiInvite";

type AppSender = { sendApp: (msg: { t: string } & Record<string, unknown>) => void };

export type AiInvitesState = {
  /** Invites for this game (only filled for someone who may manage them). */
  invites: AiInvite[];
  /** The invite I joined with, when I'm connected as an AI. */
  self: AiInvite | null;
  notice: string | null;
  /** Feed a server app message; true if it was an AI-invite one. */
  handle: (msg: Record<string, unknown>) => boolean;
  onWelcome: (extra: Record<string, unknown>) => void;
  create: (role: AiRole, name: string, board: boolean) => void;
  revoke: (id: string) => void;
  refresh: () => void;
  reset: () => void;
};

// AI invites for one tabletop's room connection. Like useSessionChat, the
// app owns the RoomClient and routes messages here.
export function useAiInvites(getClient: () => AppSender | null): AiInvitesState {
  const [invites, setInvites] = useState<AiInvite[]>([]);
  const [self, setSelf] = useState<AiInvite | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handle(msg: Record<string, unknown>): boolean {
    if (msg.t === "aiInvites") {
      const list = Array.isArray(msg.invites) ? msg.invites.map(parseAiInvite).filter((x): x is AiInvite => !!x) : [];
      setInvites(list);
      setNotice(null);
      return true;
    }
    if (msg.t === "opDenied" && (String(msg.op).startsWith("aiInvite") || String(msg.reason).startsWith("ai-"))) {
      const reason = String(msg.reason);
      setNotice(AI_DENIED_TEXT[reason] ?? (reason === "not-dm" ? "Only the DM can invite an AI DM." : `Couldn't do that (${reason}).`));
      return true;
    }
    return false;
  }

  return {
    invites, self, notice, handle,
    onWelcome: (extra) => setSelf(parseAiInvite(extra.ai)),
    create: (role, name, board) => { setNotice(null); getClient()?.sendApp({ t: "aiInviteCreate", role, name, board }); },
    revoke: (id) => getClient()?.sendApp({ t: "aiInviteRevoke", id }),
    refresh: () => getClient()?.sendApp({ t: "aiInviteList" }),
    reset: () => { setInvites([]); setSelf(null); setNotice(null); },
  };
}

/** Who may manage AI invites, mirroring the server's canManageAi(). */
export function canManageAiInvites(app: RoomApp, you: Peer | null, peers: Peer[]): boolean {
  if (!you || you.ai || you.color === "spectator") return false;
  if (app === "dnd" && !you.dm && peers.some((p) => p.dm && !p.ai)) return false;
  return true;
}
