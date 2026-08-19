import { useState } from "react";
import type { AgendaSlot, Dossier, FactionId, RegisterObjective, TodRegister, Unit } from "../lib/types";
import { blankDossier, blankObjective } from "../lib/register";
import { FACTIONS } from "../lib/factions";
import { cardForUnit } from "../lib/cardLookup";
import { UnitPickerModal } from "./UnitPickerModal";

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
  // Index of the dossier currently picking a unit, or null. A number (not
  // a boolean) so the picker knows which dossier to write the result into.
  const [pickingUnitFor, setPickingUnitFor] = useState<number | null>(null);
  const objectives = register.objectives ?? [];

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

  function pickUnitForDossier(unit: Unit) {
    if (pickingUnitFor === null) return;
    const d = register.dossiers[pickingUnitFor];
    if (d) setDossier(pickingUnitFor, { ...d, unitId: unit.id, unitName: unit.name, unitFaction: unit.faction });
    setPickingUnitFor(null);
  }

  function setObjective(idx: number, o: RegisterObjective) {
    const next = objectives.slice();
    next[idx] = o;
    setField("objectives", next);
  }

  function addObjective() {
    setField("objectives", [...objectives, blankObjective()]);
  }

  function removeObjective(idx: number) {
    setField("objectives", objectives.filter((_, i) => i !== idx));
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
              <span>Faction / Army</span>
              <select
                value={register.faction ?? ""}
                onChange={(e) => setField("faction", (e.target.value || undefined) as FactionId | undefined)}
              >
                <option value="">— Choose faction —</option>
                {Object.values(FACTIONS).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
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
            <h3>Objectives ({objectives.length})</h3>
            <button onClick={addObjective}>+ Add objective</button>
          </div>
          {objectives.length === 0 && (
            <p className="muted small empty">No objectives yet — add the missions this campaign is running.</p>
          )}
          <ul className="objective-list">
            {objectives.map((o, i) => (
              <li key={o.id} className="objective-row">
                <label className="objective-check">
                  <input
                    type="checkbox"
                    checked={o.completed}
                    onChange={(e) => setObjective(i, { ...o, completed: e.target.checked })}
                  />
                </label>
                <input
                  className={"objective-name" + (o.completed ? " done" : "")}
                  value={o.name}
                  placeholder="Objective / mission name"
                  onChange={(e) => setObjective(i, { ...o, name: e.target.value })}
                />
                <button className="remove-btn" onClick={() => removeObjective(i)} title="Remove objective">×</button>
              </li>
            ))}
          </ul>
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
                    <div className="dossier-unit-row">
                      {d.unitId && d.unitFaction && (
                        <span
                          className="dossier-unit-thumb"
                          style={(() => {
                            const card = cardForUnit({ id: d.unitId, name: d.unitName, faction: d.unitFaction });
                            return card ? { backgroundImage: `url(${card})` } : undefined;
                          })()}
                        />
                      )}
                      <input
                        value={d.unitName}
                        placeholder="Type a name, or pick from the catalog"
                        onChange={(e) =>
                          setDossier(i, { ...d, unitName: e.target.value, unitId: undefined, unitFaction: undefined })
                        }
                      />
                      <button type="button" className="ghost-btn small" onClick={() => setPickingUnitFor(i)}>
                        Pick unit ▸
                      </button>
                    </div>
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

      {pickingUnitFor !== null && (
        <UnitPickerModal
          initialFaction={register.faction ?? ""}
          onPick={pickUnitForDossier}
          onClose={() => setPickingUnitFor(null)}
        />
      )}
    </div>
  );
}
