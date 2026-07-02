import { useEffect, useState } from "react";
import { listNotes, saveNote, deleteNote, type DmNote } from "./dndStorage";
import { newId } from "./dndTypes";

export function DmNotes() {
  const [notes, setNotes] = useState<DmNote[]>(() => listNotes());
  const [activeId, setActiveId] = useState<string | null>(() => listNotes()[0]?.id ?? null);

  const active = notes.find((n) => n.id === activeId) ?? null;

  // Debounced persist of the active note.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => saveNote(active), 500);
    return () => clearTimeout(t);
  }, [active]);

  function update(patch: Partial<DmNote>) {
    if (!active) return;
    setNotes((ns) => ns.map((n) => (n.id === active.id ? { ...n, ...patch } : n)));
  }

  function addNote() {
    const n: DmNote = { id: newId("note"), title: "Untitled note", body: "", updatedAt: Date.now() };
    saveNote(n);
    setNotes(listNotes());
    setActiveId(n.id);
  }

  function removeNote(id: string) {
    if (!confirm("Delete this note?")) return;
    deleteNote(id);
    const rest = listNotes();
    setNotes(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
  }

  return (
    <div className="dnd-section dnd-notes">
      <div className="dnd-section-head">
        <h2>DM Notes</h2>
        <button className="dnd-primary" onClick={addNote}>+ New note</button>
      </div>
      <div className="dnd-notes-body">
        <ul className="dnd-notes-list">
          {notes.length === 0 && <li className="muted small empty">No notes yet.</li>}
          {notes.map((n) => (
            <li key={n.id}
                className={"dnd-notes-item" + (n.id === activeId ? " active" : "")}
                onClick={() => setActiveId(n.id)}>
              <span className="dnd-notes-item-title">{n.title || "Untitled"}</span>
              <button className="dnd-notes-del" onClick={(e) => { e.stopPropagation(); removeNote(n.id); }} aria-label="Delete note">×</button>
            </li>
          ))}
        </ul>
        <div className="dnd-notes-editor">
          {active ? (
            <>
              <input className="dnd-notes-title" value={active.title}
                     onChange={(e) => update({ title: e.target.value })} placeholder="Note title" />
              <textarea className="dnd-notes-text" value={active.body}
                        onChange={(e) => update({ body: e.target.value })}
                        placeholder="Session notes, NPCs, plot threads, secret DM info…" />
              <div className="muted small">Auto-saved · last edited {new Date(active.updatedAt).toLocaleString()}</div>
            </>
          ) : (
            <p className="muted">Select a note or create a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}
