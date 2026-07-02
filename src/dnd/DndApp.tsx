import { useState } from "react";
import "./dnd.css";
import { CharacterSheets } from "./CharacterSheets";
import { DmNotes } from "./DmNotes";
import { DndTabletop } from "./DndTabletop";
import { legionUrl, homeUrl } from "../lib/appRouting";

type Section = "characters" | "notes" | "rulebooks" | "tabletop";

const NAV: { key: Section; label: string }[] = [
  { key: "characters", label: "Character Sheets" },
  { key: "notes", label: "DM Notes" },
  { key: "rulebooks", label: "Rulebooks" },
  { key: "tabletop", label: "Tabletop" },
];

export function DndApp() {
  const [section, setSection] = useState<Section>("characters");

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
        {section === "rulebooks" && <ComingSoon title="Rulebooks"
          note="Import your own D&D PDFs and browse them here. This will reuse the same PDF importer + rulebook viewer built for Legion." />}
        {section === "tabletop" && <DndTabletop />}
      </main>
    </div>
  );
}

function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="dnd-section">
      <div className="dnd-section-head"><h2>{title}</h2></div>
      <div className="dnd-coming-soon">
        <p><b>Coming next.</b></p>
        <p className="muted">{note}</p>
      </div>
    </div>
  );
}
