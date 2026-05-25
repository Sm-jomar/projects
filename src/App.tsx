import { useEffect, useState } from "react";
import "./App.css";
import { FactionPicker } from "./components/FactionPicker";
import { UnitBrowser } from "./components/UnitBrowser";
import { ArmyRoster } from "./components/ArmyRoster";
import { SavedListsPanel } from "./components/SavedListsPanel";
import { ReferencePanel } from "./components/ReferencePanel";
import { DEFAULT_POINTS_CAP } from "./lib/factions";
import type { ArmyEntry, FactionId, SavedArmy, Unit } from "./lib/types";
import {
  deleteArmy,
  listArmies,
  loadArmy,
  newId,
  saveArmy,
} from "./lib/storage";

type WorkingArmy = {
  id: string;
  name: string;
  faction: FactionId;
  pointsCap: number;
  entries: ArmyEntry[];
};

export default function App() {
  const [army, setArmy] = useState<WorkingArmy | null>(null);
  const [saved, setSaved] = useState<SavedArmy[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    setSaved(listArmies());
  }, []);

  function startNewArmy(faction: FactionId) {
    setArmy({
      id: newId(),
      name: "",
      faction,
      pointsCap: DEFAULT_POINTS_CAP,
      entries: [],
    });
  }

  function discardArmy() {
    if (army && army.entries.length > 0) {
      if (!confirm("Discard the current list and start over?")) return;
    }
    setArmy(null);
  }

  function addUnit(unit: Unit) {
    if (!army) return;
    setArmy({
      ...army,
      entries: [...army.entries, { entryId: newId(), unitId: unit.id }],
    });
  }

  function removeEntry(entryId: string) {
    if (!army) return;
    setArmy({
      ...army,
      entries: army.entries.filter((e) => e.entryId !== entryId),
    });
  }

  function persist() {
    if (!army) return;
    const toSave: SavedArmy = {
      id: army.id,
      name: army.name.trim() || "Untitled",
      faction: army.faction,
      pointsCap: army.pointsCap,
      entries: army.entries,
      updatedAt: Date.now(),
    };
    saveArmy(toSave);
    setSaved(listArmies());
    setSavedToast(`Saved "${toSave.name}".`);
    setTimeout(() => setSavedToast(null), 2000);
  }

  function load(id: string) {
    const loaded = loadArmy(id);
    if (!loaded) return;
    setArmy({
      id: loaded.id,
      name: loaded.name,
      faction: loaded.faction,
      pointsCap: loaded.pointsCap,
      entries: loaded.entries,
    });
    setShowSaved(false);
  }

  function remove(id: string) {
    deleteArmy(id);
    setSaved(listArmies());
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Legion Army Builder</h1>
          <span className="muted small">Star Wars: Legion</span>
        </div>
        <div className="app-actions">
          {army && (
            <>
              <button onClick={persist}>Save</button>
              <button onClick={discardArmy}>New / Switch faction</button>
            </>
          )}
          <button onClick={() => setShowReference(true)}>
            Reference
          </button>
          <button onClick={() => setShowSaved(true)}>
            Saved lists ({saved.length})
          </button>
        </div>
      </header>

      {!army ? (
        <main className="main center">
          <FactionPicker onPick={startNewArmy} />
        </main>
      ) : (
        <main className="main builder">
          <UnitBrowser
            faction={army.faction}
            army={{
              faction: army.faction,
              pointsCap: army.pointsCap,
              entries: army.entries,
            }}
            onAdd={addUnit}
          />
          <ArmyRoster
            army={{
              faction: army.faction,
              pointsCap: army.pointsCap,
              entries: army.entries,
            }}
            faction={army.faction}
            name={army.name}
            onNameChange={(name) => setArmy({ ...army, name })}
            onCapChange={(cap) => setArmy({ ...army, pointsCap: cap })}
            onRemove={removeEntry}
          />
        </main>
      )}

      {showSaved && (
        <SavedListsPanel
          armies={saved}
          onLoad={load}
          onDelete={remove}
          onClose={() => setShowSaved(false)}
        />
      )}

      {showReference && (
        <ReferencePanel onClose={() => setShowReference(false)} />
      )}

      {savedToast && <div className="toast">{savedToast}</div>}
    </div>
  );
}
