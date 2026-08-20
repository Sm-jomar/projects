import { lazy, Suspense } from "react";
import LegionApp from "./App";
import { LandingPage } from "./components/LandingPage";
import { resolveApp } from "./lib/appRouting";

// The D&D app is a separate feature set; lazy-load it so visitors to the
// hub or the Legion app don't download it.
const DndApp = lazy(() =>
  import("./dnd/DndApp").then((m) => ({ default: m.DndApp })),
);
// Hidden /model page — lazy-loaded so it never ships to ordinary visitors.
const ModelStudio = lazy(() =>
  import("./model/ModelStudio").then((m) => ({ default: m.ModelStudio })),
);
// /upload/<session_id> — the Tripo Forge GPT's browser upload page.
const UploadPage = lazy(() =>
  import("./upload/UploadPage").then((m) => ({ default: m.UploadPage })),
);

// Top-level switch between the eslegion.com hub, the Legion app, the D&D
// app, the hidden /model page, and the /upload/<id> page, chosen from the
// path (see lib/appRouting). /model is intentionally unreachable from any
// button or nav link anywhere in this codebase — grep before adding one.
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
  if (app === "model") {
    return (
      <Suspense fallback={null}>
        <ModelStudio />
      </Suspense>
    );
  }
  if (app === "upload") {
    return (
      <Suspense fallback={null}>
        <UploadPage />
      </Suspense>
    );
  }
  return <LegionApp />;
}
