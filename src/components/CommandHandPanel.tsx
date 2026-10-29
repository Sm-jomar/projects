import { useMemo, useState } from "react";
import {
  COMMAND_BY_ID, HAND_PIPS, PER_PIP, STANDING_ORDERS, cardsForFaction, handComplete, meetsRequirement,
  type CommandCardDef, type HandArmy,
} from "../lib/commandCards";
import { CardText } from "./UnitRules";

const pipDots = (n: number) => "●".repeat(n);

function CardRow({ card, open, onToggle, children }: {
  card: CommandCardDef; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <li className={"cmd-card" + (open ? " open" : "")}>
      <div className="cmd-card-head">
        <span className="cmd-pips">{pipDots(card.pips)}</span>
        <button className="cmd-card-name" onClick={onToggle} title="Show card text">{card.name}</button>
        {children}
      </div>
      <div className="muted small cmd-card-meta">
        Orders: {card.orders}{card.requirementText ? ` · ${card.requirementText}` : ""}
      </div>
      {open && <CardText text={card.text} weapon={card.weapon} />}
    </li>
  );
}

/** The army's command hand: six picked cards plus Standing Orders. */
export function CommandHandPanel({ army, cards, onChange }: {
  army: HandArmy;
  cards: string[];
  onChange: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const chosen = cards.map((id) => COMMAND_BY_ID.get(id)).filter((c): c is CommandCardDef => !!c)
    .sort((a, b) => a.pips - b.pips || a.name.localeCompare(b.name));
  const toggleOpen = (id: string) => setOpenId(openId === id ? null : id);

  return (
    <div className="cmd-hand">
      <div className="rank-group-head">
        <span className="rank-label">Command hand</span>
        <span className="muted">{chosen.length} / {HAND_PIPS.length * PER_PIP} + Standing Orders</span>
      </div>
      <ul className="cmd-list">
        {chosen.map((c) => (
          <CardRow key={c.id} card={c} open={openId === c.id} onToggle={() => toggleOpen(c.id)}>
            {meetsRequirement(c, army) === false && <span className="cmd-bad" title={`Needs ${c.requirementText}`}>needs {c.requirementText}</span>}
            <button className="remove-btn small-x" title="Remove from hand"
                    onClick={() => onChange(cards.filter((id) => id !== c.id))}>×</button>
          </CardRow>
        ))}
        <CardRow card={STANDING_ORDERS} open={openId === STANDING_ORDERS.id} onToggle={() => toggleOpen(STANDING_ORDERS.id)} />
      </ul>
      <button className="upgrade-btn" onClick={() => setPicking(true)}>
        {chosen.length ? "Change command cards" : "+ Choose command cards"}
      </button>
      {picking && <CommandPicker army={army} cards={cards} onChange={onChange} onClose={() => setPicking(false)} />}
    </div>
  );
}

export function CommandPicker({ army, cards, onChange, onClose, onDone, doneLabel }: {
  army: HandArmy;
  cards: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
  /** Shows a confirm button, enabled once the hand is complete. */
  onDone?: () => void;
  doneLabel?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const offered = useMemo(() => cardsForFaction(army.faction), [army.faction]);
  const picked = new Set(cards);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="upgrade-picker-modal cmd-picker" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Command hand</h3>
          <label className="tt-check small">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show cards for units not in this army
          </label>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>
        <p className="muted small cmd-picker-help">
          Pick two cards of each pip value, no duplicates. Standing Orders is always in your hand.
        </p>
        <div className="cmd-picker-cols">
          {HAND_PIPS.map((pips) => {
            const n = cards.filter((id) => COMMAND_BY_ID.get(id)?.pips === pips).length;
            const list = offered
              .filter((c) => c.pips === pips)
              .map((c) => ({ c, ok: meetsRequirement(c, army) }))
              .filter(({ c, ok }) => showAll || ok !== false || picked.has(c.id))
              // Cards for units in the army first, then the generic ones.
              .sort((a, b) => Number(!a.c.requirementText) - Number(!b.c.requirementText) || a.c.name.localeCompare(b.c.name));
            return (
              <section key={pips} className="cmd-picker-col">
                <h4>{pipDots(pips)} {pips}-pip <span className="muted">({n}/{PER_PIP})</span></h4>
                <ul className="cmd-list">
                  {list.map(({ c, ok }) => {
                    const on = picked.has(c.id);
                    const full = !on && n >= PER_PIP;
                    return (
                      <CardRow key={c.id} card={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)}>
                        {ok === "unchecked" && <span className="cmd-check" title={`Check: ${c.requirementText}`}>?</span>}
                        <input type="checkbox" checked={on} disabled={full || (ok === false && !on)}
                               title={ok === false ? `Needs ${c.requirementText}` : full ? `You already have ${PER_PIP} ${pips}-pip cards` : ""}
                               onChange={() => onChange(on ? cards.filter((id) => id !== c.id) : [...cards, c.id])} />
                      </CardRow>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <footer className="cmd-picker-foot muted small">
          Card text from Legion Helper. "?" marks a card whose requirement (a clan or affiliation) we can't check for you.
          {onDone && (
            <button className="primary cmd-picker-done" disabled={!handComplete(cards)} onClick={onDone}
              title={handComplete(cards) ? "" : "Pick two cards of each pip value first"}>
              {doneLabel ?? "Done"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
