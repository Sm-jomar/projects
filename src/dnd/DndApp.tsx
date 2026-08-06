import { useState } from "react";
import "./dnd.css";
import { CharacterSheets } from "./CharacterSheets";
import { DmNotes } from "./DmNotes";
import { DndTabletop } from "./DndTabletop";
import { DiceRoller } from "./DiceRoller";
import { Rulebooks } from "./Rulebooks";
import { DndRoomProvider } from "./DndRoomContext";
import { legionUrl, homeUrl } from "../lib/appRouting";

type Section = "characters" | "notes" | "dice" | "rulebooks" | "tabletop";

const NAV: { key: Section; label: string }[] = [
  { key: "characters", label: "Character Sheets" },
  { key: "notes", label: "DM Notes" },
  { key: "dice", label: "Dice" },
  { key: "rulebooks", label: "Rulebooks" },
  { key: "tabletop", label: "Tabletop" },
];

// The room connection (and shared dice feed) live in this provider so they
// persist across section switches and are shared between the tabletop and
// the dice roller.
export function DndApp() {
  return (
    <DndRoomProvider>
      <DndAppInner />
    </DndRoomProvider>
  );
}

function DndAppInner() {
  // An invite link (?room=CODE) lands straight on the Tabletop.
  const [section, setSection] = useState<Section>(
    () => new URLSearchParams(window.location.search).has("room") ? "tabletop" : "characters",
  );

  return (
    <div className="dnd-app">
      <header className="dnd-header">
        <div className="dnd-brand">
          <a className="dnd-home-link" href={homeUrl()} title="Back to eslegion.com">⌂ Home</a>
          <h1>Dungeons &amp; Dragons</h1>
          <span className="muted small">eslegion.com</span>
        </div>
        <nav className="dnd-nav">
          {NAV.map((n) => (
            <button key={n.key}
                    className={"dnd-nav-btn" + (section === n.key ? " active" : "")}
                    onClick={() => setSection(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <a className="dnd-cross-link" href={legionUrl()}>Star Wars: Legion ▸</a>
      </header>

      <main className="dnd-main">
        {section === "characters" && <CharacterSheets />}
        {section === "notes" && <DmNotes />}
        {section === "dice" && <DiceRoller />}
        {section === "rulebooks" && <Rulebooks />}
        {section === "tabletop" && <DndTabletop />}
      </main>
    </div>
  );
}
