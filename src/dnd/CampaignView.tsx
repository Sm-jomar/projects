import { useState } from "react";
import {
  campaignShareUrl, canEdit, deleteCampaign, patchCampaign, rotateCode, ROLE_LABEL,
  type CampaignRole,
} from "./campaign";
import { removeEntry, upsertEntry, type KeyringEntry } from "./campaignKeyring";
import { useCampaign } from "./useCampaign";
import { CampaignNotesEditor } from "./CampaignNotesEditor";
import { CampaignNpcs } from "./CampaignNpcs";
import { CampaignMapLibrary } from "./CampaignMapLibrary";

type Tab = "notes" | "npcs" | "maps" | "share" | "settings";

// One campaign, as seen by whichever code this browser holds for it. The
// server already filtered the view: a player code never receives DM-only
// notes, NPCs, maps or other codes.
export function CampaignView({ entry, onBack }: { entry: KeyringEntry; onBack: () => void }) {
  const { view, error, loading, reload, mutate } = useCampaign(entry.code);
  const [tab, setTab] = useState<Tab>("notes");
  const [msg, setMsg] = useState<string | null>(null);

  const role: CampaignRole = view?.role ?? entry.role;
  const editor = canEdit(role);

  async function rename() {
    if (!view) return;
    const n = prompt("Campaign name", view.campaign.name);
    if (!n || n.trim() === view.campaign.name) return;
    try {
      const v = await patchCampaign(entry.code, { name: n.trim() });
      mutate(() => v);
      upsertEntry({ campaignId: v.campaign.id, code: entry.code, role: v.role, name: v.campaign.name });
    } catch (e) { setMsg((e as Error).message); }
  }

  async function saveDescription(description: string) {
    try {
      const v = await patchCampaign(entry.code, { description });
      mutate(() => v);
    } catch (e) { setMsg((e as Error).message); }
  }

  if (loading && !view) return <div className="dnd-section"><p className="muted">Loading campaign…</p></div>;

  if (error && !view) {
    return (
      <div className="dnd-section dnd-camp">
        <div className="dnd-section-head">
          <button className="ghost-btn" onClick={onBack}>← My campaigns</button>
          <h2>{entry.name}</h2>
        </div>
        <p className="dnd-camp-error">{error.status === 404
          ? "This code no longer works — the campaign was deleted or the code was replaced."
          : error.message}</p>
        <div className="dnd-camp-row">
          <button onClick={reload}>Try again</button>
          {error.status === 404 && (
            <button className="danger" onClick={() => { removeEntry(entry.campaignId); onBack(); }}>Remove from My campaigns</button>
          )}
        </div>
      </div>
    );
  }
  if (!view) return null;

  const tabs: { key: Tab; label: string }[] = editor
    ? [
        { key: "notes", label: `Notes (${view.notes.length})` },
        { key: "npcs", label: `NPCs (${view.npcs?.length ?? 0})` },
        { key: "maps", label: `Maps (${view.maps?.length ?? 0})` },
        { key: "share", label: "Share" },
        ...(role === "owner" ? [{ key: "settings" as const, label: "Settings" }] : []),
      ]
    : [];

  return (
    <div className="dnd-section dnd-camp">
      <div className="dnd-section-head">
        <button className="ghost-btn" onClick={onBack}>← My campaigns</button>
        <h2>{view.campaign.name}</h2>
        <span className={"dnd-camp-role " + role}>{ROLE_LABEL[role]}</span>
        {editor && <button className="ghost-btn small" onClick={() => void rename()}>Rename</button>}
        <button className="ghost-btn small" onClick={reload} title="Fetch the latest from the server">↻</button>
      </div>
      {msg && <p className="dnd-camp-error">{msg}</p>}

      {!editor ? (
        <div className="dnd-camp-journal">
          {view.campaign.description && <p className="dnd-camp-desc">{view.campaign.description}</p>}
          <h3>Journal</h3>
          {view.notes.length === 0 ? (
            <p className="muted small">Your DM hasn’t shared any notes yet.</p>
          ) : (
            view.notes.map((n) => (
              <article key={n.id} className="dnd-camp-journal-entry">
                <h4>{n.title || "Untitled"}</h4>
                <p>{n.body}</p>
              </article>
            ))
          )}
        </div>
      ) : (
        <>
          <DescriptionField value={view.campaign.description} onSave={(d) => void saveDescription(d)} />
          <div className="dnd-camp-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key}
                      className={"dnd-camp-tab" + (tab === t.key ? " active" : "")} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === "notes" && <CampaignNotesEditor code={entry.code} notes={view.notes} mutate={mutate} />}
          {tab === "npcs" && <CampaignNpcs code={entry.code} npcs={view.npcs ?? []} mutate={mutate} />}
          {tab === "maps" && <CampaignMapLibrary code={entry.code} maps={view.maps ?? []} mutate={mutate} />}
          {tab === "share" && <SharePanel codes={view.codes ?? {}} />}
          {tab === "settings" && role === "owner" && (
            <SettingsPanel
              entry={entry}
              name={view.campaign.name}
              onRotated={(r, code) => {
                mutate((v) => ({ ...v, codes: { ...(v.codes ?? {}), [r]: code } }));
                if (r === "owner") upsertEntry({ campaignId: view.campaign.id, code, role: "owner", name: view.campaign.name }, true);
              }}
              onDeleted={() => { removeEntry(entry.campaignId); onBack(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

function DescriptionField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <label className="dnd-field dnd-textarea dnd-camp-desc-field">
      <span>Description (players can see this)</span>
      <textarea rows={2} value={shown} maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft != null && draft !== value) onSave(draft); setDraft(null); }} />
    </label>
  );
}

function copy(text: string) { navigator.clipboard?.writeText(text).catch(() => {}); }

function SharePanel({ codes }: { codes: Partial<Record<CampaignRole, string>> }) {
  const rows: { role: CampaignRole; what: string }[] = [
    { role: "player", what: "Players: read the Journal (notes you mark “Players can see”) and the description. They never see DM-only notes, NPCs, maps or codes." },
    { role: "codm", what: "Co-DMs: full prep access — notes, NPCs and maps — and may take the DM seat in a game when it’s free." },
    { role: "owner", what: "Owner: everything a Co-DM can do, plus replacing codes and deleting the campaign. Keep this one to yourself." },
  ];
  return (
    <div className="dnd-camp-share">
      {rows.filter((r) => codes[r.role]).map((r) => (
        <div key={r.role} className="dnd-camp-code-row">
          <div className="dnd-camp-code-head">
            <span className={"dnd-camp-role " + r.role}>{ROLE_LABEL[r.role]} code</span>
            <span className="muted small">{r.what}</span>
          </div>
          <div className="dnd-camp-code">
            <code>{codes[r.role]}</code>
            <button onClick={() => copy(codes[r.role]!)}>Copy code</button>
            <button className="ghost-btn small" onClick={() => copy(campaignShareUrl(codes[r.role]!))}>Copy link</button>
          </div>
        </div>
      ))}
      <p className="muted small">Anyone with a code gets that level of access. If a code leaks, replace it in Settings (owner only).</p>
    </div>
  );
}

function SettingsPanel({ entry, name, onRotated, onDeleted }: {
  entry: KeyringEntry;
  name: string;
  onRotated: (role: CampaignRole, code: string) => void;
  onDeleted: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  async function rotate(role: CampaignRole) {
    const warn = role === "owner"
      ? "Replace the OWNER code? Every copy of the old one stops working. This browser switches to the new code automatically — back it up afterwards."
      : `Replace the ${ROLE_LABEL[role]} code? Everyone using the old one loses access until you share the new one.`;
    if (!confirm(warn)) return;
    try {
      const { code } = await rotateCode(entry.code, role);
      onRotated(role, code);
      setMsg(`New ${ROLE_LABEL[role]} code created — see Share.`);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function destroy() {
    const typed = prompt(`This permanently deletes “${name}” — all notes, NPCs and maps — for everyone.\nType the campaign name to confirm:`);
    if (typed?.trim() !== name) return;
    try {
      await deleteCampaign(entry.code);
      onDeleted();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="dnd-camp-settings">
      <h3>Replace codes</h3>
      <div className="dnd-camp-row">
        <button onClick={() => void rotate("player")}>New player code</button>
        <button onClick={() => void rotate("codm")}>New Co-DM code</button>
        <button onClick={() => void rotate("owner")}>New owner code</button>
      </div>
      <h3>Danger zone</h3>
      <button className="danger" onClick={() => void destroy()}>Delete campaign</button>
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
