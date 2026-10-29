# AI invites

An AI invite is a code that admits an AI (e.g. ChatGPT) to one game, as a
**player** or, in D&D, the **DM**. The code decides the role; the room
server (`worker/src/room.ts`) stamps the connection from it and enforces
its permissions. Anyone can open the code themselves with **Preview as AI**
to see exactly what an AI holding it gets: same server checks, same view.

Make one from the multiplayer panel while in a game: **Invite an AI**,
pick Player or DM, optionally a name, and (for a player) whether it may
move pieces. Each invite can be copied as a code or a link, previewed in a
new tab, or revoked.

## The code

`<ROOM>-AI-<SECRET>`, e.g. `K7QM2P-AI-9F3XW2HDQA`. Paste it in the Join box
(no name needed) or open `/dnd?room=<ROOM>&ai=<CODE>` (`/legion?…` for
Legion), which joins straight away. A room holds at most 8 invites.

## Who can manage invites

- A person at the table: not a spectator, not an AI.
- D&D: once a person holds the DM seat, only that DM. While an AI holds
  the seat, any person can, so the table can always revoke an AI DM.
- A **DM** invite can only be made by the current DM. Joining with it
  hands the seat to the AI (the person who had it is told why), skipping
  the campaign-code check because the DM chose to hand it over.

Revoking deletes the invite, disconnects anyone using it (`denied`
`ai-invite-revoked`) and, if that was the DM, frees the seat at once.

## What an AI may do

| | D&D player | D&D DM | Legion player |
| --- | --- | --- | --- |
| Chat (lines tagged AI / AI DM) | ✓ | ✓ | ✓ |
| Roll dice, secret rolls to the DM | ✓ | hidden DM rolls | ✓ |
| Change the board | if the invite allows | ✓ | if the invite allows |
| Roll requests | answer them | send them | — |
| Take / be the DM seat | ✕ | ✓ (seated on join) | — |
| Link, unlink or hand out campaign codes | ✕ | ✕ | — |
| Change its name or colour/side | ✕ | ✕ | ✕ |
| Create or revoke AI invites | ✕ | ✕ | ✕ |

A Legion AI takes a free side (blue, then red), else watches. Even without
"move pieces" it plays its own side: it can build its own unit list (the
tabletop offers **Build my own list ↗**, or it picks a saved or imported
one), pick and lock in command cards, and draw and give out order tokens.
The room keeps only those parts of such an AI's board snapshot (its
side's `hands`, `orders`, the `orders.turn`, `priorityRoll` and the
`ordered` flag on its own units; `mergeLegionSide` in `room.ts`) and sends
the merged board back to everyone, the AI included. The labels
shown in the app come from `aiPermissions()` in `src/lib/aiInvite.ts`;
keep them in step with the checks in `room.ts`.

Fog of war is drawn by the client: the board snapshot a connection
receives holds every token. Fine for previewing; an AI adapter that reads
the raw board should apply the player's fog itself before handing it on.

## Protocol

Connect: `/api/room/<ROOM>/ws?app=dnd|legion&v=2&ai=<CODE>`. An unknown
or revoked code gets `{t:"denied", reason:"ai-invite-invalid"}`.

The welcome carries `ai: {id, code, role, name, board, by, createdAt}`, and
every peer joined with an invite has `ai: "player"|"dm"` and `aiInvite`
(the invite id). Chat lines from it have `from.kind: "ai"`.

Client → server (people only):

| message | meaning |
| --- | --- |
| `{t:"aiInviteCreate", role, name?, board?}` | Mint an invite; answered with `aiInvites`. |
| `{t:"aiInviteList"}` | Answered with `{t:"aiInvites", invites}`. |
| `{t:"aiInviteRevoke", id}` | Delete one; answered with `aiInvites`. |

Refusals are `{t:"opDenied", op, reason}` with reasons `not-allowed`,
`not-dm`, `not-dnd`, `ai-role`, `ai-fixed`, `ai-no-board` and
`ai-too-many` (texts in `AI_DENIED_TEXT`).

## Command cards and order tokens (Legion)

All of it lives in the board snapshot (`TabletopState`, see
`src/lib/tabletop.ts`):

