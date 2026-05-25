import { useState } from "react";
import { CardBrowser } from "./CardBrowser";
import { RulebookViewer } from "./RulebookViewer";

type Tab = "cards" | "rulebooks";

type Props = {
  onClose: () => void;
};

export function ReferencePanel({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("cards");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="reference-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="ref-tabs">
            <button
              className={"ref-tab" + (tab === "cards" ? " active" : "")}
              onClick={() => setTab("cards")}
            >
              Cards
            </button>
            <button
              className={"ref-tab" + (tab === "rulebooks" ? " active" : "")}
              onClick={() => setTab("rulebooks")}
            >
              Rulebooks
            </button>
          </div>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="reference-body">
          {tab === "cards" ? <CardBrowser /> : <RulebookViewer />}
        </div>
      </div>
    </div>
  );
}
