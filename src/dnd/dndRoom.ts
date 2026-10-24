import { createContext, useContext } from "react";
import type { ConnStatus, Peer } from "../lib/roomClient";
export type { Peer };
import type { DndTabletopState, DndToken, PlayerProfile } from "./dndTabletop";
import type {
  CampaignInvite, DmNotice, IncomingRollRequest, LinkedCampaign, OutgoingRollRequest, RollRequest, RollVis,
} from "./dndProtocol";
import type { DndCharacter } from "./dndTypes";
import type { LogActor } from "../lib/auditLog";
import type { SessionChat } from "../components/useSessionChat";
import type { AiInvitesState } from "../components/useAiInvites";

export type OnlineState = {
  status: ConnStatus; code: string; you: Peer | null; peers: Peer[]; error?: string;
  /** Whether this room is hidden from the public Live games list. */
  isPrivate?: boolean;
};

// A shared dice roll (or coin/straw result) broadcast to the room.
export type SharedRoll = {
  id: string;
  ts: number;
  actor: { name: string; color: string };
  label: string;
  rolls: { sides: number; value: number }[];
  modifier: number;
  total: number;
  note?: string;
  /** "dm": a hidden DM roll, or a player's secret roll seen only by the DM. */
  vis?: "dm";
  /** Answer to a DM roll request. */
  requestId?: string;
  /** The request's DC, when the DM revealed it. */
  dc?: number;
  /** Set on receipt: the sender's connection id (absent = my own roll). */
  fromId?: string;
};
export type RollPayload = Omit<SharedRoll, "id" | "ts" | "actor" | "vis" | "requestId" | "dc" | "fromId">;
export type SendRollOpts = { vis?: RollVis; requestId?: string; dc?: number };

export type DndRoomValue = {
  // Board
  state: DndTabletopState;
  setBoard: React.Dispatch<React.SetStateAction<DndTabletopState>>;
  /** Wholesale board change (e.g. loading a saved map): logged as one
   * summary entry instead of a burst of per-token adds/removes. */
  replaceBoard: (update: (s: DndTabletopState) => DndTabletopState, summary: string) => void;
  readOnly: boolean;
  /** Set when the room server refused our last board change (too large). */
  syncWarning: string | null;
  clearSyncWarning: () => void;
  actor: LogActor;
  // Connection
  online: OnlineState | null;
  onlineOpen: boolean;
  setOnlineOpen: (v: boolean) => void;
  joinCode: string;
  setJoinCode: (v: string) => void;
  playerName: string;
  setPlayerName: (v: string) => void;
  playerColor: string;
  spectator: boolean;
  /** Host-time-only choice: keep the game off the public Live games list. */
  wantPrivate: boolean;
  setWantPrivate: (v: boolean) => void;
  /** My uploaded avatar image (data URL), or null if none set. */
  myAvatarUrl: string | null;
  setMyAvatar: (dataUrl: string | null) => void;
  /** blankBoard: start the new room from an empty board instead of
   * pushing whatever is on my local board (which may hold DM prep). */
  hostRoom: (opts?: { blankBoard?: boolean; campaignCode?: string }) => void;
  joinRoom: () => void;
  leaveRoom: () => void;
  changeIdentity: (spectator: boolean, color: string) => void;
  // Dice
  rollFeed: SharedRoll[];
  /** As DM, rolls default to hidden (see dmRollPublic). vis "dm" from a
   * player is a secret roll only the DM sees. */
  sendRoll: (payload: RollPayload, opts?: SendRollOpts) => void;
  clearRolls: () => void;
  // Shared character profiles
  myId: string | null;
  profiles: Record<string, PlayerProfile>;
  attachCharacter: (character: DndCharacter | null) => void;
  /** Shared player avatar images (data URLs), keyed by connection id. */
  avatars: Record<string, string>;

  // --- DM seat & campaign (protocol 2) ---
  /** Server protocol version (DM features need >= 2). */
  proto: number;
  isDm: boolean;
  dmPeer: Peer | null;
  claimDm: (opts?: { code?: string }) => void;
  releaseDm: () => void;
  dmNotice: DmNotice | null;
  clearDmNotice: () => void;
  linkedCampaign: LinkedCampaign | null;
  linkCampaign: (code: string) => void;
  unlinkCampaign: () => void;
  /** DM: invite the table to the linked campaign (player code only). */
  inviteToCampaign: (playerCode: string) => void;
  campaignInvites: CampaignInvite[];
  dismissInvite: (campaignId: string) => void;
  /** DM: show my rolls to the table (default: hidden). */
  dmRollPublic: boolean;
  setDmRollPublic: (v: boolean) => void;
  /** DM: ask chosen players for a roll. `dc` stays local unless revealed. */
  sendRollRequest: (to: string[], req: Omit<RollRequest, "id" | "dc">, dc?: number, revealDc?: boolean) => void;
  outgoingRequests: OutgoingRollRequest[];
  clearOutgoingRequests: () => void;
  /** Roll requests the DM sent me. */
  rollRequests: IncomingRollRequest[];
  dismissRollRequest: (id: string) => void;
  /** DM: tokens set aside off-board (e.g. a loaded map's monsters) until revealed. */
  staged: DndToken[];
  stageTokens: (tokens: DndToken[]) => void;
  revealStaged: (id: string | "all") => void;
  discardStaged: (id: string | "all") => void;
  /** Real-time chat for everyone in the game (kept across tab switches). */
  chat: SessionChat;
  /** AI invites: the ones I manage, and mine if I joined as an AI. */
  ai: AiInvitesState;
};

export const DndRoomCtx = createContext<DndRoomValue | null>(null);

export function useDndRoom(): DndRoomValue {
  const v = useContext(DndRoomCtx);
  if (!v) throw new Error("useDndRoom must be used inside <DndRoomProvider>");
  return v;
}

let rf = 0;
export function rollId(): string { rf = (rf + 1) % 100000; return `rf${Date.now().toString(36)}${rf}`; }
