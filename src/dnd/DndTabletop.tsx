import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  downscaleImage, initiativeOrder, makeToken, makeTerrain, DND_TERRAIN_PRESETS,
  type DndTabletopState, type DndTerrain, type DndToken,
} from "./dndTabletop";
import { useCharacters } from "./useCharacters";
import { loadCharacter, saveCharacter } from "./dndStorage";
import { CharacterModelControls, ImportSheetsButton } from "./CharacterFiles";
import { importSummary } from "./characterImport";
import type { PlayerProfile } from "./dndTabletop";
import { dndPlayUrl, roomsAvailableHere } from "../lib/appRouting";
import type { LogEntry } from "../lib/auditLog";
import { AuditLogView } from "../components/AuditLogView";
import { RollFeed } from "./RollFeed";
import { ChatButton, ChatDock } from "../components/ChatDock";
import { useChatToggle } from "../components/useSessionChat";
import { MediaButton, MediaDock } from "../components/MediaPlayer";
import { useMediaPlayback, useMediaToggle } from "../components/useMediaPlayer";
import { parseTableMusic } from "../lib/media";
import { CharacterSheetView } from "./CharacterSheetView";
import { useDndRoom, type OnlineState } from "./dndRoom";
import { CampaignMapsPanel } from "./CampaignMapLibrary";
import { RollRequestBanner } from "./RollRequestBanner";
import { AiInvitePanel, AiSeatBanner } from "../components/AiInvites";
import { parseAiCode } from "../lib/aiInvite";
import { useKeyring } from "./useCampaign";
import { canEdit } from "./campaign";
import { bestCodeFor } from "./campaignKeyring";
import { ConditionsPanel } from "./ConditionsPanel";
import { conditionColors, conditionSummary, ringArc } from "./dndConditions";
import { computeFog, isMyToken, pointInPolygon, polysPath, terrainSeen, type FogMode, type FogView, type Pt } from "./dndFog";

// three.js is only fetched once someone switches the board into 3D.
const Dnd3D = lazy(() => import("./Dnd3D"));

const U = 48; // SVG units per grid cell
const SIDE_KEY = "dnd.ttSideCollapsed";

