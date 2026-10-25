import { useEffect, useRef, useState } from "react";
import { blankCharacter, type DndCharacter } from "./dndTypes";
import { CharacterEditor } from "./CharacterEditor";
import { useCharacters } from "./useCharacters";
import { loadCharacter, saveCharacter, deleteCharacter } from "./dndStorage";
import { CharacterModelControls, ImportSheetsButton } from "./CharacterFiles";
import { exportCharactersJson, importSummary } from "./characterImport";

function downloadSheet(c: DndCharacter) {
  const blob = new Blob([exportCharactersJson([c])], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(c.name || "character").replace(/[^\w-]+/g, "_")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CharacterSheets() {
  const chars = useCharacters();
  const [editing, setEditing] = useState<DndCharacter | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
        <div className="dnd-card-actions">
          <ImportSheetsButton onImported={(cs, errs) => setNote(importSummary(cs, errs))} />
          <button className="dnd-primary" onClick={() => setEditing(blankCharacter())}>
            + New character
          </button>
        </div>
      </div>
      {note && <p className="muted small">{note} <button className="ghost-btn small" onClick={() => setNote(null)}>×</button></p>}
      {chars.length === 0 ? (
        <p className="muted">No characters yet. Click <b>+ New character</b> to build a 5e sheet, or <b>Import sheet…</b> to
          bring one in (a character JSON from here or D&amp;D Beyond, or a filled-in 5e character sheet PDF).</p>
      ) : (
        <ul className="dnd-card-list">
          {chars.map((c) => (
            <li key={c.id} className="dnd-card-row">
              <div className="dnd-card-main">
                <div className="dnd-card-title">{c.name || "Unnamed character"}</div>
                <div className="muted small">
                  {[c.className, c.race, c.background].filter(Boolean).join(" · ") || "—"}
                  {" · "}Lv {c.level} · updated {new Date(c.updatedAt).toLocaleDateString()}
                  {c.modelName && <> · ▲ {c.modelName}</>}
                </div>
              </div>
              <div className="dnd-card-actions">
                <button onClick={() => setEditing(loadCharacter(c.id) ?? c)}>Open</button>
                <CharacterModelControls character={c} onNote={setNote} />
                <button onClick={() => downloadSheet(c)}>Export</button>
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
