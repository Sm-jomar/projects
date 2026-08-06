import {
  ABILITIES, SKILLS, abilityModifier, formatModifier, spellLevelLabel, SPELL_LEVELS,
  type DndCharacter, type AbilityKey,
} from "./dndTypes";

// Read-only rendering of a character sheet — used to view another player's
// shared sheet in a multiplayer game.
export function CharacterSheetView({ c }: { c: DndCharacter }) {
  const mods = {} as Record<AbilityKey, number>;
  for (const a of ABILITIES) mods[a.key] = abilityModifier(c.abilities[a.key]);
  const perception = mods.wis + (c.skillProf.perception ? c.proficiencyBonus : 0);
  const spellbook = c.spellbook ?? [];
  const slots = c.spellSlots ?? [];

  const savingThrows = ABILITIES.filter((a) => c.saveProf[a.key]).map((a) => a.short);
  const skills = SKILLS.filter((s) => c.skillProf[s.key]);

  return (
    <div className="dnd-view">
      <div className="dnd-view-head">
        <h3>{c.name || "Unnamed character"}</h3>
        <div className="muted small">
          {[c.className, c.race, c.background, c.alignment].filter(Boolean).join(" · ") || "—"} · Level {c.level}
        </div>
      </div>

      <div className="dnd-view-abilities">
        {ABILITIES.map((a) => (
          <div key={a.key} className="dnd-view-ability">
            <span className="dnd-view-ab-name">{a.short}</span>
            <span className="dnd-view-ab-score">{c.abilities[a.key]}</span>
            <span className="dnd-view-ab-mod">{formatModifier(mods[a.key])}</span>
          </div>
        ))}
      </div>

      <div className="dnd-view-stats">
        <Stat label="AC" value={c.armorClass} />
        <Stat label="HP" value={`${c.hpCurrent}/${c.hpMax}${c.hpTemp ? ` (+${c.hpTemp})` : ""}`} />
        <Stat label="Speed" value={c.speed || "—"} />
        <Stat label="Init" value={formatModifier(mods.dex)} />
        <Stat label="Prof" value={formatModifier(c.proficiencyBonus)} />
        <Stat label="Pass. Per." value={10 + perception} />
        <Stat label="Hit Dice" value={c.hitDice || "—"} />
        {c.inspiration && <Stat label="Inspiration" value="✔" />}
      </div>

      {(savingThrows.length > 0 || skills.length > 0) && (
        <div className="dnd-view-block">
          {savingThrows.length > 0 && <p><b>Save proficiencies:</b> {savingThrows.join(", ")}</p>}
          {skills.length > 0 && (
            <p><b>Skill proficiencies:</b> {skills.map((s) =>
              `${s.label} (${formatModifier(mods[s.ability] + c.proficiencyBonus)})`).join(", ")}</p>
          )}
        </div>
      )}

      {c.attacks.length > 0 && (
        <div className="dnd-view-block">
          <h4>Attacks</h4>
          <table className="dnd-view-attacks">
            <tbody>
              {c.attacks.map((a, i) => (
                <tr key={i}><td>{a.name || "—"}</td><td>{a.bonus}</td><td>{a.damage}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(c.spellcastingClass || spellbook.length > 0) && (
        <div className="dnd-view-block">
          <h4>Spellcasting</h4>
          {c.spellcastingClass && (
            <p className="muted small">
              {[c.spellcastingClass,
                c.spellAbility ? `Ability ${c.spellAbility.toUpperCase()}` : "",
                c.spellSaveDc ? `Save DC ${c.spellSaveDc}` : "",
                c.spellAttackBonus ? `Atk ${c.spellAttackBonus}` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          {slots.some((s) => s.total > 0) && (
            <div className="dnd-view-slots">
              {slots.map((s, i) => s.total > 0 ? (
                <span key={i} className="dnd-view-slot">L{i + 1}: {s.total - s.used}/{s.total}</span>
              ) : null)}
            </div>
          )}
          {SPELL_LEVELS.map((level) => {
            const inLevel = spellbook.filter((s) => s.level === level).sort((a, b) => a.name.localeCompare(b.name));
            if (inLevel.length === 0) return null;
            return (
              <div key={level} className="dnd-view-spelllevel">
                <span className="dnd-view-spelllevel-name">{spellLevelLabel(level)}</span>
                <span>{inLevel.map((s) => `${s.prepared && level > 0 ? "★ " : ""}${s.name || "—"}`).join(", ")}</span>
              </div>
            );
          })}
        </div>
      )}

      {c.featuresTraits.trim() && <ViewText label="Features & Traits" text={c.featuresTraits} />}
      {c.equipment.trim() && <ViewText label="Equipment" text={c.equipment} />}
      {c.otherProficiencies.trim() && <ViewText label="Proficiencies & Languages" text={c.otherProficiencies} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dnd-view-stat">
      <span className="dnd-view-stat-label">{label}</span>
      <span className="dnd-view-stat-value">{value}</span>
    </div>
  );
}

function ViewText({ label, text }: { label: string; text: string }) {
  return (
    <div className="dnd-view-block">
      <h4>{label}</h4>
      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</p>
    </div>
  );
}
