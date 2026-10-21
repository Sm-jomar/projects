// D&D-specific room messages (protocol 2): the DM seat, campaign link,
// roll requests and invites. The shared RoomClient just passes these
// through as app messages.

import type { AbilityKey, SkillKey } from "./dndTypes";

export type RollVis = "table" | "dm";
export type RollKind = "skill" | "save" | "ability" | "initiative" | "custom";
export type RollMode = "normal" | "adv" | "dis";

export type RollRequest = {
  id: string;
  label: string;
  kind: RollKind;
  key?: SkillKey | AbilityKey;
  /** Dice expression for custom requests, e.g. "2d6+1". */
  dice?: string;
  /** Only present when the DM chose to reveal it. */
  dc?: number;
  mode: RollMode;
  /** Who sees the result: everyone, or just the DM (secret check). */
  vis: RollVis;
  note?: string;
};

export type IncomingRollRequest = RollRequest & { from: string; fromName: string; receivedAt: number };
/** The DM's own record of a request — keeps the DC even when hidden. */
export type OutgoingRollRequest = { req: RollRequest; dc?: number; to: string[]; sentAt: number };

export type CampaignInvite = { campaignId: string; name: string; code: string; from: string };
export type LinkedCampaign = { id: string; name: string };

export type DmNotice = { kind: "ok" | "err"; text: string };

const DENIED_TEXT: Record<string, string> = {
  "seat-taken": "Someone else is already the DM.",
  "seat-reserved": "The DM just disconnected — their seat is held for them for a minute.",
  "code-required": "This game runs a campaign: you need its owner or Co-DM code (add it under Campaigns) to be DM.",
  "bad-code": "That campaign code doesn't have DM access to this game's campaign.",
  "spectator": "Spectators can't be the DM — pick a color first.",
  "not-dm": "Only the DM can do that.",
  "no-dm": "There's no DM seated, so the secret roll stayed with you.",
  "not-dnd": "That only works in D&D games.",
};

export function deniedText(op: string, reason: string, retryAfterMs?: number): string {
  const base = DENIED_TEXT[reason] ?? `Couldn't ${op} (${reason}).`;
  if (reason === "seat-reserved" && retryAfterMs) return `${base} Try again in ${Math.ceil(retryAfterMs / 1000)}s.`;
  return base;
}

// The DM seat token, per room, kept for the browser tab session so a
// reload (or a dropped connection) gets the seat straight back.
const seatKey = (code: string) => `dnd.dmseat.${code.toUpperCase()}`;
export function readSeatToken(code: string): string | null {
  try { return sessionStorage.getItem(seatKey(code)); } catch { return null; }
}
export function writeSeatToken(code: string, token: string): void {
  try { sessionStorage.setItem(seatKey(code), token); } catch { /* storage unavailable */ }
}
export function clearSeatToken(code: string): void {
  try { sessionStorage.removeItem(seatKey(code)); } catch { /* storage unavailable */ }
}
