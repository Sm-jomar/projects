import { useState } from "react";
import { useDndRoom } from "./dndRoom";
import { useCampaign, useKeyring } from "./useCampaign";
import { canEdit, type CampaignNpc } from "./campaign";
import { CampaignNotesEditor } from "./CampaignNotesEditor";
import { CampaignNpcs } from "./CampaignNpcs";
import { CampaignMapLibrary } from "./CampaignMapLibrary";
import { ABILITIES, SKILLS, type AbilityKey, type SkillKey } from "./dndTypes";
import { makeToken } from "./dndTabletop";
import { checkModifier, requestLabel, rollD20, rollExpr } from "./dndDice";
import type { RollKind, RollMode, RollVis } from "./dndProtocol";

// The DM's screen: only shown to whoever holds the DM seat. Everything
// here is either local to the DM or travels on DM-only channels — except
// the board itself, which every player sees.
export function DmScreen() {
  const room = useDndRoom();
  const keyring = useKeyring();
  const editable = keyring.filter((e) => canEdit(e.role) && !e.stale);
  const linked = room.linkedCampaign;
  const linkedCode = linked ? editable.find((e) => e.campaignId === linked.id)?.code ?? null : null;
  const campaign = useCampaign(linkedCode);
  const view = campaign.view;

  function placeNpc(npc: CampaignNpc) {
    room.setBoard((s) => ({
      ...s,
      tokens: [...s.tokens, makeToken(s, {
        name: npc.character.name || "NPC",
        kind: "monster",
        color: "#c84a4a",
        hpMax: npc.character.hpMax || undefined,
        hpCurrent: (npc.character.hpCurrent || npc.character.hpMax) || undefined,
        npcId: npc.id,
      })],
    }));
  }

  return (
    <div className="dnd-dm-screen">
      {room.dmNotice && (
        <p className={room.dmNotice.kind === "ok" ? "dnd-camp-okmsg" : "dnd-camp-error"}>
          {room.dmNotice.text} <button className="ghost-btn small" onClick={room.clearDmNotice}>×</button>
        </p>
      )}

      <details className="dnd-dm-sec" open>
        <summary>Campaign</summary>
        <CampaignLink />
        {linked && !linkedCode && (
          <p className="muted small">This device doesn’t hold an owner/Co-DM code for “{linked.name}”, so its notes, NPCs and maps aren’t available here. Add the code under Campaigns.</p>
        )}
        {view?.codes?.player && (
          <button className="ghost-btn small" onClick={() => room.inviteToCampaign(view.codes!.player!)}
                  title="Sends the campaign's player code to everyone at the table, so its Journal shows up in their Campaigns tab">
            Invite players to the campaign Journal
          </button>
        )}
      </details>

      <details className="dnd-dm-sec" open>
        <summary>Call for a roll</summary>
        <CallForRoll />
      </details>

      <details className="dnd-dm-sec">
        <summary>Secret checks</summary>
        <SecretCheck />
      </details>

      <details className="dnd-dm-sec" open>
        <summary>DM dice</summary>
        <DmDice />
      </details>

      {view && linkedCode && (
        <>
          <details className="dnd-dm-sec">
            <summary>Hidden notes ({view.notes.length})</summary>
            <CampaignNotesEditor code={linkedCode} notes={view.notes} mutate={campaign.mutate} compact />
          </details>
          <details className="dnd-dm-sec">
            <summary>NPCs ({view.npcs?.length ?? 0})</summary>
            <CampaignNpcs code={linkedCode} npcs={view.npcs ?? []} mutate={campaign.mutate} onPlace={placeNpc} compact />
          </details>
          <details className="dnd-dm-sec">
            <summary>Maps ({view.maps?.length ?? 0})</summary>
            <CampaignMapLibrary code={linkedCode} maps={view.maps ?? []} mutate={campaign.mutate} />
          </details>
        </>
      )}
      {!linked && (
        <p className="muted small">Link a campaign above to bring its hidden notes, NPCs and saved maps to the table.</p>
      )}
      {campaign.error && <p className="dnd-camp-error">{campaign.error.message}</p>}

      <details className="dnd-dm-sec" open={room.staged.length > 0}>
        <summary>Staged tokens ({room.staged.length})</summary>
        <StagedTokens />
      </details>
    </div>
  );
}

