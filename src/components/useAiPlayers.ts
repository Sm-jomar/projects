import { useEffect, useRef, useState } from "react";
import type { RoomApp } from "../lib/roomClient";
import type { AiInvite } from "../lib/aiInvite";
import { AiSeat, type SeatStatus } from "../lib/ai/seat";
import { claudeBrain, notesFor } from "../lib/ai/brain";
import type { GameAdapter } from "../lib/ai/types";

export type AiArmyOption = { key: string; label: string };

export type AiPlayersState = {
  /** Status of each AI seat running in this tab, by invite id. */
  running: Record<string, SeatStatus>;
  /** What each seat can field, for the picker ("auto" first). */
  armies: AiArmyOption[];
  start: (inv: AiInvite, armyKey: string) => void;
  stop: (id: string) => void;
};

// "Let Claude play": AI seats run in this tab, one per invite, each with
// its own room connection. Seats stop when the room changes or the
// tabletop closes. The game supplies the adapter (Legion today).
export function useAiPlayers<S>(
  app: RoomApp,
  room: string | null,
  armies: AiArmyOption[],
  makeAdapter: (armyKey: string) => GameAdapter<S>,
): AiPlayersState {
  const seats = useRef(new Map<string, AiSeat<S>>());
  const [running, setRunning] = useState<Record<string, SeatStatus>>({});

  useEffect(() => {
    const live = seats.current;
    return () => {
      for (const s of live.values()) s.stop();
      live.clear();
      setRunning({});
    };
  }, [room]);

  function start(inv: AiInvite, armyKey: string) {
    if (!room || seats.current.has(inv.id)) return;
    let fallback: string | null = null;
    const seat = new AiSeat<S>({
      app, room, aiCode: inv.code,
      adapter: makeAdapter(armyKey),
      brain: claudeBrain({
        app, room, aiCode: inv.code,
        notes: () => notesFor(app, inv.name),
        onFallback: (reason) => { fallback = reason; },
      }),
      onStatus: (st) => setRunning((r) => (seats.current.has(inv.id) ? { ...r, [inv.id]: { ...st, fallback } } : r)),
    });
    seats.current.set(inv.id, seat);
    seat.start();
  }

  function stop(id: string) {
    seats.current.get(id)?.stop();
    seats.current.delete(id);
    setRunning((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }

  return { running, armies, start, stop };
}
