import { useRef } from "react";
import { FACTIONS } from "../lib/factions";
import type { SavedArmy } from "../lib/types";
import { armiesToCsv, csvToArmies, downloadCsv } from "../lib/csv";

type Props = {
  armies: SavedArmy[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onImport: (armies: SavedArmy[]) => void;
};

export function SavedListsPanel({
  armies,
  onLoad,
  onDelete,
  onClose,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function exportAll() {
    if (armies.length === 0) {
      alert("No saved lists to export.");
      return;
    }
    const csv = armiesToCsv(armies);
    downloadCsv(`legion-lists-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function pickFile() {
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { armies: parsed, errors } = csvToArmies(text);
      if (parsed.length === 0) {
        alert(`Nothing to import.\n${errors.join("\n")}`);
        return;
      }
      const summary = errors.length
        ? `\n\nWarnings:\n${errors.slice(0, 5).join("\n")}`
        : "";
      if (
        confirm(
          `Import ${parsed.length} list${parsed.length === 1 ? "" : "s"} from CSV?` +
            summary,
        )
      ) {
        onImport(parsed);
      }
    } catch (err) {
      alert(`Failed to read CSV: ${(err as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Saved lists</h2>
          <div className="saved-row-actions">
            <button onClick={exportAll}>Export CSV</button>
            <button onClick={pickFile}>Import CSV</button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={onFile}
            />
            <button className="close-btn" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        {armies.length === 0 ? (
          <p className="muted">No saved lists yet. Build one and hit Save.</p>
        ) : (
          <ul className="saved-list">
            {armies.map((a) => {
              const f = FACTIONS[a.faction];
              return (
                <li key={a.id} className="saved-row">
                  <div className="saved-row-main">
                    <div className="saved-row-name">{a.name || "Untitled"}</div>
                    <div className="muted small">
                      {f.short} · {a.entries.length} units ·{" "}
                      {new Date(a.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="saved-row-actions">
                    <button onClick={() => onLoad(a.id)}>Load</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete "${a.name || "Untitled"}"?`)) {
                          onDelete(a.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