function CampaignLink() {
  const room = useDndRoom();
  const keyring = useKeyring();
  const editable = keyring.filter((e) => canEdit(e.role) && !e.stale);
  const [pick, setPick] = useState("");
  const linked = room.linkedCampaign;
  return (
    <div className="dnd-dm-campaign">
      <div className="dnd-camp-row">
        <span>{linked ? <>Running <b>{linked.name}</b></> : <span className="muted">No campaign linked to this game.</span>}</span>
        {linked && <button className="ghost-btn small" onClick={room.unlinkCampaign}>Unlink</button>}
      </div>
      {editable.length > 0 ? (
        <div className="dnd-camp-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Campaign to link">
            <option value="">{linked ? "Switch to…" : "Choose a campaign…"}</option>
            {editable.filter((e) => e.campaignId !== linked?.id).map((e) => <option key={e.campaignId} value={e.code}>{e.name}</option>)}
          </select>
          <button disabled={!pick} onClick={() => { room.linkCampaign(pick); setPick(""); }}>Link</button>
        </div>
      ) : (
        <p className="muted small">Create a campaign (Campaigns tab) to link it here.</p>
      )}
    </div>
  );
}

type Target = { id: string; name: string; color: string; old: boolean };

function useTargets(): Target[] {
  const room = useDndRoom();
  return (room.online?.peers ?? [])
    .filter((p) => p.id !== room.myId && p.color !== "spectator")
    .map((p) => ({ id: p.id, name: p.name, color: p.color, old: !p.v || p.v < 2 }));
}

