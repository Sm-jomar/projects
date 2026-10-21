import { useState } from "react";
import {
  canEdit, deleteMap, getMap, putMap, renameMap,
  type CampaignMapData, type CampaignMapSummary, type CampaignView,
} from "./campaign";
import { boardBytes, BOARD_BYTES_SAFE, downscaleDataUrl, newId } from "./dndTabletop";
import { useDndRoom } from "./dndRoom";
import { useCampaign, useKeyring } from "./useCampaign";

const MAP_BYTES_MAX = 1_500_000;

// Saved maps for a campaign. Maps are designed on the regular tabletop
// (solo is fine) and saved here with "Save board to campaign"; "Load"
// puts one on the board, in a live game or not.
export function CampaignMapLibrary({ code, maps, mutate }: {
  code: string;
  maps: CampaignMapSummary[];
  mutate: (fn: (v: CampaignView) => CampaignView) => void;
}) {
  const room = useDndRoom();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [includePcs, setIncludePcs] = useState(false);
  const [clearInit, setClearInit] = useState(true);
  const [keepPcs, setKeepPcs] = useState(true);
  // In a live game the DM can hold a map's tokens back ("staged") and
  // reveal them later — anything on the board is visible to everyone.
  const [loadMode, setLoadMode] = useState<"all" | "stage" | "map">("all");
  const live = room.online?.status === "open";

  async function saveBoard() {
    const s = room.state;
    setBusy("save");
    setMsg(null);
    try {
      const imageUrl = s.map.imageUrl ? await downscaleDataUrl(s.map.imageUrl, 1200, 0.72) : null;
      const tokens = s.tokens
        .filter((t) => includePcs || t.kind !== "pc")
        .map((t) => (clearInit ? { ...t, initiative: undefined } : t));
      const data: CampaignMapData = { map: { ...s.map, imageUrl }, tokens, terrain: s.terrain ?? [] };
      if (JSON.stringify(data).length > MAP_BYTES_MAX) {
        throw new Error("This board is too large to save (map image plus token icons). Try a smaller image.");
      }
      const summary = await putMap(code, newId("map"), name.trim() || "Untitled map", data);
      mutate((v) => ({ ...v, maps: [summary, ...(v.maps ?? [])] }));
      setSaving(false);
      setName("");
      setMsg({ kind: "ok", text: `Saved “${summary.name}”.` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function load(m: CampaignMapSummary) {
    const where = live ? "the live board — everyone in the game will see it" : "your board";
    if (!confirm(`Load “${m.name}” onto ${where}?\nThe current map and non-player tokens are replaced.`)) return;
    setBusy(m.id);
    setMsg(null);
    try {
      const { data } = await getMap(code, m.id);
      const s = room.state;
      const kept = keepPcs ? s.tokens.filter((t) => t.kind === "pc") : [];
      // Fresh ids so a map loaded twice (or alongside kept tokens) never collides.
      const incoming = data.tokens.map((t) => ({ ...t, id: newId() }));
      const mode = live ? loadMode : "all";
      const onBoard = mode === "all" ? incoming : [];
      const terrain = data.terrain ?? [];
      const next = { ...s, map: data.map, tokens: [...kept, ...onBoard], terrain, activeTokenId: null, round: 1 };
      if (boardBytes(next) > BOARD_BYTES_SAFE) {
        throw new Error("That map plus what's already on the board is too large to sync. Clear some token icons and try again.");
      }
      room.replaceBoard((cur) => ({ ...cur, map: next.map, tokens: next.tokens, terrain, activeTokenId: null, round: 1 }), `loaded map “${m.name}”`);
      if (mode === "stage" && incoming.length) room.stageTokens(incoming);
      setMsg({ kind: "ok", text: mode === "stage" && incoming.length
        ? `Loaded “${m.name}” — ${incoming.length} token${incoming.length === 1 ? "" : "s"} staged (hidden) until you reveal them.`
        : `Loaded “${m.name}”.` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function rename(m: CampaignMapSummary) {
    const n = prompt("Rename map", m.name);
    if (!n || n.trim() === m.name) return;
    try {
      const summary = await renameMap(code, m.id, n.trim());
      mutate((v) => ({ ...v, maps: (v.maps ?? []).map((x) => (x.id === m.id ? summary : x)) }));
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  }

  async function remove(m: CampaignMapSummary) {
    if (!confirm(`Delete saved map “${m.name}”?`)) return;
    try {
      await deleteMap(code, m.id);
      mutate((v) => ({ ...v, maps: (v.maps ?? []).filter((x) => x.id !== m.id) }));
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  }

  return (
    <div className="dnd-camp-maps">
      {saving ? (
        <div className="dnd-camp-save-form">
          <input value={name} placeholder="Map name (e.g. Ravenloft gates)" autoFocus maxLength={80}
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") void saveBoard(); }} />
          <label className="dnd-tt-check"><input type="checkbox" checked={includePcs} onChange={(e) => setIncludePcs(e.target.checked)} /> Include player (PC) tokens</label>
          <label className="dnd-tt-check"><input type="checkbox" checked={clearInit} onChange={(e) => setClearInit(e.target.checked)} /> Clear initiative</label>
          <div className="dnd-camp-row">
            <button className="dnd-primary" onClick={() => void saveBoard()} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
            <button className="ghost-btn" onClick={() => setSaving(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="dnd-primary" onClick={() => setSaving(true)}
                title="Saves the tabletop's current map image, grid and tokens into this campaign">
          Save current board to campaign
        </button>
      )}
      {msg && <p className={msg.kind === "ok" ? "dnd-camp-okmsg" : "dnd-camp-error"}>{msg.text}</p>}
      {maps.length === 0 ? (
        <p className="muted small">No saved maps. Set up a map on the Tabletop (no game needed), then save it here.</p>
      ) : (
        <>
          <label className="dnd-tt-check"><input type="checkbox" checked={keepPcs} onChange={(e) => setKeepPcs(e.target.checked)} /> Keep player tokens when loading</label>
          {live && (
            <label className="dnd-tt-field">When loading into the game
              <select value={loadMode} onChange={(e) => setLoadMode(e.target.value as "all" | "stage" | "map")}>
                <option value="all">Map + all its tokens</option>
                <option value="stage">Map only — stage its tokens (hidden until revealed)</option>
                <option value="map">Map only — drop its tokens</option>
              </select>
              <span className="muted small">Everything on the board — the map image and every token — is visible to players.</span>
            </label>
          )}
          <ul className="dnd-camp-map-list">
            {maps.map((m) => (
              <li key={m.id} className="dnd-camp-map">
                <div className="dnd-camp-map-main">
                  <b>{m.name}</b>
                  <span className="muted small">{m.cols}×{m.rows} · {m.tokenCount} token{m.tokenCount === 1 ? "" : "s"}{m.hasImage ? " · image" : ""} · {m.bytes < 1000 ? "<1" : (m.bytes / 1000).toFixed(0)} KB</span>
                </div>
                <div className="dnd-card-actions">
                  <button onClick={() => void load(m)} disabled={room.readOnly || !!busy}>{busy === m.id ? "Loading…" : "Load"}</button>
                  <button className="ghost-btn small" onClick={() => void rename(m)}>Rename</button>
                  <button className="danger" onClick={() => void remove(m)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Tabletop sidebar wrapper: pick one of your editable campaigns, then use
// its map library right next to the board.
export function CampaignMapsPanel() {
  const keyring = useKeyring();
  const editable = keyring.filter((e) => canEdit(e.role) && !e.stale);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const entry = editable.find((e) => e.campaignId === pickedId) ?? editable[0] ?? null;
  const { view, error, loading, mutate } = useCampaign(entry?.code ?? null);

  if (editable.length === 0) {
    return <p className="muted small">Create a campaign (Campaigns tab) to save maps for later.</p>;
  }
  return (
    <div className="dnd-camp-maps-panel">
      {editable.length > 1 && (
        <select value={entry?.campaignId ?? ""} onChange={(e) => setPickedId(e.target.value)} aria-label="Campaign">
          {editable.map((e) => <option key={e.campaignId} value={e.campaignId}>{e.name}</option>)}
        </select>
      )}
      {editable.length === 1 && <span className="muted small">{entry?.name}</span>}
      {loading && <p className="muted small">Loading…</p>}
      {error && <p className="dnd-camp-error">{error.message}</p>}
      {view && entry && <CampaignMapLibrary code={entry.code} maps={view.maps ?? []} mutate={mutate} />}
    </div>
  );
}
