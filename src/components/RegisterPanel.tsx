import { useEffect, useRef, useState } from "react";
import type { TodRegister } from "../lib/types";
import {
  deleteRegister,
  listRegisters,
  loadRegister,
  saveRegister,
} from "../lib/storage";
import {
  blankRegister,
  downloadJson,
  jsonToRegisters,
  registersToJson,
} from "../lib/register";
import { RegisterEditor } from "./RegisterEditor";

type Props = {
  onClose: () => void;
};

export function RegisterPanel({ onClose }: Props) {
  const [registers, setRegisters] = useState<TodRegister[]>([]);
  const [editing, setEditing] = useState<TodRegister | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRegisters(listRegisters());
  }, []);

  function refresh() {
    setRegisters(listRegisters());
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  function startNew() {
    setEditing(blankRegister());
  }

  function openOne(id: string) {
    const r = loadRegister(id);
    if (r) setEditing(r);
  }

  function saveEditing() {
    if (!editing) return;
    const saved = saveRegister(editing);
    setEditing(saved);
    refresh();
    flash(`Saved "${saved.name || "Untitled"}".`);
  }

  function deleteEditing() {
    if (!editing) return;
    deleteRegister(editing.id);
    setEditing(null);
    refresh();
    flash("Register deleted.");
  }

  function exportAll() {
    if (registers.length === 0) {
      alert("No registers to export.");
      return;
    }
    downloadJson(
      `tod-registers-${new Date().toISOString().slice(0, 10)}.json`,
      registersToJson(registers),
    );
  }

  function exportOne(r: TodRegister) {
    const safe = (r.name || "register").replace(/[^a-z0-9-_]+/gi, "-");
    downloadJson(
      `tod-register-${safe}-${new Date().toISOString().slice(0, 10)}.json`,
      registersToJson([r]),
    );
  }

  function pickFile() {
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { registers: parsed, errors } = jsonToRegisters(text);
      if (parsed.length === 0) {
        alert(`Nothing to import.\n${errors.join("\n")}`);
        return;
      }
      const summary = errors.length
        ? `\n\nWarnings:\n${errors.slice(0, 5).join("\n")}`
        : "";
      if (
        confirm(
          `Import ${parsed.length} register${parsed.length === 1 ? "" : "s"}?` +
            summary,
        )
      ) {
        for (const r of parsed) saveRegister(r);
        refresh();
        flash(`Imported ${parsed.length}.`);
      }
    } catch (err) {
      alert(`Failed to read file: ${(err as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop" onClick={editing ? undefined : onClose}>
      <div className="register-modal" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <RegisterEditor
            register={editing}
            onChange={setEditing}
            onSave={saveEditing}
            onClose={() => {
              setEditing(null);
            }}
            onDelete={deleteEditing}
          />
        ) : (
          <>
            <header className="modal-head">
              <h2>Tours of Duty Registers</h2>
              <div className="saved-row-actions">
                <button onClick={startNew}>+ New register</button>
                <button onClick={exportAll}>Export all</button>
                <button onClick={pickFile}>Import</button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={onFile}
                />
                <button className="close-btn" onClick={onClose}>
                  ×
                </button>
              </div>
            </header>
            {registers.length === 0 ? (
              <p className="muted">
                No registers yet. Click <strong>+ New register</strong> to start one.
              </p>
            ) : (
              <ul className="saved-list">
                {registers.map((r) => (
                  <li key={r.id} className="saved-row">
                    <div className="saved-row-main">
                      <div className="saved-row-name">
                        {r.name || "Untitled register"}
                      </div>
                      <div className="muted small">
                        {r.dossiers.length} dossier
                        {r.dossiers.length === 1 ? "" : "s"} ·{" "}
                        {new Date(r.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="saved-row-actions">
                      <button onClick={() => openOne(r.id)}>Open</button>
                      <button onClick={() => exportOne(r)}>Export</button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete "${r.name || "Untitled register"}"?`,
                            )
                          ) {
                            deleteRegister(r.id);
                            refresh();
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {toast && <div className="toast">{toast}</div>}
          </>
        )}
      </div>
    </div>
  );
}