function readSideCollapsed(): boolean {
  try { return localStorage.getItem(SIDE_KEY) === "1"; } catch { return false; }
}
function writeSideCollapsed(v: boolean) {
  try { localStorage.setItem(SIDE_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
}

export function DndTabletop() {
  // Connection + board state live in the app-level room context so they
  // survive tab switches and are shared with the dice roller.
  const room = useDndRoom();
  const { state, setBoard, readOnly, online } = room;
  const chatToggle = useChatToggle(room.chat, room.myId);
  const mediaToggle = useMediaToggle("dnd");
  const music = parseTableMusic(state.music);
  const media = useMediaPlayback(music);
  // With a DM seated, the DM runs the music; otherwise any player can.
  const canSetMusic = !readOnly && (!room.dmPeer || room.isDm);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chars = useCharacters();
  const [sideCollapsed, setSideCollapsed] = useState(() => readSideCollapsed());
  const [warn, setWarn] = useState<string | null>(null);
  const [viewProfile, setViewProfile] = useState<PlayerProfile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenIconFileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const [view3d, setView3d] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);

  const connected = online?.status === "open";
  const myProfile = room.myId ? room.profiles[room.myId] : undefined;

  const [ghost, setGhost] = useState<LogEntry["move"] | null>(null);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showGhost(m: LogEntry["move"]) {
    if (!m) return;
    setGhost(m);
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 5000);
  }

  // --- Fog of war ---------------------------------------------------------
  // The DM (or anyone playing solo) sees everything, with the parts the
  // party can't see shaded. Players see only through their own PCs (or
  // every PC with shared vision); spectators see what the party sees.
  const fogOn = !!state.fog?.on;
  const [previewFog, setPreviewFog] = useState(false);
  const seesAll = !connected || room.isDm;
  const amSpectator = connected && online?.you?.color === "spectator";
  const myColor = connected && online?.you && !amSpectator ? online.you.color : null;
  const fogMode: FogMode = !fogOn ? "off" : seesAll && !previewFog ? "dm" : "player";
  const pcs = state.tokens.filter((t) => t.kind === "pc");
  const viewerTokens = seesAll || amSpectator || state.fog?.sharedVision
    ? pcs
    : pcs.filter((t) => isMyToken(t, myColor, myProfile?.charId ?? null));
  const viewerKey = viewerTokens.map((t) => `${t.id}:${t.x},${t.y},${t.elevation ?? 0},${t.sight ?? ""}`).join("|");
  const fog = useMemo(
    () => (fogOn ? computeFog(state, viewerTokens) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fogOn, viewerKey, state.tokens, state.terrain, state.map.cols, state.map.rows],
  );
  // Ground a player has seen stays dimly visible once they move on (this
  // device only; tokens there stay hidden). Forgotten on a new map.
  const exploreScope = `${state.map.imageUrl?.slice(-64) ?? ""}|${state.map.cols}x${state.map.rows}|${fogMode}`;
  const [explored, setExplored] = useState<{ scope: string; key: string; polys: Pt[][] }>({ scope: "", key: "", polys: [] });
  const exploreKey = viewerKey + "|" + (state.terrain ?? []).length;
  if (fog && fogMode === "player" && (explored.scope !== exploreScope || explored.key !== exploreKey)) {
    const prev = explored.scope === exploreScope ? explored.polys : [];
    setExplored({ scope: exploreScope, key: exploreKey, polys: [...prev, ...fog.vision].slice(-120) });
  }
  const hiddenFromMe = (t: DndToken) => fogMode === "player" && !!fog && !fog.seen.has(t.id);
  const boardView: DndTabletopState = fogMode === "player" ? { ...state, tokens: state.tokens.filter((t) => !hiddenFromMe(t)) } : state;
  const exploredPolys = fogMode === "player" && explored.scope === exploreScope ? explored.polys : null;
  const fogView = useMemo<FogView | null>(
    () => (fog && fogMode !== "off"
      ? { mode: fogMode, vision: fog.vision, explored: exploredPolys ?? [], noViewers: fog.viewers.length === 0 }
      : null),
    [fog, fogMode, exploredPolys],
  );
  const canSetFog = seesAll || (connected && !room.dmPeer);

  const selected = boardView.tokens.find((t) => t.id === selectedId) ?? null;
  const selectedTerrain = (state.terrain ?? []).find((t) => t.id === selectedId) ?? null;
  const order = initiativeOrder(state.tokens);

  // setBoard is guarded by the context (no-ops for spectators).
  function patch(p: Partial<DndTabletopState>) { setBoard((s) => ({ ...s, ...p })); }
  function patchMap(p: Partial<DndTabletopState["map"]>) { setBoard((s) => ({ ...s, map: { ...s.map, ...p } })); }
  function updateToken(id: string, p: Partial<DndToken>) {
    setBoard((s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  }
  function removeToken(id: string) {
    setBoard((s) => ({ ...s, tokens: s.tokens.filter((t) => t.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function updateTerrain(id: string, p: Partial<DndTerrain>) {
    setBoard((s) => ({ ...s, terrain: (s.terrain ?? []).map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  }
  function removeTerrain(id: string) {
    setBoard((s) => ({ ...s, terrain: (s.terrain ?? []).filter((t) => t.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }
  function addTerrain(preset: typeof DND_TERRAIN_PRESETS[number]) {
    if (readOnly) return;
    const tr = makeTerrain(state, preset);
    setBoard((s) => ({ ...s, terrain: [...(s.terrain ?? []), tr] }));
    setSelectedId(tr.id);
  }

  function addToken(partial: Partial<DndToken>) {
    if (readOnly) return;
    const tk = makeToken(state, partial);
    setBoard((s) => ({ ...s, tokens: [...s.tokens, tk] }));
    setSelectedId(tk.id);
  }

  /** Place a saved character as a PC token, centred on `at` (cells) when
   * it was dropped on the board. Its STL miniature comes along. */
  function addFromCharacter(charId: string, at?: { x: number; y: number }) {
    const c = chars.find((x) => x.id === charId);
    if (!c) return;
    addToken({
      name: c.name || "PC",
      kind: "pc",
      charId: c.id,
      hpMax: c.hpMax || undefined,
      hpCurrent: (c.hpCurrent || c.hpMax) || undefined,
      speed: parseInt(c.speed, 10) || undefined,
      color: "#4a86c8",
      ...(c.modelStl ? { modelStl: c.modelStl, modelName: c.modelName } : {}),
      ...(at ? { x: Math.round((at.x - 0.5) * 2) / 2, y: Math.round((at.y - 0.5) * 2) / 2 } : {}),
    });
  }
  const onBoardChars = new Set(state.tokens.map((t) => t.charId).filter(Boolean));

  async function onMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      // Smaller for multiplayer-friendliness — the map rides along in the
      // synced room state.
      const dataUrl = await downscaleImage(f, 1200, 0.72);
      patchMap({ imageUrl: dataUrl });
    } catch {
      setWarn("Could not read that image.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Your avatar rides the same synced board state as everything else, so
  // keep it small — even a full party's worth is negligible at this size.
  async function onAvatarFile(file: File) {
    try {
      const dataUrl = await downscaleImage(file, 200, 0.78);
      room.setMyAvatar(dataUrl);
    } catch {
      setWarn("Could not read that image.");
    }
  }

  // Token icons ride the same synced board state as everything else, so
  // keep them small — several tokens' worth shouldn't threaten the 2MB cap.
  async function onTokenIconFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const id = selected?.id;
    if (!f || !id) return;
    try {
      const dataUrl = await downscaleImage(f, 256, 0.8);
      updateToken(id, { avatarUrl: dataUrl });
    } catch {
      setWarn("Could not read that image.");
    } finally {
      if (tokenIconFileRef.current) tokenIconFileRef.current.value = "";
    }
  }

  // STL models (up to 500k triangles) are uploaded to the site's model
  // store and the token only carries a reference, so everyone in the game
  // loads the same model without it crowding the synced board.
  async function onModelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const id = selected?.id ?? selectedTerrain?.id;
    if (!f || !id) return;
    if (f.size > 80 * 1024 * 1024) { setWarn("That STL is over 80 MB — export a lighter version."); return; }
    setModelBusy(true);
    try {
      const { encodeStlFile } = await import("../lib/stlModel");
      const m = await encodeStlFile(f);
      if (selectedTerrain && selectedTerrain.id === id) {
        // Reshape the block to the model's proportions, keeping its width:
        // depth follows the model's footprint, height its height (5 ft/cell).
        const w = selectedTerrain.w;
        const d = selectedTerrain.shape === "circle" ? w : Math.max(0.25, Math.round((w * m.size.z / m.size.x) * 4) / 4);
        const height = Math.max(1, Math.round((m.size.y / Math.max(m.size.x, m.size.z)) * Math.max(w, d) * 5));
        updateTerrain(id, { modelStl: m.data, modelName: f.name, d, height });
      } else {
        updateToken(id, { modelStl: m.data, modelName: f.name });
        // A PC placed from one of my sheets keeps the model on the sheet too.
        const charId = selected?.charId;
        const sheet = charId ? loadCharacter(charId) : undefined;
        if (sheet) saveCharacter({ ...sheet, modelStl: m.data, modelName: f.name });
      }
      setWarn(m.shared ? null : `Couldn't reach the model server, so ${f.name} was trimmed to ${m.triangles.toLocaleString()} triangles to fit the board.`);
      setView3d(true);
    } catch (err) {
      setWarn(err instanceof Error && err.message ? err.message : "Could not read that STL file.");
    } finally {
      setModelBusy(false);
      if (modelFileRef.current) modelFileRef.current.value = "";
    }
  }

  function nextTurn() {
    if (order.length === 0) return;
    const i = order.findIndex((t) => t.id === state.activeTokenId);
    if (i === -1) { patch({ activeTokenId: order[0]!.id }); return; }
    const ni = (i + 1) % order.length;
    patch({
      activeTokenId: order[ni]!.id,
      round: ni === 0 ? state.round + 1 : state.round,
    });
  }

  return (
    <div className="dnd-section dnd-tabletop">
      <div className="dnd-section-head">
        <h2>Tabletop</h2>
        {warn && <span className="dnd-tt-warn small">{warn}</span>}
        {room.syncWarning && (
          <span className="dnd-tt-warn small dnd-tt-syncwarn">
            {room.syncWarning} <button className="ghost-btn small" onClick={room.clearSyncWarning}>×</button>
          </span>
        )}
        <button className={"ghost-btn small dnd-tt-3d-toggle" + (view3d ? " active" : "")}
                onClick={() => setView3d((v) => !v)}
                title={view3d ? "Back to the flat board" : "See height and depth in 3D"}>
          {view3d ? "2D view" : "3D view"}
        </button>
        <MediaButton toggle={mediaToggle} playing={!!media.playing} className="ghost-btn small dnd" />
        <ChatButton toggle={chatToggle} className="ghost-btn small dnd" />
        <button className="ghost-btn small dnd-tt-side-toggle"
                onClick={() => { const v = !sideCollapsed; setSideCollapsed(v); writeSideCollapsed(v); }}
                title={sideCollapsed ? "Show the board tools" : "Hide the board tools for a bigger board"}>
          {sideCollapsed ? "◂ Tools" : "Tools ▸"}
        </button>
        <div className="dnd-mp-wrap">
          <button className={"dnd-mp-btn" + (online?.status === "open" ? " live" : "")}
                  onClick={() => room.setOnlineOpen(!room.onlineOpen)}>
            {online?.status === "open" ? `● ${online.code}` : online ? "● connecting…" : "Multiplayer"}
          </button>
          {room.onlineOpen && (
            <MultiplayerPanel
              online={online}
              joinCode={room.joinCode} onJoinCodeChange={room.setJoinCode}
              playerName={room.playerName} onNameChange={room.setPlayerName}
              playerColor={room.playerColor} spectator={room.spectator}
              wantPrivate={room.wantPrivate} onWantPrivateChange={room.setWantPrivate}
              myAvatarUrl={room.myAvatarUrl} onAvatarFile={onAvatarFile} onClearAvatar={() => room.setMyAvatar(null)}
              onIdentityChange={room.changeIdentity}
              boardHasContent={state.tokens.length > 0 || !!state.map.imageUrl}
              onHost={room.hostRoom} onJoin={room.joinRoom} onLeave={room.leaveRoom}
              onClosePanel={() => room.setOnlineOpen(false)}
            />
          )}
        </div>
      </div>

      {online && room.ai.self && (
        <AiSeatBanner app="dnd" ai={room.ai} onLeave={room.leaveRoom} error={connected ? undefined : online.error} />
      )}
      <RollRequestBanner withInvites />

      {readOnly && (
        <div className="dnd-tt-spectating">
          {online?.you?.ai
            ? "👁 This AI invite can't change the board — it can watch, pan and zoom, chat and roll."
            : "👁 Spectating — you can watch, pan and zoom, but not change the board."}
        </div>
      )}

      <div className={"dnd-tt-body" + (sideCollapsed ? " side-collapsed" : "")}>
        <ChatDock chat={room.chat} myId={room.myId} toggle={chatToggle} className="dnd" />
        <MediaDock music={music} playback={media} toggle={mediaToggle} className="dnd"
                   canSet={canSetMusic} myName={room.playerName}
                   cantSetWhy={readOnly ? "Spectators can't change the table's music." : "The DM picks the table's music."}
                   onSet={(m) => setBoard((s) => ({ ...s, music: m }))} />
        {view3d ? (
          <div className="dnd-tt-canvas">
            <Suspense fallback={<div className="board3d board3d-loading">Loading 3D view…</div>}>
              <Dnd3D state={boardView} selectedId={selectedId} onSelect={setSelectedId} fog={fogView}
                     onUploadModel={readOnly ? undefined : () => modelFileRef.current?.click()}
                     onMoveToken={readOnly ? undefined : (id, x, y) => updateToken(id, { x, y })} />
            </Suspense>
          </div>
        ) : (
          <DungeonCanvas
            state={boardView}
            fog={fogView}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMoveToken={(id, x, y) => updateToken(id, { x, y })}
            onDropCharacter={readOnly ? undefined : addFromCharacter}
            onMoveTerrain={(id, x, y) => updateTerrain(id, { x, y })}
            ghost={ghost && fogView?.mode === "player" && !fogView.vision.some((p) => pointInPolygon({ x: ghost.to.x + (ghost.size ?? 1) / 2, y: ghost.to.y + (ghost.size ?? 1) / 2 }, p)) ? null : ghost}
          />
        )}

        <aside className="dnd-tt-side" hidden={sideCollapsed}>
          {connected && (
            <section className="dnd-party">
              <h3>Party</h3>
              {!readOnly && (
                <label className="dnd-tt-field">Your character
                  <select value={myProfile?.charId ?? ""}
                          onChange={(e) => room.attachCharacter(e.target.value ? (chars.find((x) => x.id === e.target.value) ?? null) : null)}>
                    <option value="">None attached</option>
                    {chars.map((c) => <option key={c.id} value={c.id}>{c.name || "Unnamed"} {c.className ? `(${c.className})` : ""}</option>)}
                  </select>
                </label>
              )}
              {chars.length === 0 && !readOnly && <p className="muted small">Build a sheet in Character Sheets to share it here.</p>}
              <div className="dnd-party-roster">
                {online!.peers.map((p) => {
                  const prof = room.profiles[p.id];
                  const avatar = room.avatars[p.id];
                  return (
                    <div key={p.id} className="dnd-party-row">
                      {avatar
                        ? <span className="dnd-party-avatar" style={{ backgroundImage: `url(${avatar})` }} />
                        : <span className="dnd-party-dot" style={{ background: p.color === "spectator" ? "#8b94a8" : p.color }} />}
                      <span className="dnd-party-name">{p.name}{p.dm && <span className="dnd-badge-dm">DM</span>}{p.id === room.myId ? " (you)" : ""}</span>
                      {prof
                        ? <button className="ghost-btn small" onClick={() => setViewProfile(prof)}>View sheet</button>
                        : <span className="muted small">{p.color === "spectator" ? "spectator" : "no sheet"}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <input ref={modelFileRef} type="file" accept=".stl,model/stl,application/sla" hidden onChange={onModelFile} />
          {(canSetFog || fogOn) && (
            <section className="dnd-tt-fog">
              <h3>Fog of war</h3>
              {canSetFog ? (
                <>
                  <label className="dnd-tt-check">
                    <input type="checkbox" checked={fogOn}
                           onChange={(e) => patch({ fog: { ...(state.fog ?? {}), on: e.target.checked } })} />
                    Fog of war
                  </label>
                  <label className="dnd-tt-check">
                    <input type="checkbox" checked={!!state.fog?.sharedVision} disabled={!fogOn}
                           onChange={(e) => patch({ fog: { on: fogOn, sharedVision: e.target.checked } })} />
                    Party shares vision
                  </label>
                  {seesAll && (
                    <label className="dnd-tt-check">
                      <input type="checkbox" checked={previewFog} disabled={!fogOn}
                             onChange={(e) => setPreviewFog(e.target.checked)} />
                      Preview what the party sees
                    </label>
                  )}
                  <p className="muted small">
                    {connected && !room.isDm
                      ? "Take the DM seat to see the whole map while the players are fogged."
                      : "You see the whole map; shaded areas are hidden from the players. Each player sees what their own PC tokens can see. Walls and terrain taller than a token’s eyes block sight; flying tokens see over them."}
                  </p>
                </>
              ) : (
                <p className="muted small">The DM has fog of war on: you see what {state.fog?.sharedVision ? "the party’s" : "your"} PC tokens can see.
                  {viewerTokens.length === 0 && " Add your token (+ My token, or from your character sheet) to see the map."}</p>
              )}
            </section>
          )}
          <section>
            <h3>Map</h3>
            <div className="dnd-tt-row">
              <button onClick={() => fileRef.current?.click()}>Upload image</button>
              <button className="ghost-btn" onClick={() => patchMap({ imageUrl: null })} disabled={!state.map.imageUrl}>Clear</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onMapFile} />
            </div>
            <label className="dnd-tt-field">Or paste image URL
              <input value={state.map.imageUrl && state.map.imageUrl.startsWith("http") ? state.map.imageUrl : ""}
                     placeholder="https://…"
                     onChange={(e) => patchMap({ imageUrl: e.target.value || null })} />
            </label>
            <div className="dnd-tt-grid2">
              <label className="dnd-tt-field">Columns
                <input type="number" min={4} max={80} value={state.map.cols}
                       onChange={(e) => patchMap({ cols: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <label className="dnd-tt-field">Rows
                <input type="number" min={4} max={80} value={state.map.rows}
                       onChange={(e) => patchMap({ rows: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
            </div>
            <label className="dnd-tt-check">
              <input type="checkbox" checked={state.map.showGrid} onChange={(e) => patchMap({ showGrid: e.target.checked })} />
              Show grid
            </label>
          </section>

          <section>
            <h3>Add tokens</h3>
            <div className="dnd-tt-chars-head">
              <span className="dnd-tt-field">Characters</span>
              <ImportSheetsButton onImported={(cs, errs) => setWarn(importSummary(cs, errs))} />
            </div>
            {chars.length > 0 && (
              <ul className="dnd-tt-chars">
                {chars.map((c) => (
                  <li key={c.id} className={"dnd-tt-char" + (onBoardChars.has(c.id) ? " placed" : "")}
                      draggable={!readOnly}
                      title={readOnly ? undefined : "Drag onto the board"}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-dnd-character", c.id);
                        e.dataTransfer.effectAllowed = "copy";
                      }}>
                    <span className="dnd-tt-char-dot">{initials(c.name || "PC")}</span>
                    <span className="dnd-tt-char-info">
                      <span className="dnd-tt-char-name">{c.name || "Unnamed"}</span>
                      <span className="muted small">
                        {[c.className, c.race].filter(Boolean).join(" · ") || "—"}
                        {c.modelName ? ` · ▲ ${c.modelName}` : ""}
                        {onBoardChars.has(c.id) ? " · on board" : ""}
                      </span>
                    </span>
                    {!readOnly && <CharacterModelControls character={c} compact onNote={setWarn} />}
                    {!readOnly && <button className="dnd-tt-char-add" onClick={() => addFromCharacter(c.id)} title="Place at the centre of the map">＋</button>}
                  </li>
                ))}
              </ul>
            )}
            <div className="dnd-tt-row">
              <button onClick={() => addToken({ name: "Monster", kind: "monster", color: "#c84a4a" })}>+ Monster</button>
              <button onClick={() => addToken({ name: "Marker", kind: "marker", size: 1, color: "#c8a34a" })}>+ Marker</button>
              {connected && !readOnly && (
                <button onClick={() => addToken({
                  name: room.actor.name, kind: "pc", color: room.actor.color,
                  avatarUrl: room.myAvatarUrl ?? undefined,
                })}>+ My token</button>
              )}
            </div>
            {chars.length === 0
              ? <p className="muted small">No saved characters yet. Import a sheet (JSON or a filled-in 5e PDF), or build one in Character Sheets.</p>
              : <p className="muted small">Drag a character onto the map. A character’s STL rides along into the 3D view.</p>}
          </section>

          <section>
            <h3>Terrain</h3>
            <div className="dnd-tt-row dnd-tt-terrain-row">
              {DND_TERRAIN_PRESETS.map((p) => (
                <button key={p.kind} onClick={() => addTerrain(p)} disabled={readOnly}>+ {p.label}</button>
              ))}
            </div>
            <p className="muted small">Blocks stand up in the 3D view. Upload an STL to any block to swap it for a model (houses for a village, say).</p>
          </section>

          {selectedTerrain && (
            <section className="dnd-tt-edit">
              <h3>Terrain</h3>
              <label className="dnd-tt-field">Label
                <input value={selectedTerrain.label} onChange={(e) => updateTerrain(selectedTerrain.id, { label: e.target.value })} />
              </label>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">{selectedTerrain.shape === "circle" ? "Diameter (cells)" : "Width (cells)"}
                  <input type="number" min={0.25} max={80} step={0.25} value={selectedTerrain.w}
                         onChange={(e) => updateTerrain(selectedTerrain.id, { w: Math.max(0.25, Number(e.target.value) || 1) })} />
                </label>
                {selectedTerrain.shape === "rect" && (
                  <label className="dnd-tt-field">Depth (cells)
                    <input type="number" min={0.25} max={80} step={0.25} value={selectedTerrain.d}
                           onChange={(e) => updateTerrain(selectedTerrain.id, { d: Math.max(0.25, Number(e.target.value) || 1) })} />
                  </label>
                )}
              </div>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">Height (ft)
                  <input type="number" min={0} max={500} step={5} value={selectedTerrain.height}
                         onChange={(e) => updateTerrain(selectedTerrain.id, { height: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="dnd-tt-field">Rotation
                  <input type="number" min={-180} max={180} step={15} value={selectedTerrain.rotation}
                         onChange={(e) => updateTerrain(selectedTerrain.id, { rotation: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <label className="dnd-tt-field" title="Lift the block off the ground: an upper floor, a balcony, a floating rock. Tokens under it stay on the ground; set a token's elevation to this height to stand on it.">Floats (ft above ground)
                <input type="number" min={0} max={500} step={5} value={selectedTerrain.float ?? 0}
                       onChange={(e) => updateTerrain(selectedTerrain.id, { float: Math.max(0, Number(e.target.value) || 0) || undefined })} />
              </label>
              <label className="dnd-tt-field">Color
                <input type="color" value={selectedTerrain.color} onChange={(e) => updateTerrain(selectedTerrain.id, { color: e.target.value })} />
              </label>
              <div className="dnd-tt-field">3D model (STL)
                <div className="dnd-tt-row">
                  <button onClick={() => modelFileRef.current?.click()} disabled={modelBusy || readOnly}>
                    {modelBusy ? "Processing…" : selectedTerrain.modelStl ? "Replace STL" : "Upload STL"}
                  </button>
                  {selectedTerrain.modelStl && (
                    <button className="ghost-btn" onClick={() => updateTerrain(selectedTerrain.id, { modelStl: undefined, modelName: undefined })}>Clear</button>
                  )}
                </div>
                <span className="muted small">
                  {selectedTerrain.modelStl
                    ? `${selectedTerrain.modelName ?? "Model"} · ${Math.round(selectedTerrain.modelStl.length / 1024)} KB synced · stretched to fill the block`
                    : "The model is stretched to fill this block's width, depth and height."}
                </span>
              </div>
              <button className="danger" onClick={() => removeTerrain(selectedTerrain.id)}>Remove terrain</button>
            </section>
          )}

          {selected && (
            <section className="dnd-tt-edit">
              <h3>Token</h3>
              <label className="dnd-tt-field">Name
                <input value={selected.name} onChange={(e) => updateToken(selected.id, { name: e.target.value })} />
              </label>
              <div className="dnd-tt-token-icon">
                <span className="dnd-tt-token-icon-preview" style={selected.avatarUrl ? { backgroundImage: `url(${selected.avatarUrl})` } : { background: selected.color }} />
                <div className="dnd-tt-row">
                  <button onClick={() => tokenIconFileRef.current?.click()}>Upload icon</button>
                  {selected.avatarUrl && (
                    <button className="ghost-btn" onClick={() => updateToken(selected.id, { avatarUrl: undefined })}>Clear</button>
                  )}
                  <input ref={tokenIconFileRef} type="file" accept="image/*" hidden onChange={onTokenIconFile} />
                </div>
              </div>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">Color
                  <input type="color" value={selected.color} onChange={(e) => updateToken(selected.id, { color: e.target.value })} />
                </label>
                <label className="dnd-tt-field">Size
                  <select value={selected.size} onChange={(e) => updateToken(selected.id, { size: Number(e.target.value) })}>
                    <option value={1}>Medium (1)</option>
                    <option value={2}>Large (2)</option>
                    <option value={3}>Huge (3)</option>
                    <option value={4}>Gargantuan (4)</option>
                  </select>
                </label>
              </div>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">HP current
                  <input type="number" value={selected.hpCurrent ?? ""} onChange={(e) => updateToken(selected.id, { hpCurrent: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
                <label className="dnd-tt-field">HP max
                  <input type="number" value={selected.hpMax ?? ""} onChange={(e) => updateToken(selected.id, { hpMax: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
              </div>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">Initiative
                  <input type="number" value={selected.initiative ?? ""} onChange={(e) => updateToken(selected.id, { initiative: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
                <label className="dnd-tt-field" title="Height above the ground in feet: flying, or standing on a floating floor or platform that starts at or below this height">Elevation (ft)
                  <input type="number" min={0} step={5} value={selected.elevation ?? 0}
                         onChange={(e) => updateToken(selected.id, { elevation: Math.max(0, Number(e.target.value) || 0) || undefined })} />
                </label>
              </div>
              <label className="dnd-tt-field" title="How far this token can move in one move — the 3D view's move readout counts against it">Speed (ft)
                <input type="number" min={0} step={5} value={selected.speed ?? 30}
                       onChange={(e) => updateToken(selected.id, { speed: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              {fogOn && (
                <label className="dnd-tt-field" title="Fog of war: how far this token can see. Leave blank on a lit map; set it for darkvision or a torch.">Sight (ft, blank = unlimited)
                  <input type="number" min={0} step={5} value={selected.sight ?? ""} placeholder="unlimited"
                         onChange={(e) => updateToken(selected.id, { sight: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) || undefined })} />
                </label>
              )}
              <ConditionsPanel key={selected.id} token={selected} readOnly={readOnly}
                               onPatch={(p) => updateToken(selected.id, p)} />
              <div className="dnd-tt-field">3D model (STL)
                <div className="dnd-tt-row">
                  <button onClick={() => modelFileRef.current?.click()} disabled={modelBusy}>
                    {modelBusy ? "Processing…" : selected.modelStl ? "Replace STL" : "Upload STL"}
                  </button>
                  {selected.modelStl && (
                    <button className="ghost-btn" onClick={() => updateToken(selected.id, { modelStl: undefined, modelName: undefined })}>Clear</button>
                  )}
                </div>
                <span className="muted small">
                  {selected.modelStl
                    ? `${selected.modelName ?? "Model"} · ${Math.round(selected.modelStl.length / 1024)} KB synced`
                    : "Shown in the 3D view. Big files are simplified to keep the game in sync."}
                </span>
              </div>
              <button className="danger" onClick={() => removeToken(selected.id)}>Remove token</button>
            </section>
          )}

          <section>
            <h3>Campaign maps</h3>
            <CampaignMapsPanel />
          </section>

          <section>
            <div className="dnd-tt-init-head">
              <h3>Initiative</h3>
              <span className="muted small">Round {state.round}</span>
            </div>
            {order.length === 0 ? (
              <p className="muted small">Give tokens an initiative value to build the order.</p>
            ) : (
              <>
                <ol className="dnd-tt-init">
                  {order.map((t) => hiddenFromMe(t) ? (
                    <li key={t.id} className={"dnd-tt-init-row unseen" + (t.id === state.activeTokenId ? " active" : "")}>
                      <span className="dnd-tt-init-num">{t.initiative}</span>
                      <span className="dnd-tt-init-dot" style={{ background: "#555b66" }} />
                      <span className="dnd-tt-init-name muted">Unseen</span>
                    </li>
                  ) : (
                    <li key={t.id}
                        className={"dnd-tt-init-row" + (t.id === state.activeTokenId ? " active" : "") + (t.id === selectedId ? " sel" : "")}
                        onClick={() => setSelectedId(t.id)}>
                      <span className="dnd-tt-init-num">{t.initiative}</span>
                      <span className="dnd-tt-init-dot" style={{ background: t.color }} />
                      <span className="dnd-tt-init-name">{t.name}</span>
                      {conditionColors(t).length > 0 && (
                        <span className="dnd-tt-init-conds" title={conditionSummary(t)}>
                          {conditionColors(t).map((c, i) => <i key={i} style={{ background: c }} />)}
                        </span>
                      )}
                      {t.hpMax != null && <span className="muted small">{t.hpCurrent ?? t.hpMax}/{t.hpMax}</span>}
                    </li>
                  ))}
                </ol>
                <button className="dnd-primary" onClick={nextTurn}>Next turn ▸</button>
              </>
            )}
          </section>

          <section>
            <div className="dnd-tt-init-head">
              <h3>Dice rolls</h3>
              {room.rollFeed.length > 0 && (
                <button className="ghost-btn small" onClick={room.clearRolls}>Clear</button>
              )}
            </div>
            <RollFeed feed={room.rollFeed} emptyText="No rolls yet. Roll in the Dice tab — everyone in the game sees them here." />
          </section>

          <section>
            <div className="dnd-tt-init-head">
              <h3>Log</h3>
              {(state.log?.length ?? 0) > 0 && (
                <button className="ghost-btn small" onClick={() => patch({ log: [] })} title="Clear the log">Clear</button>
              )}
            </div>
            <AuditLogView log={state.log} onReplay={showGhost} />
          </section>

          <section>
            <h3>Board</h3>
            <button className="danger" onClick={() => { if (confirm("Remove all tokens?")) patch({ tokens: [], activeTokenId: null }); }}>Clear tokens</button>
          </section>
        </aside>
      </div>

      {viewProfile && (
        <div className="dnd-modal-overlay" onClick={() => setViewProfile(null)}>
          <div className="dnd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dnd-modal-head">
              <span className="dnd-party-dot" style={{ background: viewProfile.color }} />
              <b>{viewProfile.name}’s character</b>
              <button className="ghost-btn small" onClick={() => setViewProfile(null)}>Close</button>
            </div>
            <div className="dnd-modal-body">
              <CharacterSheetView c={viewProfile.character} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

type DragState =
  | { kind: "none" }
  | { kind: "token"; id: string; offX: number; offY: number }
  | { kind: "terrain"; id: string; offX: number; offY: number }
  | { kind: "pan"; sx: number; sy: number; tx: number; ty: number };

function DungeonCanvas({ state, fog, selectedId, onSelect, onMoveToken, onDropCharacter, onMoveTerrain, ghost }: {
  state: DndTabletopState;
  fog: FogView | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveToken: (id: string, x: number, y: number) => void;
  /** A character dragged in from the tray, dropped at `at` (cells). */
  onDropCharacter?: (charId: string, at: { x: number; y: number }) => void;
  onMoveTerrain: (id: string, x: number, y: number) => void;
  ghost: LogEntry["move"] | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drag, setDrag] = useState<DragState>({ kind: "none" });
  const { cols, rows } = state.map;
  const W = cols * U, H = rows * U;

  // Once the user has zoomed or panned, a container resize (e.g. the
  // tabletop drawer opening or being dragged wider) keeps their view
  // centred instead of snapping back to fit-to-board.
  const userAdjustedRef = useRef(false);
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    userAdjustedRef.current = false;
    const onResize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const last = lastSizeRef.current;
      lastSizeRef.current = { w, h };
      if (!userAdjustedRef.current || !last) { fit(); return; }
      const dw = w - last.w, dh = h - last.h;
      if (dw || dh) setView((v) => ({ ...v, tx: v.tx + dw / 2, ty: v.ty + dh / 2 }));
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  function fit() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 16;
    const s = Math.min((wrap.clientWidth - pad * 2) / W, (wrap.clientHeight - pad * 2) / H);
    if (!isFinite(s) || s <= 0) return;
    setView({ tx: (wrap.clientWidth - W * s) / 2, ty: (wrap.clientHeight - H * s) / 2, scale: s });
  }

  function toCell(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect();
    const x = (clientX - r.left - view.tx) / view.scale / U;
    const y = (clientY - r.top - view.ty) / view.scale / U;
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = (e.target as Element).closest("[data-token]");
    if (el) {
      const id = el.getAttribute("data-token")!;
      const tk = state.tokens.find((t) => t.id === id);
      if (!tk) return;
      onSelect(id);
      wrapRef.current?.setPointerCapture(e.pointerId);
      const c = toCell(e.clientX, e.clientY);
      setDrag({ kind: "token", id, offX: c.x - tk.x, offY: c.y - tk.y });
    } else if ((e.target as Element).closest("[data-terrain]")) {
      const id = (e.target as Element).closest("[data-terrain]")!.getAttribute("data-terrain")!;
      const tr = (state.terrain ?? []).find((t) => t.id === id);
      if (!tr) return;
      onSelect(id);
      wrapRef.current?.setPointerCapture(e.pointerId);
      const c = toCell(e.clientX, e.clientY);
      setDrag({ kind: "terrain", id, offX: c.x - tr.x, offY: c.y - tr.y });
    } else {
      onSelect(null);
      wrapRef.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty });
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag.kind === "pan") {
      userAdjustedRef.current = true;
      setView({ ...view, tx: drag.tx + (e.clientX - drag.sx), ty: drag.ty + (e.clientY - drag.sy) });
    } else if (drag.kind === "token") {
      const c = toCell(e.clientX, e.clientY);
      // snap to half-cell
      const nx = Math.round((c.x - drag.offX) * 2) / 2;
      const ny = Math.round((c.y - drag.offY) * 2) / 2;
      onMoveToken(drag.id, nx, ny);
    } else if (drag.kind === "terrain") {
      const c = toCell(e.clientX, e.clientY);
      onMoveTerrain(drag.id, Math.round((c.x - drag.offX) * 4) / 4, Math.round((c.y - drag.offY) * 4) / 4);
    }
  }
  function onPointerUp() { setDrag({ kind: "none" }); }

  const CHAR_MIME = "application/x-dnd-character";
  function onDragOver(e: React.DragEvent) {
    if (onDropCharacter && e.dataTransfer.types.includes(CHAR_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }
  function onDrop(e: React.DragEvent) {
    const id = onDropCharacter && e.dataTransfer.getData(CHAR_MIME);
    if (!id) return;
    e.preventDefault();
    onDropCharacter(id, toCell(e.clientX, e.clientY));
  }

  // React registers wheel listeners as passive, so page-scroll suppression
  // needs a native non-passive listener.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    wrap.addEventListener("wheel", stop, { passive: false });
    return () => wrap.removeEventListener("wheel", stop);
  }, []);

  function onWheel(e: React.WheelEvent) {
    userAdjustedRef.current = true;
    const r = wrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const ns = Math.max(0.15, Math.min(6, view.scale * Math.exp(-e.deltaY * 0.001)));
    const k = ns / view.scale;
    setView({ scale: ns, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k });
  }

  // Fogged players see the terrain they've laid eyes on; the rest stays
  // under the fog with the map.
  const terrainSeenIds = useMemo(() => {
    if (fog?.mode !== "player") return null;
    const polys = [...fog.vision, ...fog.explored];
    return new Set((state.terrain ?? []).filter((t) => terrainSeen(t, polys)).map((t) => t.id));
  }, [fog, state.terrain]);
  const terrainUnder = (state.terrain ?? []).filter((t) => !terrainSeenIds?.has(t.id));
  const terrainOver = terrainSeenIds ? (state.terrain ?? []).filter((t) => terrainSeenIds.has(t.id)) : [];
  function renderTerrain(t: DndTerrain) {
    const w = t.w * U, d = (t.shape === "circle" ? t.w : t.d) * U;
    const cx = t.x * U + w / 2, cy = t.y * U + d / 2;
    const sel = t.id === selectedId;
    return (
      <g key={t.id} data-terrain={t.id} style={{ cursor: "grab" }}
         transform={`rotate(${t.rotation} ${cx} ${cy})`}>
        {t.shape === "circle"
          ? <circle cx={cx} cy={cy} r={w / 2} fill={t.color} fillOpacity={0.7}
                    stroke={sel ? "#ffd24a" : "#0009"} strokeWidth={(sel ? 3 : 1.5) / view.scale} />
          : <rect x={t.x * U} y={t.y * U} width={w} height={d} fill={t.color} fillOpacity={0.7}
                  stroke={sel ? "#ffd24a" : "#0009"} strokeWidth={(sel ? 3 : 1.5) / view.scale} />}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#fff" fillOpacity={0.85}
              pointerEvents="none" paintOrder="stroke" stroke="#000" strokeWidth={2}>
          {(t.modelStl ? "▲ " : "") + (t.label || t.kind)} · {t.height}ft{t.float ? ` ↑${t.float}ft` : ""}
        </text>
      </g>
    );
  }

  return (
    <div className="dnd-tt-canvas" ref={wrapRef}
         onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
         onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
      <svg width="100%" height="100%">
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <rect x={0} y={0} width={W} height={H} fill="#12151b" stroke="#2a2f3c" strokeWidth={1 / view.scale} />
          {state.map.imageUrl && (
            <image href={state.map.imageUrl} x={0} y={0} width={W} height={H}
                   preserveAspectRatio="none" />
          )}
          {state.map.showGrid && (
            <g stroke="#000" strokeOpacity={state.map.gridOpacity} strokeWidth={1 / view.scale}>
              {Array.from({ length: cols + 1 }, (_, i) => (
                <line key={"v" + i} x1={i * U} y1={0} x2={i * U} y2={H} />
              ))}
              {Array.from({ length: rows + 1 }, (_, i) => (
                <line key={"h" + i} x1={0} y1={i * U} x2={W} y2={i * U} />
              ))}
            </g>
          )}
          {/* Terrain blocks, under the tokens (and under the fog, unless a
              fogged player has seen them: then they stand above it). */}
          {terrainUnder.map(renderTerrain)}
          {/* Fog of war, over the map and terrain, under the tokens. The DM
              gets a light shade; players get black for ground they've never
              seen and a dim veil over ground seen before. */}
          {fog && (
            <g className="dnd-fog" pointerEvents={fog.mode === "player" ? "all" : "none"}>
              <defs>
                <mask id="dnd-fog-vis" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
                  <rect x={0} y={0} width={W} height={H} fill="#fff" />
                  <path d={polysPath(fog.vision, U)} fill="#000" />
                </mask>
                {fog.mode === "player" && (
                  <mask id="dnd-fog-seen" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
                    <rect x={0} y={0} width={W} height={H} fill="#fff" />
                    <path d={polysPath(fog.explored, U)} fill="#000" />
                    <path d={polysPath(fog.vision, U)} fill="#000" />
                  </mask>
                )}
              </defs>
              <rect x={0} y={0} width={W} height={H} fill="#05060a" fillOpacity={fog.mode === "dm" ? 0.45 : 0.6} mask="url(#dnd-fog-vis)" />
              {fog.mode === "player" && <rect x={0} y={0} width={W} height={H} fill="#05060a" mask="url(#dnd-fog-seen)" />}
            </g>
          )}
          {terrainOver.map(renderTerrain)}
          {/* Token icon clip paths — one per token with an avatar image. */}
          <defs>
            {state.tokens.filter((t) => t.avatarUrl).map((t) => {
              const cx = (t.x + t.size / 2) * U;
              const cy = (t.y + t.size / 2) * U;
              const r = (t.size * U) / 2 - 2;
              return (
                <clipPath key={t.id} id={`dnd-tk-clip-${t.id}`} clipPathUnits="userSpaceOnUse">
                  <circle cx={cx} cy={cy} r={r - 1 / view.scale} />
                </clipPath>
              );
            })}
          </defs>
          {state.tokens.map((t) => {
            const cx = (t.x + t.size / 2) * U;
            const cy = (t.y + t.size / 2) * U;
            const r = (t.size * U) / 2 - 2;
            const active = t.id === state.activeTokenId;
            const sel = t.id === selectedId;
            const hpFrac = t.hpMax ? Math.max(0, Math.min(1, (t.hpCurrent ?? t.hpMax) / t.hpMax)) : null;
            const hasIcon = !!t.avatarUrl;
            const conds = conditionColors(t);
            // Conditions: the token's rim split into one slice per condition.
            const ringW = Math.max(4, Math.min(9, r * 0.26));
            const ringR = r - ringW / 2;
            const slice = (2 * Math.PI) / Math.max(1, conds.length);
            return (
              <g key={t.id} data-token={t.id} style={{ cursor: "grab" }}>
                {conds.length > 0 && <title>{`${t.name}: ${conditionSummary(t)}`}</title>}
                {active && <circle cx={cx} cy={cy} r={r + 4 / view.scale} fill="none" stroke="#ffd24a" strokeWidth={3 / view.scale} />}
                {sel && conds.length > 0 && <circle cx={cx} cy={cy} r={r + 1.5 / view.scale} fill="none" stroke="#fff" strokeWidth={2 / view.scale} />}
                <circle cx={cx} cy={cy} r={r} fill={t.color}
                        stroke={sel && !conds.length ? "#fff" : "#0009"} strokeWidth={(sel && !conds.length ? 3 : 1.5) / view.scale} />
                {hasIcon && (
                  <image href={t.avatarUrl}
                         x={cx - r} y={cy - r} width={2 * r} height={2 * r}
                         preserveAspectRatio="xMidYMid slice"
                         clipPath={`url(#dnd-tk-clip-${t.id})`}
                         pointerEvents="none" />
                )}
                {!hasIcon && (
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize={Math.min(18, t.size * 14)} fontWeight={700} fill="#fff" pointerEvents="none">
                    {initials(t.name)}
                  </text>
                )}
                {conds.length === 1 && (
                  <circle cx={cx} cy={cy} r={ringR} fill="none" stroke={conds[0]} strokeWidth={ringW} pointerEvents="none" className="dnd-cond-ring" />
                )}
                {conds.length > 1 && (
                  <g pointerEvents="none" className="dnd-cond-ring">
                    {conds.map((c, i) => (
                      <path key={i} d={ringArc(cx, cy, ringR, i * slice, (i + 1) * slice)} fill="none" stroke={c} strokeWidth={ringW} />
                    ))}
                  </g>
                )}
                {hpFrac != null && (
                  <g pointerEvents="none">
                    <rect x={cx - r} y={cy + r - 6} width={2 * r} height={5} rx={2} fill="#000a" />
                    <rect x={cx - r} y={cy + r - 6} width={2 * r * hpFrac} height={5} rx={2}
                          fill={hpFrac > 0.5 ? "#4ac86a" : hpFrac > 0.25 ? "#c8a34a" : "#c84a4a"} />
                  </g>
                )}
              </g>
            );
          })}

          {/* Ghost replay: the last move's origin, path and destination. */}
          {ghost && (() => {
            const sz = ghost.size ?? 1;
            const col = ghost.color ?? "#ffd24a";
            const fx = (ghost.from.x + sz / 2) * U, fy = (ghost.from.y + sz / 2) * U;
            const tx = (ghost.to.x + sz / 2) * U, ty = (ghost.to.y + sz / 2) * U;
            const r = (sz * U) / 2 - 2;
            return (
              <g pointerEvents="none" className="dnd-ghost">
                <circle cx={fx} cy={fy} r={r} fill={col} fillOpacity={0.25} stroke={col} strokeDasharray={`${5 / view.scale} ${4 / view.scale}`} strokeWidth={2 / view.scale} />
                <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={col} strokeWidth={3 / view.scale} strokeDasharray={`${6 / view.scale} ${5 / view.scale}`} />
                <circle cx={tx} cy={ty} r={r + 3 / view.scale} fill="none" stroke={col} strokeWidth={3 / view.scale} />
              </g>
            );
          })()}
        </g>
      </svg>
      {fog?.mode === "player" && fog.noViewers && (
        <div className="dnd-fog-note">Fog of war is on. Place your PC token to see the map.</div>
      )}
      <div className="dnd-tt-overlay small muted">
        {cols}×{rows} · {state.tokens.length} tokens · zoom {(view.scale * 100).toFixed(0)}%
        <button className="ghost-btn small" onClick={() => { userAdjustedRef.current = false; fit(); }} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MultiplayerPanel(props: {
  online: OnlineState | null;
  joinCode: string; onJoinCodeChange: (v: string) => void;
  playerName: string; onNameChange: (v: string) => void;
  playerColor: string; spectator: boolean;
  wantPrivate: boolean; onWantPrivateChange: (v: boolean) => void;
  myAvatarUrl: string | null; onAvatarFile: (file: File) => void; onClearAvatar: () => void;
  onIdentityChange: (spectator: boolean, color: string) => void;
  boardHasContent: boolean;
  onHost: (opts: { blankBoard: boolean; campaignCode?: string }) => void; onJoin: () => void; onLeave: () => void;
  onClosePanel: () => void;
}) {
  const {
    online, joinCode, onJoinCodeChange, playerName, onNameChange,
    playerColor, spectator, wantPrivate, onWantPrivateChange,
    myAvatarUrl, onAvatarFile, onClearAvatar,
    onIdentityChange, onHost, onJoin, onLeave, onClosePanel, boardHasContent,
  } = props;
  // Hosting seeds the new room from a board. Default to a blank one when
  // mine has content — it may be DM prep (secret tokens) not meant for
  // players yet.
  const [startBlank, setStartBlank] = useState(boardHasContent);
  // Run one of my campaigns: claims the DM seat and links it on host.
  const room = useDndRoom();
  const keyring = useKeyring();
  const dmCampaigns = keyring.filter((e) => canEdit(e.role) && !e.stale);
  const [runCampaign, setRunCampaign] = useState("");
  const host = () => onHost({ blankBoard: boardHasContent && startBlank, campaignCode: runCampaign || undefined });
  const connected = online?.status === "open";
  const failed = online && (online.status === "error" || online.status === "closed");
  // A whole AI code in the join box joins as that AI, which needs no name.
  const joinAsAi = !!parseAiCode(joinCode);
  const nameOk = playerName.trim().length > 0 || joinAsAi;
  const amAi = !!online?.you?.ai;
  const amSpectator = online?.you?.color === "spectator";
  const myColor = amSpectator ? "#8b94a8" : (online?.you?.color ?? playerColor);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  function pickAvatarFile() {
    const f = avatarFileRef.current?.files?.[0];
    if (f) onAvatarFile(f);
    if (avatarFileRef.current) avatarFileRef.current.value = "";
  }
  const avatarControl = (
    <div className="dnd-mp-avatar">
      <span className="dnd-mp-avatar-preview" style={myAvatarUrl ? { backgroundImage: `url(${myAvatarUrl})` } : undefined} />
      <button className="ghost-btn small" onClick={() => avatarFileRef.current?.click()}>
        {myAvatarUrl ? "Change avatar" : "Upload avatar"}
      </button>
      {myAvatarUrl && <button className="ghost-btn small" onClick={onClearAvatar}>Clear</button>}
      <input ref={avatarFileRef} type="file" accept="image/*" hidden onChange={pickAvatarFile} />
    </div>
  );

  // Multiplayer runs on this same origin when the Worker serves the page.
  const onPlaySite = roomsAvailableHere();
  function openPlaySite() {
    const code = online?.code ?? new URLSearchParams(location.search).get("room") ?? "";
    window.open(dndPlayUrl(code || undefined), "_blank", "noopener");
  }
  const shareUrl = online?.code ? dndPlayUrl(online.code) : "";
  function copy(t: string) { navigator.clipboard?.writeText(t).catch(() => {}); }

  return (
    <div className="dnd-mp-panel" onClick={(e) => e.stopPropagation()}>
      <div className="dnd-mp-head">
        <strong>Multiplayer</strong>
        <button className="ghost-btn small" onClick={onClosePanel}>×</button>
      </div>

      {!onPlaySite && (
        <div className="dnd-mp-site">
          <button className="dnd-primary" onClick={openPlaySite}>Open multiplayer site ↗</button>
          <p className="muted small">Remote play runs on the game server; this button opens it in a new tab (carrying your room code).</p>
        </div>
      )}

      {!online && (
        <>
          <p className="muted small">Share a live map with your table. One person hosts and shares the code; others join. Tokens, initiative, HP and the map stay in sync.</p>
          <label className="dnd-tt-field">Your name
            <input value={playerName} maxLength={24} autoFocus
                   onChange={(e) => onNameChange(e.target.value)}
                   onKeyDown={(e) => { if (e.key !== "Enter" || !nameOk) return; if (joinCode.trim().length >= 4) onJoin(); else host(); }} />
          </label>
          <div className="dnd-mp-identity">
            <label className="dnd-tt-field">Your color
              <input type="color" value={playerColor} disabled={spectator}
                     onChange={(e) => onIdentityChange(false, e.target.value)} />
            </label>
            <label className="dnd-tt-check">
              <input type="checkbox" checked={spectator}
                     onChange={(e) => onIdentityChange(e.target.checked, playerColor)} />
              Spectate (watch only)
            </label>
          </div>
          {avatarControl}
          <label className="dnd-tt-check">
            <input type="checkbox" checked={wantPrivate}
                   onChange={(e) => onWantPrivateChange(e.target.checked)} />
            Private game (hide from the public Live games list)
          </label>
          {dmCampaigns.length > 0 && (
            <label className="dnd-tt-field">Run a campaign (you’ll be the DM)
              <select value={runCampaign} onChange={(e) => {
                setRunCampaign(e.target.value);
                if (e.target.value && !wantPrivate) onWantPrivateChange(true);
              }}>
                <option value="">No campaign</option>
                {dmCampaigns.map((c) => <option key={c.campaignId} value={c.code}>{c.name}</option>)}
              </select>
            </label>
          )}
          {boardHasContent && (
            <div className="dnd-mp-start" role="radiogroup" aria-label="Start the game with">
              <span className="muted small">Start the game with:</span>
              <label className="dnd-tt-check"><input type="radio" checked={startBlank} onChange={() => setStartBlank(true)} /> A blank board</label>
              <label className="dnd-tt-check"><input type="radio" checked={!startBlank} onChange={() => setStartBlank(false)} /> My current board (everyone sees it)</label>
            </div>
          )}
          <button className="dnd-primary" onClick={host} disabled={!nameOk}>Host a new game</button>
          <div className="dnd-mp-join">
            <input placeholder="CODE" value={joinCode} maxLength={40} className={joinAsAi ? "ai-code" : undefined}
                   onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                   onKeyDown={(e) => { if (e.key === "Enter" && nameOk) onJoin(); }} />
            <button onClick={onJoin} disabled={joinCode.trim().length < 4 || !nameOk}>{joinAsAi ? "Join as AI" : "Join"}</button>
          </div>
          {joinAsAi && <p className="muted small">That's an AI invite code: you'll join as the AI it admits, to see what it can do.</p>}
          {!nameOk && <p className="muted small">Enter a name to host or join.</p>}
        </>
      )}

      {online && (
        <>
          <div className="dnd-mp-status">
            <span className={"dnd-mp-dot " + online.status} />
            <span>{connected ? "Connected" : online.status === "connecting" ? "Connecting…" : "Disconnected"}
              {connected && online.you && <> · <b style={{ color: myColor }}>{amSpectator ? "Spectator" : online.you.name}</b></>}
            </span>
            {connected && online.isPrivate && (
              <span className="dnd-mp-private" title="Hidden from the public Live games list">🔒 Private</span>
            )}
          </div>

          {connected && !amAi && (
            <div className="dnd-mp-identity">
              <label className="dnd-tt-field">Your color
                <input type="color" value={amSpectator ? "#8b94a8" : myColor} disabled={amSpectator}
                       onChange={(e) => onIdentityChange(false, e.target.value)} />
              </label>
              <label className="dnd-tt-check">
                <input type="checkbox" checked={amSpectator}
                       onChange={(e) => onIdentityChange(e.target.checked, playerColor)} />
                Spectate
              </label>
            </div>
          )}
          {connected && !amAi && avatarControl}

          {connected && room.proto >= 2 && <DmSeatRow amSpectator={amSpectator || amAi} />}

          <div className="dnd-mp-code-row">
            <div className="dnd-mp-code">{online.code}</div>
            <button onClick={() => copy(online.code)}>Copy code</button>
          </div>
          {shareUrl && <button className="ghost-btn small" onClick={() => copy(shareUrl)}>Copy invite link</button>}

          <div className="dnd-mp-peers">
            {online.peers.length === 0 ? <span className="muted small">No one else here yet — share the code.</span> :
              online.peers.map((p) => (
                <span key={p.id} className="dnd-mp-peer">
                  <span className="dnd-mp-peer-dot" style={{ background: p.color === "spectator" ? "#8b94a8" : p.color }} />
                  {p.name}{p.ai && <span className="ai-tag">AI</span>}{p.dm && <span className="dnd-badge-dm">DM</span>}{p.color === "spectator" && " (spectator)"}{online.you?.id === p.id && " (you)"}
                </span>
              ))}
          </div>

          {connected && !amAi && room.proto >= 2 && <AiInvitePanel app="dnd" ai={room.ai} you={online.you} peers={online.peers} />}

          {failed && <p className="muted small">{online.error ?? "Disconnected — retrying…"}</p>}
          <button className="danger" onClick={onLeave}>{amAi ? "Leave AI preview" : "Leave game"}</button>
        </>
      )}
    </div>
  );
}


// Who's DM, and the controls to take / give up the seat. When the game runs
// a campaign, taking the seat needs that campaign's owner/Co-DM code (sent
// automatically from My campaigns).
function DmSeatRow({ amSpectator }: { amSpectator: boolean }) {
  const room = useDndRoom();
  const linked = room.linkedCampaign;
  const myCode = linked ? bestCodeFor(linked.id, "codm") : null;
  const dm = room.dmPeer;
  const canTake = !dm && !amSpectator && (!linked || !!myCode);
  return (
    <div className="dnd-mp-dm">
      <div className="dnd-camp-row">
        <span className="small">
          {dm ? <>DM: <b>{dm.name}</b>{room.isDm && " (you)"}</> : "DM seat is open"}
        </span>
        {room.isDm && <button className="ghost-btn small" onClick={room.releaseDm}>Give up DM seat</button>}
        {canTake && <button className="ghost-btn small" onClick={() => room.claimDm()}>Become DM</button>}
      </div>
      {linked && (
        <span className="muted small">Campaign: <b>{linked.name}</b>
          {!dm && !myCode && !amSpectator && " — you need its owner or Co-DM code to be DM"}
        </span>
      )}
      {room.dmNotice && (
        <span className={"small " + (room.dmNotice.kind === "ok" ? "dnd-camp-okmsg" : "dnd-camp-error")}>{room.dmNotice.text}</span>
      )}
    </div>
  );
}