function CallForRoll() {
  const room = useDndRoom();
  const targets = useTargets();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<RollKind>("skill");
  const [skill, setSkill] = useState<SkillKey>("perception");
  const [ability, setAbility] = useState<AbilityKey>("dex");
  const [dice, setDice] = useState("1d20");
  const [mode, setMode] = useState<RollMode>("normal");
  const [dc, setDc] = useState("");
  const [revealDc, setRevealDc] = useState(false);
  const [vis, setVis] = useState<RollVis>("table");
  const [note, setNote] = useState("");

  const live = targets.filter((t) => !t.old);
  const chosen = live.filter((t) => picked[t.id] ?? true).map((t) => t.id);
  const key = kind === "skill" ? skill : kind === "save" || kind === "ability" ? ability : undefined;
  const dcNum = dc.trim() ? Math.max(0, Math.min(50, Math.round(Number(dc)))) : undefined;
  const label = requestLabel({ kind, key, dice: kind === "custom" ? dice : undefined, label: "" });

  function send() {
    if (chosen.length === 0) return;
    room.sendRollRequest(chosen, {
      label, kind, key, mode, vis,
      ...(kind === "custom" ? { dice } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }, dcNum, revealDc);
  }

  // Answers to my requests, matched by request id.
  function results(reqId: string) {
    return room.rollFeed.filter((r) => r.requestId === reqId && r.fromId);
  }
  function applyInitiative(reqId: string) {
    const answers = results(reqId);
    room.setBoard((s) => ({
      ...s,
      tokens: s.tokens.map((t) => {
        if (!t.charId) return t;
        const owner = Object.entries(room.profiles).find(([, p]) => p.charId === t.charId)?.[0];
        const ans = owner ? answers.find((a) => a.fromId === owner) : undefined;
        return ans ? { ...t, initiative: ans.total } : t;
      }),
    }));
  }

  if (targets.length === 0) return <p className="muted small">No players at the table yet.</p>;

  return (
    <div className="dnd-dm-call">
      <div className="dnd-dm-targets">
        {targets.map((t) => (
          <label key={t.id} className={"dnd-tt-check" + (t.old ? " muted" : "")} title={t.old ? "Their page is out of date — they need to refresh to receive roll requests" : undefined}>
            <input type="checkbox" disabled={t.old} checked={!t.old && (picked[t.id] ?? true)}
                   onChange={(e) => setPicked((p) => ({ ...p, [t.id]: e.target.checked }))} />
            <span className="dnd-party-dot" style={{ background: t.color }} /> {t.name}{t.old ? " (refresh needed)" : ""}
          </label>
        ))}
      </div>
      <div className="dnd-dm-grid">
        <label className="dnd-tt-field">Roll
          <select value={kind} onChange={(e) => setKind(e.target.value as RollKind)}>
            <option value="skill">Skill check</option>
            <option value="save">Saving throw</option>
            <option value="ability">Ability check</option>
            <option value="initiative">Initiative</option>
            <option value="custom">Custom dice</option>
          </select>
        </label>
        {kind === "skill" && (
          <label className="dnd-tt-field">Skill
            <select value={skill} onChange={(e) => setSkill(e.target.value as SkillKey)}>
              {SKILLS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        )}
        {(kind === "save" || kind === "ability") && (
          <label className="dnd-tt-field">Ability
            <select value={ability} onChange={(e) => setAbility(e.target.value as AbilityKey)}>
              {ABILITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
        )}
        {kind === "custom" && (
          <label className="dnd-tt-field">Dice
            <input value={dice} onChange={(e) => setDice(e.target.value)} placeholder="2d6+1" />
          </label>
        )}
        {kind !== "custom" && (
          <label className="dnd-tt-field">Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as RollMode)}>
              <option value="normal">Normal</option>
              <option value="adv">Advantage</option>
              <option value="dis">Disadvantage</option>
            </select>
          </label>
        )}
        <label className="dnd-tt-field">DC (optional)
          <input type="number" min={0} max={50} value={dc} onChange={(e) => setDc(e.target.value)} placeholder="—" />
        </label>
      </div>
      <div className="dnd-camp-row">
        <label className="dnd-tt-check"><input type="checkbox" checked={revealDc} disabled={!dcNum} onChange={(e) => setRevealDc(e.target.checked)} /> Tell players the DC</label>
        <label className="dnd-tt-check"><input type="checkbox" checked={vis === "dm"} onChange={(e) => setVis(e.target.checked ? "dm" : "table")} /> Results to me only (secret)</label>
      </div>
      <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="Note to players (optional) — e.g. “You hear something behind the door”" />
      <button className="dnd-primary" disabled={chosen.length === 0} onClick={send}>
        Ask {chosen.length === live.length ? "everyone" : `${chosen.length} player${chosen.length === 1 ? "" : "s"}`}: {label}{dcNum != null ? ` (DC ${dcNum})` : ""}
      </button>

      {room.outgoingRequests.length > 0 && (
        <div className="dnd-dm-tracker">
          <div className="dnd-camp-row">
            <b className="small">Requests</b>
            <button className="ghost-btn small" onClick={room.clearOutgoingRequests}>Clear</button>
          </div>
          {room.outgoingRequests.slice(0, 5).map((o) => {
            const answers = results(o.req.id);
            return (
              <div key={o.req.id} className="dnd-dm-req">
                <div className="small"><b>{requestLabel(o.req)}</b>{o.dc != null && ` · DC ${o.dc}${o.req.dc == null ? " (hidden)" : ""}`}{o.req.vis === "dm" && " · secret"}</div>
                <ul>
                  {o.to.map((id) => {
                    const t = targets.find((x) => x.id === id);
                    const a = answers.find((x) => x.fromId === id);
                    return (
                      <li key={id} className="small">
                        {t?.name ?? "Player"}: {a
                          ? <b className={o.dc != null ? (a.total >= o.dc ? "dnd-pass" : "dnd-fail") : ""}>{a.total}{o.dc != null ? (a.total >= o.dc ? " ✓" : " ✗") : ""}</b>
                          : <span className="muted">waiting…</span>}
                      </li>
                    );
                  })}
                </ul>
                {o.req.kind === "initiative" && answers.length > 0 && (
                  <button className="ghost-btn small" onClick={() => applyInitiative(o.req.id)}>Set initiative on their tokens</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Roll for a player using their shared sheet, without them knowing
// (passive Perception-style checks). Never leaves the DM's device.
function SecretCheck() {
  const room = useDndRoom();
  const withSheets = Object.entries(room.profiles).filter(([id]) => id !== room.myId);
  const [who, setWho] = useState("");
  const [skill, setSkill] = useState<SkillKey>("perception");
  const target = withSheets.find(([id]) => id === who)?.[1] ?? withSheets[0]?.[1];
  if (withSheets.length === 0) return <p className="muted small">Players who share their sheet with the game can be rolled for here.</p>;
  function roll() {
    if (!target) return;
    const mod = checkModifier(target.character, "skill", skill);
    const label = `Secret ${SKILLS.find((s) => s.key === skill)?.label} — ${target.name}`;
    room.sendRoll(rollD20("normal", mod, label), { vis: "dm" });
  }
  return (
    <div className="dnd-camp-row">
      <select value={who || withSheets[0]![0]} onChange={(e) => setWho(e.target.value)} aria-label="Player">
        {withSheets.map(([id, p]) => <option key={id} value={id}>{p.name} ({p.character.name || "sheet"})</option>)}
      </select>
      <select value={skill} onChange={(e) => setSkill(e.target.value as SkillKey)} aria-label="Skill">
        {SKILLS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={roll}>Roll secretly</button>
    </div>
  );
}

function DmDice() {
  const room = useDndRoom();
  const [expr, setExpr] = useState("1d20");
  const [mod, setMod] = useState(0);
  const [err, setErr] = useState(false);
  function rollExpression() {
    const p = rollExpr(expr);
    setErr(!p);
    if (p) room.sendRoll(p);
  }
  return (
    <div className="dnd-dm-dice">
      <label className="dnd-tt-check">
        <input type="checkbox" checked={room.dmRollPublic} onChange={(e) => room.setDmRollPublic(e.target.checked)} />
        Show my rolls to the table <span className="muted small">({room.dmRollPublic ? "players see them" : "hidden — only you see them"})</span>
      </label>
      <div className="dnd-camp-row">
        <label className="dnd-req-mod">Mod <input type="number" value={mod} onChange={(e) => setMod(Number(e.target.value) || 0)} /></label>
        <button onClick={() => room.sendRoll(rollD20("normal", mod, `d20${mod ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : ""}`))}>d20</button>
        <button onClick={() => room.sendRoll(rollD20("adv", mod, "d20 (adv)"))}>Adv</button>
        <button onClick={() => room.sendRoll(rollD20("dis", mod, "d20 (dis)"))}>Dis</button>
      </div>
      <div className="dnd-camp-row">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="e.g. 2d6+3"
               onKeyDown={(e) => { if (e.key === "Enter") rollExpression(); }} style={{ width: 120 }} />
        <button onClick={rollExpression}>Roll</button>
        {err && <span className="dnd-camp-error">Try something like 2d6+3</span>}
      </div>
    </div>
  );
}

function StagedTokens() {
  const room = useDndRoom();
  if (room.staged.length === 0) {
    return <p className="muted small">Load a map with “stage its tokens” to keep monsters hidden here until you reveal them.</p>;
  }
  return (
    <div className="dnd-dm-staged">
      <div className="dnd-camp-row">
        <button className="dnd-primary" onClick={() => room.revealStaged("all")}>Reveal all</button>
        <button className="ghost-btn small" onClick={() => { if (confirm("Discard all staged tokens?")) room.discardStaged("all"); }}>Discard all</button>
      </div>
      <ul className="dnd-camp-map-list">
        {room.staged.map((t) => (
          <li key={t.id} className="dnd-camp-map">
            <span className="dnd-party-dot" style={{ background: t.color }} />
            <span className="dnd-camp-map-main">{t.name}{t.hpMax ? <span className="muted small"> · HP {t.hpMax}</span> : null}</span>
            <button onClick={() => room.revealStaged(t.id)}>Reveal</button>
            <button className="danger" onClick={() => room.discardStaged(t.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
