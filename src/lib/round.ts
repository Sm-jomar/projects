// End of a Legion round, shared by the End round button and the AI seats.

import { isStandingOrders, type CommandHand, type TabletopState } from "./tabletop";
import { endPhaseStatus } from "./statusTokens";
import { resetPools } from "./orderPool";

/** Discard each side's revealed card (Standing Orders goes back to hand),
 * clear the picks for the next round, ready and de-order every unit, drop
 * green tokens and 1 suppression, and put every order token back in the
 * pool, shuffled. */
export function endRound(state: TabletopState): TabletopState {
  const sweep = (h: CommandHand): CommandHand => ({
    ...h,
    cards: h.thisRound != null
      ? h.cards.map((c, i) => i === h.thisRound && !isStandingOrders(c) ? { ...c, played: true } : c)
      : h.cards,
    thisRound: null,
    locked: false,
  });
  return {
    ...state,
    round: state.round + 1,
    tokens: state.tokens.map((t) => endPhaseStatus({ ...t, activated: false, ordered: false })),
    hands: { blue: sweep(state.hands.blue), red: sweep(state.hands.red) },
    priorityRoll: null,
    orders: resetPools(state.orders),
  };
}