- `hands.blue` / `hands.red`: `{cards, thisRound, locked?, listName?}`.
  Each card is `{pips, played, id?, name?}`; `id` is a command card from
  `src/data/command-cards.json` when the hand was picked for a list
  (six cards, two of each pip value, plus Standing Orders), and missing
  for the plain 1,1,2,2,3,3,4 pip deck.
- Each round a side picks a card, then sets `locked: true` with
  `thisRound: null`. The chosen index stays with that player (the app keeps
  it in localStorage); nothing in the board says which card it is. Once
  both sides are locked, each side sets its own `thisRound` to reveal.
  An adapter must do the same: lock first, reveal only after the other
  side is locked.
- Priority: fewer pips wins (`prioritySide` in `src/lib/orderPool.ts`).
  On a tie, `priorityRoll: {blue, red}` holds the roll-off.
- End round discards each revealed card (`played: true`) except Standing
  Orders, which goes back to hand, and clears `locked`/`thisRound`.
- `orders`: each side's order token pool and whose draw it is (see
  `src/lib/orderPool.ts`).

## Briefing

When an AI joins Legion with a code, the welcome's `ai.briefing` is
`/ai/legion-briefing.md` (`public/ai/`): how the game runs, what's legal
and what isn't, and a request to save what it learns for next time. The
preview banner links it as **AI briefing ↗**. The built-in Claude player
uses the same file as its system prompt, so keep it in step with the
rules the Legion adapter plays by.

## Let Claude play (built-in AI player)

Each player invite with **Can move pieces** has **▶ Let Claude play** and
an army picker (a starter force per faction, or a saved list). Pressing it
runs an AI seat in that tab: its own room connection with the code, held to
the same server checks as any AI. Do it for two invites and the two AIs
play a whole game. If both sides are taken, the button becomes **Let
Claude play (you watch)** and moves you to spectator first. Seats stop
when the tab closes or the room changes; a bar above the board shows what
each one is doing.

The code is split so other games can reuse it:

- `src/lib/ai/seat.ts`: the seat. Joins with the code, watches the board,
  asks the adapter for the next step, asks the brain to pick, pushes the
  result and posts its chat lines (spaced under the room's chat limit).
- `src/lib/ai/brain.ts`: `claudeBrain` asks the room server; when that
  fails it falls back to the adapter's built-in tactics (the option with
  the best score), so a game never stalls. It also keeps the AI's notebook
  (lessons from earlier games, in localStorage by AI name) and sends it
  with every question.
- `src/lib/ai/legion.ts` (+ `legionArmy`, `legionCombat`, `legionGeometry`):
  the Legion adapter. Setup (deploy a list in its Territory, take order
  tokens and a command hand; blue first), command cards (lock in, reveal
  once both are locked, roll off ties), activations (draw, give the token
  to a unit of that rank, up to two actions: move, attack, aim, dodge,
  recover), End phase (score the objectives, `endRound` from
  `src/lib/round.ts`, after round 6 or a wipe-out set `result`). Blue's AI
  ends rounds and declares the result when blue is an AI. Attacks roll the
  app's dice with aim, surges, Critical/Impact/Pierce, Armor, cover from
  terrain in the way, dodge and suppression; wounds go on one mini at a time.
- A D&D adapter can implement the same `GameAdapter` (`src/lib/ai/types.ts`).

### The Claude endpoint

`POST /api/room/<ROOM>/ai` with `{code, app, observation, notes, decision:
{kind, question, options:[{id,label}]}}` answers `{id, say?}`.
`worker/src/aiBrain.ts` asks Claude (`claude-opus-5-5`, low effort,
server-side refusal fallback) to call a `choose` tool with one of the
option ids. RoomDO only lets it through for a live invite whose AI is
connected on a side, and rate-limits it (40 a minute per seat, 100 per
room). Errors: `403 ai-invite-invalid`, `409 ai-not-seated`, `429
rate-limited`, `503 no-key` (no `ANTHROPIC_API_KEY` secret: the seats play
with built-in tactics), `502` for API failures.

Worker settings: secret `ANTHROPIC_API_KEY` (required for Claude); vars
`AI_MODEL` and `ANTHROPIC_BASE_URL` (optional). For local dev put them in
`.dev.vars`.

## Not built yet

An adapter for outside AIs (ChatGPT and the like) that holds the socket for
them or a small HTTP API on the same checks, and a D&D game adapter for the
built-in player.
