import { useEffect, useRef, useState } from "react";
import { blankCharacter, type DndCharacter } from "./dndTypes";
import { CharacterEditor } from "./CharacterEditor";
import { useCharacters } from "./useCharacters";
import { loadCharacter, saveCharacter, deleteCharacter } from "./dndStorage";

export function CharacterSheets() {
  const chars = useCharacters();
  const [editing, setEditing] = useState<DndCharacter | null>(null);
  // Latest unsaved edit, flushed if the component unmounts mid-debounce
  // (e.g. switching tabs right after typing).
  const pendingRef = useRef<DndCharacter | null>(null);

  // Debounced auto-save of the character being edited so nothing is lost.
  useEffect(() => {
    if (!editing) return;
    pendingRef.current = editing;
    const t = setTimeout(() => { saveCharacter(editing); pendingRef.current = null; }, 500);
    return () => clearTimeout(t);
  }, [editing]);
  useEffect(() => () => { if (pendingRef.current) saveCharacter(pendingRef.current); }, []);

  if (editing) {
    return (
      <CharacterEditor
        character={editing}
        onChange={setEditing}
        onBack={() => { saveCharacter(editing); pendingRef.current = null; setEditing(null); }}
        onDelete={() => {
          if (confirm(`Delete "${editing.name || "Unnamed character"}"?`)) {
            pendingRef.current = null;
            deleteCharacter(editing.id);
            setEditing(null);
          }
        }}
      />
    );
  }

  return (
    <div className="dnd-section">
      <div className="dnd-section-head">
        <h2>Character Sheets</h2>
        <button className="dnd-primary" onClick={() => setEditing(blankCharacter())}>
          + New character
        </button>
      </div>
      {chars.length === 0 ? (
        <p className="muted">No characters yet. Click <b>+ New character</b> to build a 5e sheet.</p>
      ) : (
        <ul className="dnd-card-list">
          {chars.map((c) => (
            <li key={c.id} className="dnd-card-row">
              <div className="dnd-card-main">
                <div className="dnd-card-title">{c.name || "Unnamed character"}</div>
                <div className="muted small">
                  {[c.className, c.race, c.background].filter(Boolean).join(" · ") || "—"}
                  {" · "}Lv {c.level} · updated {new Date(c.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="dnd-card-actions">
                <button onClick={() => setEditing(loadCharacter(c.id) ?? c)}>Open</button>
                <button className="danger" onClick={() => {
                  if (confirm(`Delete "${c.name || "Unnamed character"}"?`)) deleteCharacter(c.id);
                }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
