import { useRef, useState } from "react";
import "./dnd.css";
import { CharacterSheets } from "./CharacterSheets";
import { Campaigns } from "./Campaigns";
import { DndTabletop } from "./DndTabletop";
import { DiceRoller } from "./DiceRoller";
import { Rulebooks } from "./Rulebooks";
import { MyCharacterPanel } from "./MyCharacterPanel";
import { DndRoomProvider } from "./DndRoomContext";
import { legionUrl, homeUrl } from "../lib/appRouting";

type PageSection = "characters" | "campaigns" | "dice" | "rulebooks";
type Section = PageSection | "tabletop";
type DrawerKey = PageSection;

const NAV: { key: Section; label: string }[] = [
  { key: "characters", label: "Character Sheets" },
  { key: "campaigns", label: "Campaigns" },
  { key: "dice", label: "Dice" },
  { key: "rulebooks", label: "Rulebooks" },
  { key: "tabletop", label: "Tabletop" },
];

const DRAWER_LABEL: Record<DrawerKey, string> = {
  characters: "My character",
  campaigns: "Campaigns",
  dice: "Dice",
  rulebooks: "Rulebooks",
};

const WIDTH_KEY = "dnd.drawerWidth";
const DEFAULT_DRAWER_W = 440;

function readDrawerWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= 280 && n <= 4000 ? n : DEFAULT_DRAWER_W;
  } catch {
    return DEFAULT_DRAWER_W;
  }
}

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
    () => new URLSearchParams(window.location.search).has("room") ? "tabletop"
      : window.location.hash.includes("campaign=") ? "campaigns" : "characters",
  );
  // Table mode: while on the Tabletop, the other tabs open in a left drawer
  // beside the board instead of replacing it.
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [lastPage, setLastPage] = useState<PageSection>("characters");
  const [drawerW, setDrawerW] = useState(readDrawerWidth);
  const drawerRef = useRef<HTMLElement>(null);
  const tableMode = section === "tabletop";

  function onNav(key: Section) {
    if (tableMode) {
      if (key === "tabletop") setDrawer(null);
      else setDrawer((d) => (d === key ? null : key));
      return;
    }
    setSection(key);
    if (key !== "tabletop") setLastPage(key);
  }

  // Leaving the table expands whatever panel was open to its full page.
  function exitTable() {
    const next = drawer ?? lastPage;
    setSection(next);
    setLastPage(next);
    setDrawer(null);
  }

  // Drag-to-resize writes the width straight to the element while dragging
  // (no re-render per pointer move) and commits it on release.
  function onResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    const aside = drawerRef.current;
    if (!aside) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = aside.getBoundingClientRect().width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = startW + (ev.clientX - startX);
      aside.style.setProperty("--dnd-drawer-w", `${Math.round(w)}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const clamped = Math.round(Math.max(320, Math.min(w, window.innerWidth * 0.6)));
      setDrawerW(clamped);
      try { localStorage.setItem(WIDTH_KEY, String(clamped)); } catch { /* storage unavailable */ }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  return (
    <div className={"dnd-app" + (tableMode ? " is-table" : "")}>
      <header className="dnd-header">
        <div className="dnd-brand">
          <a className="dnd-home-link" href={homeUrl()} title="Back to eslegion.com">⌂ Home</a>
          <h1>Dungeons &amp; Dragons</h1>
          <span className="muted small">eslegion.com</span>
        </div>
        <nav className="dnd-nav">
          {NAV.map((n) => {
            const active = tableMode ? n.key === "tabletop" : section === n.key;
            const open = tableMode && drawer === n.key;
            return (
              <button key={n.key}
                      className={"dnd-nav-btn" + (active ? " active" : "") + (open ? " open" : "")}
                      title={tableMode && n.key !== "tabletop" ? "Open beside the board" : undefined}
                      onClick={() => onNav(n.key)}>
                {n.label}
              </button>
            );
          })}
        </nav>
        {tableMode
          ? <button className="dnd-exit-table" onClick={exitTable} title="Back to full-page tabs">Exit table ✕</button>
          : <a className="dnd-cross-link" href={legionUrl()}>Star Wars: Legion ▸</a>}
      </header>

      <main className="dnd-main">
        {tableMode ? (
          <div className="dnd-table-shell">
            {drawer && (
              <aside className="dnd-drawer" ref={drawerRef}
                     style={{ "--dnd-drawer-w": `${drawerW}px` } as React.CSSProperties}>
                <div className="dnd-drawer-head">
                  <b>{DRAWER_LABEL[drawer]}</b>
                  <button className="ghost-btn small" onClick={() => setDrawer(null)} aria-label="Close panel">✕</button>
                </div>
                <div className="dnd-drawer-body">
                  <DrawerPanel k={drawer} />
                </div>
                <div className="dnd-drawer-resize" role="separator" aria-orientation="vertical"
                     title="Drag to resize" onPointerDown={onResizeStart} />
              </aside>
            )}
            <div className="dnd-table-stage">
              <DndTabletop />
            </div>
          </div>
        ) : (
          <>
            {section === "characters" && <CharacterSheets />}
            {section === "campaigns" && <Campaigns />}
            {section === "dice" && <DiceRoller />}
            {section === "rulebooks" && <Rulebooks />}
          </>
        )}
      </main>
    </div>
  );
}

function DrawerPanel({ k }: { k: DrawerKey }) {
  switch (k) {
    case "characters": return <MyCharacterPanel />;
    case "campaigns": return <Campaigns />;
    case "dice": return <DiceRoller />;
    case "rulebooks": return <Rulebooks />;
  }
}
