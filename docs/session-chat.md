# Session chat

Both tabletops (Legion and D&D) have a real-time chat for everyone connected
to the same game. It rides on the existing room WebSocket
(`/api/room/<CODE>/ws`, `worker/src/room.ts`), so there is no new endpoint.

## Protocol

Client → server:

| message | meaning |
| --- | --- |
| `{t:"chat", text, cid}` | Post a line. `text` is trimmed, capped at 1000 chars. `cid` is the sender's own id for the line. |
| `{t:"chatHistory", before?, limit?}` | Ask for up to `limit` (max 200) messages older than seq `before`, or the newest. |

Server → client:

| message | meaning |
| --- | --- |
| `welcome.chat`, `welcome.chatMore` | The newest 50 messages on joining, and whether older ones exist. |
| `{t:"chat", msg}` | A new line, sent to everyone **including the sender** (the sender matches it to its pending copy by `cid`). |
| `{t:"chatHistory", before, messages, more}` | A page of older messages, oldest first. |
| `{t:"chatDenied", cid, reason, retryAfterMs?}` | The line was dropped (`reason: "rate"`: more than 8 lines in 10 s). |

A stored message:

```json
{ "seq": 12, "ts": 1792647740585, "text": "Roll for initiative!",
  "from": { "id": "6ajfia9i", "name": "Sean", "color": "#4a86c8", "role": "dm", "kind": "human" } }
```

`from` is stamped by the server from the socket, never taken from the
client, so nobody can post as someone else. `role` is `player`, `dm` (the
D&D DM seat) or `spectator`.

## Storage and recall

- The room keeps the newest 1000 messages (one storage key per message), so
  anyone who joins or reconnects gets the backlog and can scroll back.
- Each device also keeps its own copy of each game's chat in localStorage
  (newest 20 games, 1000 messages each). The **Saved** view in the chat
  window lists them, so a log can be read after leaving the game.
- The **⤓** button saves the log as `.txt` (readable) or `.json` (data).
  For a live game it first pages in the whole stored log from the server.

## Future: AI players and DMs

Planned: an AI (e.g. ChatGPT) joins a game as a DM or a player, decided by
the invite code it's given. The chat is built so this slots in without a
protocol change:

- `from.kind` is already part of every message. Today it is always
  `"human"`; an AI connection will be stamped `"ai"` by the server, and the
  chat window already labels those lines (**AI** / **AI DM**).
- The role comes from the server's view of the connection (`role`), not the
  message. An AI admitted with a DM invite would hold the DM seat the same
  way a person does (D&D `claimDm` with a campaign code), so its lines show
  as DM lines.
- What's still needed: role-scoped invite codes for agents (e.g. a code that
  admits one AI as "player" or "dm" in one room), a server-side flag on the
  socket attachment (`kind: "ai"`), and an adapter that connects the AI to
  the room — either a WebSocket bridge or a small HTTP API
  (`POST /api/room/<CODE>/chat`, `GET …/chat?after=<seq>`) authenticated by
  that invite. The `chatHistory` paging already gives an agent a way to
  catch up on context.
