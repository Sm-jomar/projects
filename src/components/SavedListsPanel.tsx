import { FACTIONS } from "../lib/factions";
import type { SavedArmy } from "../lib/types";

type Props = {
  armies: SavedArmy[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function SavedListsPanel({ armies, onLoad, onDelete, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Saved lists</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
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
