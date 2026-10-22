import { useMemo, useRef, useState } from "react";
import { unitById, upgradeById } from "../data/catalog";
import { FACTIONS } from "../lib/factions";
import { POINTS_MODE_LABEL } from "../lib/points";
import { parseTtaList, type TtaImport } from "../lib/ttaList";
import { totalPoints } from "../lib/validation";

type Props = {
  title: string;
  actionLabel: string;
  onImport: (result: TtaImport) => void;
  onClose: () => void;
};

/** Paste or open a Tabletop Admiral export (JSON, listbuilder link or
 * text), preview what matched, then hand it to `onImport`. */
export function TtaImportModal({ title, actionLabel, onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => (text.trim() ? parseTtaList(text) : null), [text]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  const army = result?.army;
  const ours = army ? totalPoints(army.entries, army.pointsMode) : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tta-import" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <div className="saved-row-actions">
            <button onClick={() => fileRef.current?.click()}>Open file…</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              style={{ display: "none" }}
              onChange={onFile}
            />
            <button className="close-btn" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        <p className="muted small">
          Paste a Tabletop Admiral export: the JSON file, the listbuilder link, or the
          text view.
        </p>
        <textarea
          className="tta-import-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"listname":"","points":748,... or https://tabletopadmiral.com/listbuilder/...'
          rows={6}
        />
        {text.trim() && !result && (
          <p className="tta-import-warn">That doesn't look like a Tabletop Admiral list.</p>
        )}
        {army && result && (
          <div className="tta-import-preview">
            <div className="small">
              <strong>{army.name}</strong> · {FACTIONS[army.faction].short}
              {army.battleForce ? ` · ${army.battleForce}` : ""} · {army.entries.length} units ·{" "}
              {ours} pts ({POINTS_MODE_LABEL[army.pointsMode ?? "printed"]})
              {result.ttaPoints !== undefined && result.ttaPoints !== ours && (
                <span className="tta-import-warn"> · Tabletop Admiral says {result.ttaPoints}</span>
              )}
            </div>
            <ul className="tta-import-units small">
              {army.entries.map((e) => {
                const u = unitById(e.unitId);
                return (
                  <li key={e.entryId}>
                    {u ? `${u.name}${u.sub_title ? `, ${u.sub_title}` : ""}` : e.unitId}
                    {e.upgrades?.length ? (
                      <span className="muted">
                        {" "}
                        ({e.upgrades.map((id) => upgradeById(id)?.name ?? id).join(", ")})
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {result.unmatched.length > 0 && (
              <div className="tta-import-warn small">
                Not in our catalog, left out: {result.unmatched.join("; ")}
              </div>
            )}
          </div>
        )}
        <div className="saved-row-actions tta-import-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            disabled={!army || army.entries.length === 0}
            onClick={() => result && onImport(result)}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
