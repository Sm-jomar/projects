import { useState } from "react";
import type { Unit, Upgrade, Weapon } from "../lib/types";
import {
  entryForKeyword, rulesUrl, weaponKeywords, weaponRange, RULES_SITE, type RulesEntry,
} from "../lib/rules";
import { useGlossary } from "./useGlossary";

/** A keyword as printed on the card; tap or hover for its rules text. */
export function KeywordChip({ keyword, glossary }: { keyword: string; glossary: RulesEntry[] | null }) {
  const [open, setOpen] = useState(false);
  const entry = glossary ? entryForKeyword(glossary, keyword) : undefined;
  return (
    <span className={"tt-info rules-chip-wrap" + (open ? " open" : "")}>
      <button type="button" className={"rules-chip" + (entry ? "" : " plain")}
              aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
              onBlur={() => setOpen(false)}>
        {keyword}
      </button>
      {entry && (
        <span className="tt-info-tip rules-tip" role="tooltip">
          <b>{entry.name}</b>
          {entry.text}
          <a href={rulesUrl(entry.slug)} target="_blank" rel="noreferrer"
             onMouseDown={(e) => e.preventDefault()}>Full rules on Legion Helper ↗</a>
        </span>
      )}
    </span>
  );
}

function Dice({ dice }: { dice: { red?: number; black?: number; white?: number } }) {
  const pips: ("red" | "black" | "white")[] = [];
  for (const c of ["red", "black", "white"] as const) for (let i = 0; i < (dice[c] ?? 0); i++) pips.push(c);
  return (
    <span className="rules-dice" title={pips.join(", ") || "no dice"}>
      {pips.map((c, i) => <span key={i} className={`rules-die rules-die-${c}`} />)}
    </span>
  );
}

/** Stats, keywords and weapons from the unit card, with rules text on tap. */
export function UnitRules({ unit }: { unit: Unit }) {
  const glossary = useGlossary();
  const keywords = unit.keywords ?? [];
  const weapons = unit.weapons ?? [];
  if (!keywords.length && !weapons.length) {
    return <div className="unit-rules muted small">No card text for this unit yet.</div>;
  }
  return (
    <div className="unit-rules">
      <div className="rules-stats small">
        <span>Wounds <b>{unit.wounds}</b></span>
        {unit.resilience != null && <span>Resilience <b>{unit.resilience}</b></span>}
        {/* Vehicles print no courage (some imported data repeats resilience there). */}
        {unit.courage != null && !String(unit.type).includes("vehicle") && <span>Courage <b>{unit.courage}</b></span>}
        {unit.speed != null && <span>Speed <b>{unit.speed}</b></span>}
        <span>Defense <span className={`rules-die rules-die-${unit.defense}`} title={unit.defense} /></span>
      </div>
      {keywords.length > 0 && (
        <div className="rules-keywords">
          {keywords.map((k) => <KeywordChip key={k} keyword={k} glossary={glossary} />)}
        </div>
      )}
      {weapons.length > 0 && <WeaponList weapons={weapons} glossary={glossary} />}
      <div className="rules-source muted">
        Card text from <a href={RULES_SITE} target="_blank" rel="noreferrer">Legion Helper</a>
      </div>
    </div>
  );
}

export function WeaponList({ weapons, glossary }: { weapons: Weapon[]; glossary: RulesEntry[] | null }) {
  return (
    <ul className="rules-weapons">
      {weapons.map((w, i) => (
        <li key={i}>
          <div className="rules-weapon-head">
            <span className="rules-weapon-name">{w.name}</span>
            <span className="muted small">{weaponRange(w)}</span>
            <Dice dice={w.dice} />
          </div>
          {weaponKeywords(w).length > 0 && (
            <div className="rules-keywords">
              {weaponKeywords(w).map((k) => <KeywordChip key={k} keyword={k} glossary={glossary} />)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Card text (and weapon) of an upgrade or command card. */
export function CardText({ text, requirement, weapon }: { text?: string; requirement?: string; weapon?: Weapon }) {
  const glossary = useGlossary();
  if (!text && !weapon) return null;
  return (
    <div className="unit-rules card-text">
      {requirement && <div className="muted small">{requirement}</div>}
      {text && <p className="card-text-body">{text}</p>}
      {weapon && <WeaponList weapons={[weapon]} glossary={glossary} />}
    </div>
  );
}

export function UpgradeText({ upgrade }: { upgrade: Upgrade }) {
  return <CardText text={upgrade.text} requirement={upgrade.requirement_text} weapon={upgrade.weapon} />;
}
