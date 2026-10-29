// AI invites: role-scoped codes that admit an AI to a game as a player or
// (D&D) the DM. The room server mints them, stamps a connection that joins
// with one (name, role, kind "ai") and enforces what it may do — see
// worker/src/room.ts and docs/ai-invites.md. This file is the client's
// half: parsing a pasted code and describing the permissions for display.

import type { RoomApp } from "./roomClient";

export type AiRole = "player" | "dm";

/** An invite as the server lists it (to the people who manage invites). */
export type AiInvite = {
  id: string;
  /** The full code to hand an AI: `<ROOM>-AI-<SECRET>`. */
  code: string;
  role: AiRole;
  name: string;
  /** May change the board (always true for a DM). */
  board: boolean;
  by: string;
  createdAt: number;
};

const AI_CODE_RE = /^([A-Z0-9]{4,12})-AI-([A-Z0-9]{8,24})$/;

/** Split a full AI code into its room code, or null if it isn't one. */
export function parseAiCode(raw: string): { room: string; code: string } | null {
  const v = raw.trim().toUpperCase();
  const m = AI_CODE_RE.exec(v);
  return m ? { room: m[1]!, code: v } : null;
}

export function parseAiInvite(raw: unknown): AiInvite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.code !== "string") return null;
  return {
    id: r.id, code: r.code,
    role: r.role === "dm" ? "dm" : "player",
    name: typeof r.name === "string" ? r.name : "AI",
    board: r.board === true,
    by: typeof r.by === "string" ? r.by : "",
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
  };
}

/** A link that opens the app and joins the game with this AI code. */
export function aiJoinUrl(app: RoomApp, code: string): string {
  const parsed = parseAiCode(code);
  const u = new URL(app === "dnd" ? "/dnd" : "/legion", location.origin);
  if (parsed) u.searchParams.set("room", parsed.room);
  u.searchParams.set("ai", code);
  return u.toString();
}

/** The AI code in this page's URL (?ai=…), if any. */
export function aiCodeFromUrl(): string | null {
  const v = new URLSearchParams(location.search).get("ai");
  return v && parseAiCode(v) ? v.toUpperCase() : null;
}

export type AiPermission = { label: string; allowed: boolean };

/** What an AI joined with this kind of invite can and can't do. Mirrors the
 * server's checks in room.ts — keep the two in step. */
export function aiPermissions(app: RoomApp, role: AiRole, board: boolean): AiPermission[] {
  const canBoard = role === "dm" || board;
  if (app === "legion") {
    return [
      { label: "Read and post in the session chat (lines tagged AI)", allowed: true },
      { label: "See the board, the players and the dice", allowed: true },
      { label: "Play a free side (blue or red), else watch", allowed: true },
      { label: "Move units, terrain and tokens on the board", allowed: canBoard },
      { label: "Roll dice for the table", allowed: true },
      { label: "Build its own unit list, or use a saved or imported one", allowed: true },
      { label: "Pick, lock in and reveal its side's command cards", allowed: true },
      { label: "Draw and give out its side's order tokens", allowed: true },
      { label: "Change its name or side", allowed: false },
      { label: "Create or revoke AI invites", allowed: false },
    ];
  }
  if (role === "dm") {
    return [
      { label: "Read and post in the session chat (lines tagged AI DM)", allowed: true },
      { label: "Hold the DM seat (it takes the seat when it joins)", allowed: true },
      { label: "Edit the board: tokens, map, fog of war, initiative", allowed: true },
      { label: "Make hidden DM rolls and see players' secret rolls", allowed: true },
      { label: "Ask players for rolls", allowed: true },
      { label: "Link, unlink or hand out campaign codes", allowed: false },
      { label: "Change its name or colour", allowed: false },
      { label: "Create or revoke AI invites", allowed: false },
    ];
  }
  return [
    { label: "Read and post in the session chat (lines tagged AI)", allowed: true },
    { label: "See the board as a player sees it (fog of war applies)", allowed: true },
    { label: "Roll dice for the table, or secretly to the DM", allowed: true },
    { label: "Answer the DM's roll requests", allowed: true },
    { label: "Move tokens and edit the board", allowed: canBoard },
    { label: "Take the DM seat", allowed: false },
    { label: "Link campaigns or see campaign codes", allowed: false },
    { label: "Change its name or colour", allowed: false },
    { label: "Create or revoke AI invites", allowed: false },
  ];
}

// Why the server refused an AI-related request (opDenied / denied reasons).
export const AI_DENIED_TEXT: Record<string, string> = {
  "not-allowed": "Only the DM can manage AI invites while a DM is seated.",
  "ai-role": "An AI's role is set by its invite, so it can't do that.",
  "ai-fixed": "An AI's name and colour are set by its invite.",
  "ai-no-board": "This AI invite doesn't allow changing the board, so that change stayed on this screen.",
  "ai-too-many": "This game already holds the most AI invites it can (8). Revoke one first.",
  "ai-invite-invalid": "That AI invite code isn't valid for this game (it may have been revoked).",
  "ai-invite-revoked": "This AI invite was revoked, so the AI was removed from the game.",
};

export function aiRoleLabel(role: AiRole): string {
  return role === "dm" ? "AI DM" : "AI player";
}
