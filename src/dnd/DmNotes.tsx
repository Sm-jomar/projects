import { useEffect, useRef, useState } from "react";
import { listNotes, saveNote, deleteNote, type DmNote } from "./dndStorage";
import { newId } from "./dndTypes";

// Notes kept only in this browser (the original DM Notes). Campaign notes
// live on the server; onImport copies a personal note into a campaign.
export function DmNotes({ importTargets, onImport }: {
  importTargets?: { id: string; name: string }[];
  onImport?: (note: DmNote, campaignId: string) => void;
} = {}) {
  const [notes, setNotes] = useState<DmNote[]>(() => listNotes());
  const [activeId, setActiveId] = useState<string | null>(() => listNotes()[0]?.id ?? null);

  const active = notes.find((n) => n.id === activeId) ?? null;

  // Debounced persist. The pending edit is flushed when switching notes or
  // unmounting (e.g. closing the tabletop drawer) so the last keystrokes
  // are never dropped.
  const pendingRef = useRef<DmNote | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (pendingRef.current) { saveNote(pendingRef.current); pendingRef.current = null; }
  }
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current) saveNote(pendingRef.current);
  }, []);

  function update(patch: Partial<DmNote>) {
    if (!active) return;
    const next = { ...active, ...patch };
    setNotes((ns) => ns.map((n) => (n.id === next.id ? next : n)));
    if (pendingRef.current && pendingRef.current.id !== next.id) flush();
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  }

  function addNote() {
    flush();
    // saveNote stamps updatedAt.
    const n: DmNote = { id: newId("note"), title: "Untitled note", body: "", updatedAt: 0 };
    saveNote(n);
    setNotes(listNotes());
    setActiveId(n.id);
  }

  function removeNote(id: string) {
    if (!confirm("Delete this note?")) return;
    flush();
    deleteNote(id);
    const rest = listNotes();
    setNotes(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
  }

  return (
    <div className="dnd-section dnd-notes">
      <div className="dnd-section-head">
        <h2>Personal notes</h2>
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
              <div className="dnd-notes-foot">
                <span className="muted small">Saved on this device · last edited {new Date(active.updatedAt).toLocaleString()}</span>
                {onImport && importTargets && importTargets.length > 0 && (
                  <select value="" aria-label="Copy into a campaign"
                          onChange={(e) => { if (e.target.value) { flush(); onImport(active, e.target.value); } }}>
                    <option value="">Copy into campaign…</option>
                    {importTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>
            </>
          ) : (
            <p className="muted">Select a note or create a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}
