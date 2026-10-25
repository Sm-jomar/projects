// File buttons shared by Character Sheets and the tabletop's character
// tray: import sheets (JSON or a filled 5e PDF) and give a character an
// STL miniature that is saved with the sheet.

import { useRef, useState } from "react";
import type { DndCharacter } from "./dndTypes";
import { loadCharacter, saveCharacter } from "./dndStorage";
import { importCharacterFiles } from "./characterImport";

export function ImportSheetsButton({ label = "Import sheet…", onImported }: {
  label?: string;
  onImported?: (chars: DndCharacter[], errors: string[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    if (ref.current) ref.current.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const { characters, errors } = await importCharacterFiles(files);
      const saved = characters.map(saveCharacter);
      onImported?.(saved, errors);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={busy}
              title="A character JSON (ours or D&D Beyond's) or a filled-in 5e character sheet PDF">
        {busy ? "Importing…" : label}
      </button>
      <input ref={ref} type="file" multiple hidden
             accept=".json,.pdf,application/json,application/pdf" onChange={onFiles} />
    </>
  );
}

export function CharacterModelControls({ character, compact = false, onNote }: {
  character: DndCharacter;
  compact?: boolean;
  onNote?: (text: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Merge onto the stored copy so an open editor's pending edits aren't lost.
  const save = (p: Partial<DndCharacter>) => saveCharacter({ ...(loadCharacter(character.id) ?? character), ...p });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (ref.current) ref.current.value = "";
    if (!f) return;
    if (f.size > 80 * 1024 * 1024) { onNote?.("That STL is over 80 MB — export a lighter version."); return; }
    setBusy(true);
    try {
      const { encodeStlFile } = await import("../lib/stlModel");
      const m = await encodeStlFile(f);
      save({ modelStl: m.data, modelName: f.name });
      onNote?.(m.shared
        ? `Saved ${f.name} to ${character.name || "this character"}.`
        : `Couldn't reach the model server, so ${f.name} was trimmed to ${m.triangles.toLocaleString()} triangles and kept on this device only.`);
    } catch (err) {
      onNote?.(err instanceof Error && err.message ? err.message : "Could not read that STL file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={busy}
              title={character.modelName ? `Model: ${character.modelName}` : "Load an STL miniature for this character"}>
        {busy ? "Processing…" : character.modelStl ? (compact ? "▲ STL" : "Replace STL") : (compact ? "+ STL" : "Load STL")}
      </button>
      {character.modelStl && !compact && (
        <button className="ghost-btn" onClick={() => save({ modelStl: undefined, modelName: undefined })}>Remove STL</button>
      )}
      <input ref={ref} type="file" hidden accept=".stl,model/stl,application/sla" onChange={onFile} />
    </>
  );
}
