import { useEffect, useRef, useState } from "react";
import { deleteNpc, putNpc, type CampaignNpc, type CampaignView } from "./campaign";
import { blankCharacter, newId, type DndCharacter } from "./dndTypes";
import { useCharacters } from "./useCharacters";
import { CharacterEditorBody } from "./CharacterEditor";

// Hidden NPC sheets for a campaign — full 5e sheets only owners/Co-DMs can
// see. onPlace (DM screen) drops one onto the board as a token.
export function CampaignNpcs({ code, npcs, mutate, onPlace, compact }: {
  code: string;
  npcs: CampaignNpc[];
  mutate: (fn: (v: CampaignView) => CampaignView) => void;
  onPlace?: (npc: CampaignNpc) => void;
  compact?: boolean;
}) {
  const chars = useCharacters();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = npcs.find((n) => n.id === openId) ?? null;

  const pendingRef = useRef<CampaignNpc | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(code);
  useEffect(() => { codeRef.current = code; }, [code]);

  function send(n: CampaignNpc) {
    putNpc(codeRef.current, { id: n.id, character: n.character, dmNotes: n.dmNotes })
      .then(() => setError(null), (e: Error) => setError(e.message));
  }
  function flush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const n = pendingRef.current;
    pendingRef.current = null;
    if (n) send(n);
  }
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const n = pendingRef.current;
    if (n) putNpc(codeRef.current, { id: n.id, character: n.character, dmNotes: n.dmNotes }).catch(() => {});
  }, []);

  function update(next: CampaignNpc) {
    mutate((v) => ({ ...v, npcs: (v.npcs ?? []).map((x) => (x.id === next.id ? next : x)) }));
    if (pendingRef.current && pendingRef.current.id !== next.id) flush();
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 600);
  }

  function create(from?: DndCharacter) {
    flush();
    const id = newId("npc");
    const base = from ? structuredClone(from) : blankCharacter();
    const npc: CampaignNpc = {
      id,
      character: { ...base, id, playerName: "", name: base.name || "New NPC" },
      dmNotes: "",
      updatedAt: 0,
    };
    mutate((v) => ({ ...v, npcs: [npc, ...(v.npcs ?? [])] }));
    setOpenId(id);
    send(npc);
  }

  function remove(n: CampaignNpc) {
    if (!confirm(`Delete NPC "${n.character.name || "Unnamed"}"?`)) return;
    if (pendingRef.current?.id === n.id) { pendingRef.current = null; if (timerRef.current) clearTimeout(timerRef.current); }
    mutate((v) => ({ ...v, npcs: (v.npcs ?? []).filter((x) => x.id !== n.id) }));
    if (openId === n.id) setOpenId(null);
    deleteNpc(code, n.id).catch((e: Error) => setError(e.message));
  }

  if (open) {
    return (
      <div className="dnd-camp-npc-edit">
        <div className="dnd-camp-row">
          <button className="ghost-btn" onClick={() => { flush(); setOpenId(null); }}>← All NPCs</button>
          <span className="muted small" style={{ flex: 1 }}>🔒 Only the DM side can see this sheet</span>
          {onPlace && <button className="dnd-primary" onClick={() => { flush(); onPlace(open); }}>Place on board</button>}
        </div>
        {error && <p className="dnd-camp-error">{error}</p>}
        <label className="dnd-field dnd-textarea">
          <span>DM notes (tactics, secrets, motivations)</span>
          <textarea rows={3} value={open.dmNotes} onChange={(e) => update({ ...open, dmNotes: e.target.value })} />
        </label>
        <CharacterEditorBody character={open.character} onChange={(c) => update({ ...open, character: { ...c, id: open.id } })} />
      </div>
    );
  }

  return (
    <div className={"dnd-camp-npcs" + (compact ? " compact" : "")}>
      <div className="dnd-camp-row">
        <button className="dnd-primary" onClick={() => create()}>+ New NPC</button>
        {chars.length > 0 && (
          <select value="" onChange={(e) => { const c = chars.find((x) => x.id === e.target.value); if (c) create(c); }}>
            <option value="">Copy from my characters…</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name || "Unnamed"}</option>)}
          </select>
        )}
      </div>
      {error && <p className="dnd-camp-error">{error}</p>}
      {npcs.length === 0 ? (
        <p className="muted small">No NPCs yet. Prepare villains, allies and monsters here — players never see these sheets.</p>
      ) : (
        <ul className="dnd-card-list">
          {npcs.map((n) => (
            <li key={n.id} className="dnd-card-row">
              <div className="dnd-card-main">
                <div className="dnd-card-title">{n.character.name || "Unnamed NPC"}</div>
                <div className="muted small">
                  {[n.character.className, n.character.race].filter(Boolean).join(" · ") || "—"}
                  {" · "}AC {n.character.armorClass} · HP {n.character.hpMax || "—"}
                </div>
              </div>
              <div className="dnd-card-actions">
                {onPlace && <button onClick={() => onPlace(n)} title="Add as a token on the board">Place</button>}
                <button onClick={() => setOpenId(n.id)}>Open</button>
                <button className="danger" onClick={() => remove(n)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
