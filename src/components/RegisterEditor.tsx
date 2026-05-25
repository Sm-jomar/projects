import { useState } from "react";
import type { AgendaSlot, Dossier, TodRegister } from "../lib/types";
import { blankDossier } from "../lib/register";

type Props = {
  register: TodRegister;
  onChange: (r: TodRegister) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete: () => void;
};

function PipBoxes({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pip-boxes">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value;
        return (
          <button
            key={i}
            type="button"
            className={"pip-box" + (filled ? " filled" : "")}
            // Click on the last filled box clears just that pip; clicking
            // anywhere else sets the value to that index + 1.
            onClick={() => onChange(value === i + 1 ? i : i + 1)}
            aria-label={`Set to ${i + 1}`}
          />
        );
      })}
    </div>
  );
}

export function RegisterEditor({
  register,
  onChange,
  onSave,
  onClose,
  onDelete,
}: Props) {
  const [showDelete, setShowDelete] = useState(false);

  function setField<K extends keyof TodRegister>(key: K, value: TodRegister[K]) {
    onChange({ ...register, [key]: value });
  }

  function setAgenda(idx: number, slot: AgendaSlot) {
    const next = register.agendas.slice();
    next[idx] = slot;
    setField("agendas", next);
  }

  function setDossier(idx: number, dossier: Dossier) {
    const next = register.dossiers.slice();
    next[idx] = dossier;
    setField("dossiers", next);
  }

  function addDossier() {
    setField("dossiers", [...register.dossiers, blankDossier()]);
  }

  function removeDossier(idx: number) {
    if (!confirm("Remove this dossier?")) return;
    setField(
      "dossiers",
      register.dossiers.filter((_, i) => i !== idx),
    );
  }

  return (
    <div className="register-editor">
      <header className="register-head">
        <div className="register-head-main">
          <button onClick={onClose} className="ghost-btn">
            ← Back
          </button>
          <input
            className="list-name"
            placeholder="Register name (e.g. Tour of Duty 4)"
            value={register.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </div>
        <div className="register-head-actions">
          <button onClick={onSave}>Save</button>
          {showDelete ? (
            <>
              <button className="danger" onClick={onDelete}>
                Confirm delete
              </button>
              <button onClick={() => setShowDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="danger" onClick={() => setShowDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </header>

      <div className="register-body">
        <section className="register-section">
          <h3>Register</h3>
          <div className="form-grid two-col">
            <label className="field">
              <span>Name</span>
              <input
                value={register.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Operative or company name"
              />
            </label>
            <label className="field">
              <span>Reputation</span>
              <input
                value={register.reputation}
                onChange={(e) => setField("reputation", e.target.value)}
              />
            </label>
            <label className="field full">
              <span>Story Arc</span>
              <input
                value={register.storyArc}
                onChange={(e) => setField("storyArc", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Combat Potential</span>
              <input
                value={register.combatPotential}
                onChange={(e) => setField("combatPotential", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Combat Potential Spent</span>
              <input
                value={register.combatPotentialSpent}
                onChange={(e) =>
                  setField("combatPotentialSpent", e.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Supply Points</span>
              <input
                value={register.supplyPoints}
                onChange={(e) => setField("supplyPoints", e.target.value)}
              />
            </label>
            <label className="field full">
              <span>Strategic Assets</span>
              <textarea
                rows={3}
                value={register.strategicAssets}
                onChange={(e) => setField("strategicAssets", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="register-section">
          <h3>Agendas</h3>
          <div className="agenda-row">
            {register.agendas.map((a, i) => (
              <div className="agenda-slot" key={i}>
                <label className="field">
                  <span>Agenda {i + 1}</span>
                  <input
                    value={a.name}
                    onChange={(e) =>
                      setAgenda(i, { ...a, name: e.target.value })
                    }
                  />
                </label>
                <div className="field">
                  <span>Progression</span>
                  <PipBoxes
                    value={a.progression}
                    max={5}
                    onChange={(n) => setAgenda(i, { ...a, progression: n })}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="register-section">
          <div className="section-head">
            <h3>Dossiers ({register.dossiers.length})</h3>
            <button onClick={addDossier}>+ Add dossier</button>
          </div>
          {register.dossiers.length === 0 && (
            <p className="muted small empty">No dossiers yet.</p>
          )}
          <div className="dossier-list">
            {register.dossiers.map((d, i) => (
              <article className="dossier" key={d.id}>
                <header className="dossier-head">
                  <span className="muted small">Dossier {i + 1}</span>
                  <button
                    className="remove-btn"
                    onClick={() => removeDossier(i)}
                    title="Remove dossier"
                  >
                    ×
                  </button>
                </header>
                <div className="form-grid two-col">
                  <label className="field">
                    <span>Dossier Name</span>
                    <input
                      value={d.dossierName}
                      onChange={(e) =>
                        setDossier(i, { ...d, dossierName: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Unit Name</span>
                    <input
                      value={d.unitName}
                      onChange={(e) =>
                        setDossier(i, { ...d, unitName: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Setbacks</span>
                    <textarea
                      rows={2}
                      value={d.setbacks}
                      onChange={(e) =>
                        setDossier(i, { ...d, setbacks: e.target.value })
                      }
                    />
                  </label>
                  <div className="field">
                    <span>Veteran Rank</span>
                    <div className="rank-row">
                      <PipBoxes
                        value={d.veteranRank}
                        max={5}
                        onChange={(n) =>
                          setDossier(i, { ...d, veteranRank: n })
                        }
                      />
                      <input
                        className="experience-input"
                        placeholder="Experience"
                        value={d.experience}
                        onChange={(e) =>
                          setDossier(i, { ...d, experience: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <label className="field">
                    <span>Upgrades</span>
                    <textarea
                      rows={3}
                      value={d.upgrades}
                      onChange={(e) =>
                        setDossier(i, { ...d, upgrades: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Commendations</span>
                    <textarea
                      rows={3}
                      value={d.commendations}
                      onChange={(e) =>
                        setDossier(i, { ...d, commendations: e.target.value })
                      }
                    />
                  </label>
                  <label className="field full">
                    <span>Points Spent</span>
                    <input
                      value={d.pointsSpent}
                      onChange={(e) =>
                        setDossier(i, { ...d, pointsSpent: e.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
