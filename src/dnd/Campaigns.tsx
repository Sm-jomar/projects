import { useState } from "react";
import { canEdit, createCampaign, fetchCampaign, parseCampaignCode, putNote, ROLE_LABEL } from "./campaign";
import { exportKeyring, importKeyring, removeEntry, upsertEntry } from "./campaignKeyring";
import { useKeyring } from "./useCampaign";
import { CampaignView } from "./CampaignView";
import { DmNotes } from "./DmNotes";
import { newId } from "./dndTypes";
import type { DmNote } from "./dndStorage";

// "My campaigns" — every campaign this browser holds a code for. Creating
// one makes you its owner; pasting a code (or opening a share link) adds
// it at that code's role.
export function Campaigns() {
  const keyring = useKeyring();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [ownerCode, setOwnerCode] = useState<{ code: string; campaignId: string; name: string } | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  // A share link (/dnd#campaign=<code>) offers to add that campaign.
  const [linkCode, setLinkCode] = useState<string | null>(() => parseCampaignCode(window.location.hash)?.code ?? null);

  const open = keyring.find((e) => e.campaignId === openId);
  if (open) return <CampaignView entry={open} onBack={() => setOpenId(null)} />;

  function clearHash() {
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  async function addCode(raw: string) {
    const parsed = parseCampaignCode(raw);
    if (!parsed) { setMsg({ kind: "err", text: "That doesn't look like a campaign code." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const v = await fetchCampaign(parsed.code);
      upsertEntry({ campaignId: v.campaign.id, code: parsed.code, role: v.role, name: v.campaign.name });
      setMsg({ kind: "ok", text: `Added “${v.campaign.name}” as ${ROLE_LABEL[v.role]}.` });
      setAdding(false);
      setCodeInput("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const { code, view } = await createCampaign(newName.trim() || "Untitled campaign", newDesc.trim());
      upsertEntry({ campaignId: view.campaign.id, code, role: "owner", name: view.campaign.name });
      setOwnerCode({ code, campaignId: view.campaign.id, name: view.campaign.name });
      setCreating(false);
      setNewName("");
      setNewDesc("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function remove(campaignId: string, name: string, owner: boolean) {
    const warn = owner
      ? `Remove “${name}” from this browser?\n\nYou are the OWNER. Unless you've saved the owner code somewhere, you will permanently lose owner access. The campaign itself is not deleted.`
      : `Remove “${name}” from My campaigns? You can add it again with the code.`;
    if (confirm(warn)) removeEntry(campaignId);
  }

  const editable = keyring.filter((e) => canEdit(e.role) && !e.stale);
  async function importNote(n: DmNote, campaignId: string) {
    const target = editable.find((e) => e.campaignId === campaignId);
    if (!target) return;
    try {
      await putNote(target.code, { id: newId("note"), title: n.title, body: n.body, visibility: "dm" });
      setMsg({ kind: "ok", text: `Copied “${n.title || "Untitled"}” into ${target.name} as a DM-only note.` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  }

  return (
    <div className="dnd-section dnd-camp">
      <div className="dnd-section-head">
        <h2>Campaigns</h2>
        <button onClick={() => { setAdding((v) => !v); setCreating(false); }}>Add by code</button>
        <button className="dnd-primary" onClick={() => { setCreating((v) => !v); setAdding(false); }}>+ New campaign</button>
      </div>

      {linkCode && (
        <div className="dnd-camp-banner">
          <span>You opened a campaign link.</span>
          <button className="dnd-primary" disabled={busy} onClick={() => { const c = linkCode; setLinkCode(null); clearHash(); void addCode(c); }}>Add to My campaigns</button>
          <button className="ghost-btn small" onClick={() => { setLinkCode(null); clearHash(); }}>Dismiss</button>
        </div>
      )}

      {creating && (
        <div className="dnd-camp-form">
          <input value={newName} placeholder="Campaign name" maxLength={80} autoFocus onChange={(e) => setNewName(e.target.value)} />
          <textarea value={newDesc} rows={2} maxLength={2000} placeholder="Short description (players can see this)" onChange={(e) => setNewDesc(e.target.value)} />
          <div className="dnd-camp-row">
            <button className="dnd-primary" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create"}</button>
            <button className="ghost-btn" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {adding && (
        <div className="dnd-camp-form">
          <input value={codeInput} placeholder="Paste a campaign code or link" autoFocus
                 onChange={(e) => setCodeInput(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") void addCode(codeInput); }} />
          <div className="dnd-camp-row">
            <button className="dnd-primary" disabled={busy || !codeInput.trim()} onClick={() => void addCode(codeInput)}>{busy ? "Checking…" : "Add"}</button>
            <button className="ghost-btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <p className={msg.kind === "ok" ? "dnd-camp-okmsg" : "dnd-camp-error"}>{msg.text}</p>}

      {keyring.length === 0 ? (
        <p className="muted">No campaigns yet. Create one to keep hidden DM notes, NPC sheets and saved maps — or add one your DM shared with you.</p>
      ) : (
        <ul className="dnd-card-list">
          {keyring.map((e) => (
            <li key={e.campaignId} className={"dnd-card-row" + (e.stale ? " stale" : "")}>
              <div className="dnd-card-main">
                <div className="dnd-card-title">{e.name || "Campaign"}</div>
                <div className="muted small">
                  <span className={"dnd-camp-role " + e.role}>{ROLE_LABEL[e.role]}</span>
                  {e.stale && <span className="dnd-camp-stale"> · code no longer works</span>}
                </div>
              </div>
              <div className="dnd-card-actions">
                <button onClick={() => setOpenId(e.campaignId)}>Open</button>
                <button className="ghost-btn small" onClick={() => remove(e.campaignId, e.name, e.role === "owner")}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="dnd-camp-backup">
        <button className="ghost-btn small" onClick={() => setBackup((b) => (b == null ? exportKeyring() : null))}>
          {backup == null ? "Back up / restore my codes" : "Hide backup"}
        </button>
        {backup != null && (
          <div className="dnd-camp-form">
            <p className="muted small">Your codes are your access — there are no accounts. Copy this somewhere safe; paste a backup here and press Restore on another device.</p>
            <textarea rows={6} value={backup} onChange={(e) => setBackup(e.target.value)} spellCheck={false} />
            <div className="dnd-camp-row">
              <button onClick={() => navigator.clipboard?.writeText(backup).catch(() => {})}>Copy</button>
              <button onClick={() => {
                try { const n = importKeyring(backup); setMsg({ kind: "ok", text: `Restored ${n} campaign code${n === 1 ? "" : "s"}.` }); }
                catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
              }}>Restore from text</button>
            </div>
          </div>
        )}
      </div>

      <details className="dnd-camp-personal">
        <summary>Personal notes (this device only)</summary>
        <DmNotes
          importTargets={editable.map((e) => ({ id: e.campaignId, name: e.name }))}
          onImport={(n, id) => void importNote(n, id)}
        />
      </details>

      {ownerCode && (
        <div className="dnd-modal-overlay">
          <div className="dnd-modal">
            <div className="dnd-modal-head"><b>Save your owner code</b></div>
            <div className="dnd-modal-body dnd-camp-owner-modal">
              <p>“{ownerCode.name}” is ready. This browser now holds its <b>owner code</b>. There are no accounts — if this browser’s data is cleared and you haven’t saved the code, owner access is gone for good.</p>
              <div className="dnd-camp-code"><code>{ownerCode.code}</code></div>
              <div className="dnd-camp-row">
                <button onClick={() => navigator.clipboard?.writeText(ownerCode.code).catch(() => {})}>Copy owner code</button>
                <button className="dnd-primary" onClick={() => { const id = ownerCode.campaignId; setOwnerCode(null); setOpenId(id); }}>I’ve saved it — open campaign</button>
              </div>
              <p className="muted small">Share the Player or Co-DM codes from the campaign’s Share tab — never this one.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
