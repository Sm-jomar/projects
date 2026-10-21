import { useCallback, useEffect, useRef, useState } from "react";
import { blankCharacter, type DndCharacter } from "./dndTypes";
import { saveCharacter } from "./dndStorage";
import { useCharacters } from "./useCharacters";
import { useDndRoom } from "./dndRoom";
import { CharacterSheetView } from "./CharacterSheetView";
import { CharacterEditorBody } from "./CharacterEditor";
import { CharacterQuickBar } from "./CharacterQuickBar";

const PICK_KEY = "dnd.mychar";

function readPick(): string | null {
  try { return localStorage.getItem(PICK_KEY); } catch { return null; }
}
function writePick(id: string) {
  try { localStorage.setItem(PICK_KEY, id); } catch { /* storage unavailable */ }
}

// The "Character Sheets" tab as it appears in the tabletop drawer: your own
// sheet, viewable at a glance with quick HP/slot/loot edits, and a toggle
// into the full editor. Edits save locally and, if this is the sheet you've
// shared with the game, re-share it so the table sees the change.
export function MyCharacterPanel() {
  const room = useDndRoom();
  const chars = useCharacters();
  const attachedId = room.myId ? room.profiles[room.myId]?.charId : undefined;
  const connected = room.online?.status === "open";

  const [viewId, setViewId] = useState<string | null>(null);
  const [storedPick] = useState(readPick);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DndCharacter | null>(null);

  const has = (id: string | null | undefined): id is string => !!id && chars.some((c) => c.id === id);
  const activeId = has(viewId) ? viewId : has(attachedId) ? attachedId : has(storedPick) ? storedPick : chars[0]?.id ?? null;
  const stored = chars.find((c) => c.id === activeId) ?? null;
  const current = draft && draft.id === activeId ? draft : stored;
  const isShared = !!current && current.id === attachedId;

  // Latest room value for the debounced save (which runs after the render
  // that scheduled it, possibly after a reconnect changed my id).
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; });
  const pendingRef = useRef<DndCharacter | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const c = pendingRef.current;
    if (!c) return;
    pendingRef.current = null;
    const saved = saveCharacter(c);
    const r = roomRef.current;
    if (r.myId && r.profiles[r.myId]?.charId === saved.id) r.attachCharacter(saved);
    // Keep tokens linked to this sheet in step with its HP.
    r.setBoard((s) => {
      if (!s.tokens.some((t) => t.charId === saved.id && (t.hpCurrent !== saved.hpCurrent || (saved.hpMax > 0 && t.hpMax !== saved.hpMax)))) return s;
      return {
        ...s,
        tokens: s.tokens.map((t) => (t.charId === saved.id
          ? { ...t, hpCurrent: saved.hpCurrent, hpMax: saved.hpMax > 0 ? saved.hpMax : t.hpMax }
          : t)),
      };
    });
    setDraft((d) => (d === c ? null : d));
  }, []);

  const update = useCallback((c: DndCharacter) => {
    setDraft(c);
    pendingRef.current = c;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  }, [flush]);

  // Never drop the last edits when the drawer closes.
  useEffect(() => () => flush(), [flush]);

  function pick(id: string) {
    flush();
    setViewId(id);
    writePick(id);
    // While sharing a sheet, switching sheets switches what the table sees.
    if (attachedId && connected) {
      const c = chars.find((x) => x.id === id);
      if (c) room.attachCharacter(c);
    }
  }

  function newSheet() {
    flush();
    const c = saveCharacter(blankCharacter());
    setViewId(c.id);
    writePick(c.id);
    setEditing(true);
  }

  if (!current) {
    return (
      <div className="dnd-mychar">
        <p className="muted">You don’t have a character sheet yet.</p>
        <button className="dnd-primary" onClick={newSheet}>+ New character</button>
      </div>
    );
  }

  return (
    <div className="dnd-mychar">
      <div className="dnd-mychar-bar">
        <select value={current.id} onChange={(e) => pick(e.target.value)} aria-label="Character">
          {chars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || "Unnamed"}{c.className ? ` (${c.className})` : ""}{c.id === attachedId ? " — shared" : ""}
            </option>
          ))}
        </select>
        <button className="ghost-btn small" onClick={newSheet} title="New character">+ New</button>
        <button className={editing ? "dnd-primary" : ""} onClick={() => setEditing((v) => !v)}>
          {editing ? "Done editing" : "Edit sheet"}
        </button>
      </div>

      {connected && !room.readOnly && (
        <div className="dnd-mychar-share">
          {isShared ? (
            <>
              <span className="small">✓ Shared with the table — edits update for everyone.</span>
              <button className="ghost-btn small" onClick={() => room.attachCharacter(null)}>Stop sharing</button>
            </>
          ) : (
            <>
              <span className="muted small">Not shared with the table.</span>
              <button className="ghost-btn small" onClick={() => { flush(); room.attachCharacter(current); }}>Share with table</button>
            </>
          )}
        </div>
      )}

      {editing ? (
        <CharacterEditorBody character={current} onChange={update} />
      ) : (
        <>
          <CharacterQuickBar c={current} onChange={update} />
          <CharacterSheetView c={current} />
        </>
      )}
    </div>
  );
}
