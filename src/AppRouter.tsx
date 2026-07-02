import { lazy, Suspense } from "react";
import LegionApp from "./App";
import { LandingPage } from "./components/LandingPage";
import { resolveApp } from "./lib/appRouting";

// The D&D app is a separate feature set; lazy-load it so visitors to the
// hub or the Legion app don't download it.
const DndApp = lazy(() =>
  import("./dnd/DndApp").then((m) => ({ default: m.DndApp })),
);

// Top-level switch between the eslegion.com hub, the Legion app, and the
// D&D app, chosen from the hostname (see lib/appRouting).
export default function AppRouter() {
  const app = resolveApp();
  if (app === "home") return <LandingPage />;
  if (app === "dnd") {
    return (
      <Suspense fallback={<div className="dnd-app-loading">Loading…</div>}>
        <DndApp />
      </Suspense>
    );
  }
  return <LegionApp />;
}
