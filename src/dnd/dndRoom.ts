import { createContext, useContext } from "react";
import type { ConnStatus, Peer } from "../lib/roomClient";
import type { DndTabletopState, PlayerProfile } from "./dndTabletop";
import type { DndCharacter } from "./dndTypes";
import type { LogActor } from "../lib/auditLog";

export type OnlineState = { status: ConnStatus; code: string; you: Peer | null; peers: Peer[]; error?: string };

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
};
export type RollPayload = Omit<SharedRoll, "id" | "ts" | "actor">;

export type DndRoomValue = {
  // Board
  state: DndTabletopState;
  setBoard: React.Dispatch<React.SetStateAction<DndTabletopState>>;
  readOnly: boolean;
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
  hostRoom: () => void;
  joinRoom: () => void;
  leaveRoom: () => void;
  changeIdentity: (spectator: boolean, color: string) => void;
  // Dice
  rollFeed: SharedRoll[];
  sendRoll: (payload: RollPayload) => void;
  clearRolls: () => void;
  // Shared character profiles
  myId: string | null;
  profiles: Record<string, PlayerProfile>;
  attachCharacter: (character: DndCharacter | null) => void;
};

export const DndRoomCtx = createContext<DndRoomValue | null>(null);

export function useDndRoom(): DndRoomValue {
  const v = useContext(DndRoomCtx);
  if (!v) throw new Error("useDndRoom must be used inside <DndRoomProvider>");
  return v;
}

let rf = 0;
export function rollId(): string { rf = (rf + 1) % 100000; return `rf${Date.now().toString(36)}${rf}`; }
