import { lazy, Suspense, useEffect, useState } from "react";
import "./App.css";
import { FactionPicker } from "./components/FactionPicker";
import { UnitBrowser } from "./components/UnitBrowser";
import { ArmyRoster } from "./components/ArmyRoster";
import { SavedListsPanel } from "./components/SavedListsPanel";
import { ReferencePanel } from "./components/ReferencePanel";
import { RegisterPanel } from "./components/RegisterPanel";
import { TabletopPanel } from "./components/TabletopPanel";
// PDF importer pulls in ~10MB of WASM/JS (pdf.js, tesseract.js, jszip);
// lazy-load it so the main bundle stays small for users who don't import.
const PdfImporterPanel = lazy(() =>
  import("./components/PdfImporterPanel").then((m) => ({ default: m.PdfImporterPanel })),
);
import { DEFAULT_POINTS_CAP } from "./lib/factions";
import type { ArmyEntry, FactionId, SavedArmy, Unit } from "./lib/types";
import {
  deleteArmy,
  listArmies,
  loadArmy,
  newId,
  saveArmy,
} from "./lib/storage";
import { autoExportFlags, getLastAutoExport } from "./lib/flags";

const AUTO_EXPORT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function formatElapsed(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

import type { PointsMode } from "./lib/points";

type WorkingArmy = {
  id: string;
  name: string;
  faction: FactionId;
  battleForce?: string;
  pointsCap: number;
  pointsMode: PointsMode;
  entries: ArmyEntry[];
};

export default function App() {
  const [army, setArmy] = useState<WorkingArmy | null>(null);
  const [saved, setSaved] = useState<SavedArmy[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [showRegisters, setShowRegisters] = useState(false);
  // Auto-open the Tabletop when arriving on a multiplayer invite link
  // (?room=CODE) so the join + name/color prompt appears immediately.
  const [showTabletop, setShowTabletop] = useState(
    () => new URLSearchParams(window.location.search).has("room"),
  );
  const [showPdfImporter, setShowPdfImporter] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [lastAutoExport, setLastAutoExportState] = useState<number | null>(() =>
    getLastAutoExport(),
  );
  // Re-render every 30s so the "auto-saved Xm ago" label stays current.
  const [, setNowTick] = useState(0);

  useEffect(() => {
    setSaved(listArmies());
  }, []);

  // Every 30 minutes, if there are new flags, download them as JSON and
  // clear the store. NOTE: a static GitHub Pages site can't push to the
  // repo directly, so this downloads to the browser; commit the file to
  // GitHub to apply corrections.
  useEffect(() => {
    const tick = setInterval(() => {
      void autoExportFlags().then((n) => {
        if (n > 0) {
          setLastAutoExportState(getLastAutoExport());
          setSavedToast(`Auto-saved ${n} flag${n === 1 ? "" : "s"}.`);
          setTimeout(() => setSavedToast(null), 2500);
        }
      });
    }, AUTO_EXPORT_INTERVAL_MS);
    const label = setInterval(() => setNowTick((t) => t + 1), 30000);
    return () => {
      clearInterval(tick);
      clearInterval(label);
    };
  }, []);

  function startNewArmy(faction: FactionId, battleForce?: string) {
    setArmy({
      id: newId(),
      name: "",
      faction,
      ...(battleForce ? { battleForce } : {}),
      pointsCap: DEFAULT_POINTS_CAP,
      pointsMode: "printed",
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

  function attachUpgrade(entryId: string, upgradeId: string) {
    if (!army) return;
    setArmy({
      ...army,
      entries: army.entries.map((e) =>
        e.entryId === entryId
          ? { ...e, upgrades: [...(e.upgrades ?? []), upgradeId] }
          : e,
      ),
    });
  }

  function detachUpgrade(entryId: string, upgradeId: string) {
    if (!army) return;
    setArmy({
      ...army,
      entries: army.entries.map((e) =>
        e.entryId === entryId
          ? {
              ...e,
              upgrades: (e.upgrades ?? []).filter((u) => u !== upgradeId),
            }
          : e,
      ),
    });
  }

  function persist() {
    if (!army) return;
    const toSave: SavedArmy = {
      id: army.id,
      name: army.name.trim() || "Untitled",
      faction: army.faction,
      ...(army.battleForce ? { battleForce: army.battleForce } : {}),
      pointsCap: army.pointsCap,
      pointsMode: army.pointsMode,
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
      battleForce: loaded.battleForce,
      pointsCap: loaded.pointsCap,
      pointsMode: loaded.pointsMode ?? "printed",
      entries: loaded.entries,
    });
    setShowSaved(false);
  }

  function remove(id: string) {
    deleteArmy(id);
    setSaved(listArmies());
  }

  function importArmies(toImport: SavedArmy[]) {
    let imported = 0;
    for (const a of toImport) {
      saveArmy(a);
      imported++;
    }
    setSaved(listArmies());
    setSavedToast(`Imported ${imported} list${imported === 1 ? "" : "s"}.`);
    setTimeout(() => setSavedToast(null), 2500);
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
          <button onClick={() => setShowTabletop(true)}>
            Tabletop
          </button>
          <button onClick={() => setShowRegisters(true)}>
            Tours of Duty
          </button>
          <button onClick={() => setShowPdfImporter(true)}>
            PDF Import
          </button>
          <button onClick={() => setShowSaved(true)}>
            Saved lists ({saved.length})
          </button>
          <span className="muted small flag-clock" title="Flags auto-export to a JSON download every 30 minutes">
            🚩{" "}
            {lastAutoExport
              ? `auto-saved ${formatElapsed(Date.now() - lastAutoExport)}`
              : "auto-save on (30m)"}
          </span>
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
            battleForce={army.battleForce}
            army={{
              faction: army.faction,
              pointsCap: army.pointsCap,
              pointsMode: army.pointsMode,
              entries: army.entries,
            }}
            onAdd={addUnit}
            onOpenReference={() => setShowReference(true)}
          />
          <ArmyRoster
            army={{
              faction: army.faction,
              pointsCap: army.pointsCap,
              pointsMode: army.pointsMode,
              entries: army.entries,
            }}
            faction={army.faction}
            name={army.name}
            battleForce={army.battleForce}
            pointsMode={army.pointsMode}
            onNameChange={(name) => setArmy({ ...army, name })}
            onBattleForceChange={(battleForce) =>
              setArmy({ ...army, battleForce })
            }
            onCapChange={(cap) => setArmy({ ...army, pointsCap: cap })}
            onPointsModeChange={(pointsMode) =>
              setArmy({ ...army, pointsMode })
            }
            onRemove={removeEntry}
            onAttachUpgrade={attachUpgrade}
            onDetachUpgrade={detachUpgrade}
          />
        </main>
      )}

      {showSaved && (
        <SavedListsPanel
          armies={saved}
          onLoad={load}
          onDelete={remove}
          onClose={() => setShowSaved(false)}
          onImport={importArmies}
        />
      )}

      {showReference && (
        <ReferencePanel onClose={() => setShowReference(false)} />
      )}

      {showRegisters && (
        <RegisterPanel onClose={() => setShowRegisters(false)} />
      )}

      {showTabletop && (
        <TabletopPanel onClose={() => setShowTabletop(false)} />
      )}

      {showPdfImporter && (
        <Suspense fallback={<div className="modal-backdrop"><div className="toast">Loading PDF importer…</div></div>}>
          <PdfImporterPanel onClose={() => setShowPdfImporter(false)} />
        </Suspense>
      )}

      {savedToast && <div className="toast">{savedToast}</div>}
    </div>
  );
}
