import { useState } from "react";
import { useDndRoom } from "./dndRoom";
import { useCharacters } from "./useCharacters";
import { answerRequest, modifierText, requestLabel } from "./dndDice";
import { fetchCampaign, ROLE_LABEL } from "./campaign";
import { upsertEntry } from "./campaignKeyring";
import type { DndCharacter } from "./dndTypes";
import type { IncomingRollRequest, RollMode } from "./dndProtocol";

function readPick(): string | null {
  try { return localStorage.getItem("dnd.mychar"); } catch { return null; }
}

// Roll requests from the DM ("Perception check, DC 15") and campaign
// invites, shown above the board and in the dice panel. The modifier comes
// from the sheet you've shared with the game (or your picked sheet).
export function RollRequestBanner({ withInvites }: { withInvites?: boolean }) {
  const room = useDndRoom();
  const chars = useCharacters();
  const [pick] = useState(readPick);
  if (room.rollRequests.length === 0 && (!withInvites || room.campaignInvites.length === 0)) return null;

  const shared = room.myId ? room.profiles[room.myId]?.character : undefined;
  const character: DndCharacter | null = shared ?? chars.find((c) => c.id === pick) ?? null;

  return (
    <div className="dnd-req-banners">
      {room.rollRequests.map((r) => <RequestCard key={r.id} req={r} character={character} />)}
      {withInvites && room.campaignInvites.map((inv) => (
        <InviteCard key={inv.campaignId} invite={inv} onDone={() => room.dismissInvite(inv.campaignId)} />
      ))}
    </div>
  );
}

function RequestCard({ req, character }: { req: IncomingRollRequest; character: DndCharacter | null }) {
  const room = useDndRoom();
  const [manual, setManual] = useState(0);
  const needsManual = !character && req.kind !== "custom";

  function roll(mode: RollMode) {
    const payload = answerRequest(req, character, mode, manual);
    if (!payload) return;
    room.sendRoll(payload, { vis: req.vis, requestId: req.id, dc: req.dc });
    room.dismissRollRequest(req.id);
  }

  return (
    <div className="dnd-req-banner">
      <div className="dnd-req-text">
        <b>🎲 {req.fromName} asks: {requestLabel(req)}</b>
        <span className="small">
          {req.dc != null && <> · DC {req.dc}</>}
          {req.vis === "dm" && <> · 🔒 only the DM sees the result</>}
          {req.mode !== "normal" && <> · {req.mode === "adv" ? "with advantage" : "with disadvantage"}</>}
          {!needsManual && <> · {modifierText(character, req, manual)}{character ? ` (${character.name || "your sheet"})` : ""}</>}
        </span>
        {req.note && <span className="muted small">“{req.note}”</span>}
      </div>
      <div className="dnd-req-actions">
        {needsManual && (
          <label className="dnd-req-mod" title="No sheet shared — enter your modifier">
            Mod
            <input type="number" value={manual} onChange={(e) => setManual(Number(e.target.value) || 0)} />
          </label>
        )}
        <button className="dnd-primary" onClick={() => roll(req.mode)}>Roll</button>
        {req.kind !== "custom" && req.mode === "normal" && (
          <>
            <button onClick={() => roll("adv")} title="Roll with advantage">Adv</button>
            <button onClick={() => roll("dis")} title="Roll with disadvantage">Dis</button>
          </>
        )}
        <button className="ghost-btn small" onClick={() => room.dismissRollRequest(req.id)}>Dismiss</button>
      </div>
    </div>
  );
}

function InviteCard({ invite, onDone }: { invite: { campaignId: string; name: string; code: string; from: string }; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "err">("idle");
  async function accept() {
    setState("busy");
    try {
      // Confirm with the server what this code is before saving it.
      const v = await fetchCampaign(invite.code);
      upsertEntry({ campaignId: v.campaign.id, code: invite.code, role: v.role, name: v.campaign.name });
      onDone();
      alert(`Added “${v.campaign.name}” to My campaigns as ${ROLE_LABEL[v.role]}. Open it under Campaigns.`);
    } catch {
      setState("err");
    }
  }
  return (
    <div className="dnd-req-banner invite">
      <div className="dnd-req-text">
        <b>📜 {invite.from} invited you to “{invite.name}”</b>
        <span className="small">Adds the campaign’s player Journal to your Campaigns tab.</span>
        {state === "err" && <span className="dnd-camp-error">That invite no longer works.</span>}
      </div>
      <div className="dnd-req-actions">
        <button className="dnd-primary" disabled={state === "busy"} onClick={() => void accept()}>Add to My campaigns</button>
        <button className="ghost-btn small" onClick={onDone}>Dismiss</button>
      </div>
    </div>
  );
}
