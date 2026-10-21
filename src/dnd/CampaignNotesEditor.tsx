import { useEffect, useRef, useState } from "react";
import { deleteNote, putNote, type CampaignNote, type CampaignView } from "./campaign";
import { newId } from "./dndTypes";

type SaveState = "idle" | "saving" | "saved" | "error";

// Campaign notes for owners/Co-DMs. Each note is DM-only (hidden story,
// secrets) or visible to players (handouts, recaps in their Journal).
// Edits are optimistic and debounced; a pending save is flushed when
// switching notes or unmounting (keepalive, so closing the drawer or tab
// mid-save still lands).
export function CampaignNotesEditor({ code, notes, mutate, compact }: {
  code: string;
  notes: CampaignNote[];
  mutate: (fn: (v: CampaignView) => CampaignView) => void;
  compact?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(() => notes[0]?.id ?? null);
  const [save, setSave] = useState<SaveState>("idle");
  const active = notes.find((n) => n.id === activeId) ?? null;

  const pendingRef = useRef<CampaignNote | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(code);
  useEffect(() => { codeRef.current = code; }, [code]);

  function send(n: CampaignNote, keepalive: boolean) {
    setSave("saving");
    putNote(codeRef.current, { id: n.id, title: n.title, body: n.body, visibility: n.visibility }, keepalive)
      .then(() => setSave("saved"), () => setSave("error"));
  }
  function flush(keepalive = false) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const n = pendingRef.current;
    pendingRef.current = null;
    if (n) send(n, keepalive);
  }
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const n = pendingRef.current;
    if (n) putNote(codeRef.current, { id: n.id, title: n.title, body: n.body, visibility: n.visibility }, true).catch(() => {});
  }, []);

  function setLocal(n: CampaignNote) {
    mutate((v) => ({ ...v, notes: v.notes.map((x) => (x.id === n.id ? n : x)) }));
  }
  function update(patch: Partial<CampaignNote>) {
    if (!active) return;
    const next = { ...active, ...patch };
    setLocal(next);
    if (pendingRef.current && pendingRef.current.id !== next.id) flush();
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), 600);
    setSave("idle");
  }
  function select(id: string) {
    flush();
    setActiveId(id);
  }
  function addNote() {
    flush();
    const n: CampaignNote = { id: newId("note"), title: "Untitled note", body: "", visibility: "dm", updatedAt: 0 };
    mutate((v) => ({ ...v, notes: [n, ...v.notes] }));
    setActiveId(n.id);
    send(n, false);
  }
  function removeNote(id: string) {
    if (!confirm("Delete this note for everyone in the campaign?")) return;
    if (pendingRef.current?.id === id) { pendingRef.current = null; if (timerRef.current) clearTimeout(timerRef.current); }
    mutate((v) => ({ ...v, notes: v.notes.filter((x) => x.id !== id) }));
    if (activeId === id) setActiveId(notes.find((n) => n.id !== id)?.id ?? null);
    deleteNote(code, id).catch(() => setSave("error"));
  }

  return (
    <div className={"dnd-camp-notes" + (compact ? " compact" : "")}>
      <div className="dnd-camp-notes-bar">
        <button className="dnd-primary" onClick={addNote}>+ New note</button>
        <span className={"muted small dnd-camp-save " + save}>
          {save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Couldn’t save — check your connection" : ""}
        </span>
      </div>
      <div className="dnd-notes-body">
        <ul className="dnd-notes-list">
          {notes.length === 0 && <li className="muted small empty">No notes yet.</li>}
          {notes.map((n) => (
            <li key={n.id} className={"dnd-notes-item" + (n.id === activeId ? " active" : "")} onClick={() => select(n.id)}>
              <span className="dnd-camp-vis-icon" title={n.visibility === "dm" ? "DM only" : "Visible to players"}>
                {n.visibility === "dm" ? "🔒" : "👁"}
              </span>
              <span className="dnd-notes-item-title">{n.title || "Untitled"}</span>
              <button className="danger dnd-notes-del" onClick={(e) => { e.stopPropagation(); removeNote(n.id); }} aria-label="Delete note">×</button>
            </li>
          ))}
        </ul>
        {active ? (
          <div className="dnd-notes-editor">
            <input className="dnd-notes-title" value={active.title} onChange={(e) => update({ title: e.target.value })} placeholder="Title" />
            <div className="dnd-camp-vis" role="group" aria-label="Who can see this note">
              <button className={active.visibility === "dm" ? "on" : ""} onClick={() => update({ visibility: "dm" })}>🔒 DM only</button>
              <button className={active.visibility === "players" ? "on" : ""} onClick={() => update({ visibility: "players" })}>👁 Players can see</button>
            </div>
            <textarea className="dnd-notes-text" value={active.body} onChange={(e) => update({ body: e.target.value })}
                      placeholder={active.visibility === "dm" ? "Secrets, plot threads, encounter notes…" : "Handouts, recaps, anything the players may read…"} />
          </div>
        ) : (
          <div className="dnd-notes-editor muted">Select or create a note.</div>
        )}
      </div>
    </div>
  );
}
