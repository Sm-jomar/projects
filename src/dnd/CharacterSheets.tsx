import { useEffect, useMemo, useState } from "react";
import {
  ABILITIES, SKILLS, abilityModifier, formatModifier, blankCharacter,
  SPELL_LEVELS, spellLevelLabel, newSpell, emptySpellSlots,
  type DndCharacter, type AbilityKey, type Attack, type Spell, type SpellSlot,
} from "./dndTypes";
import {
  listCharacters, loadCharacter, saveCharacter, deleteCharacter,
} from "./dndStorage";

export function CharacterSheets() {
  const [chars, setChars] = useState<DndCharacter[]>(() => listCharacters());
  const [editing, setEditing] = useState<DndCharacter | null>(null);

  function refresh() { setChars(listCharacters()); }

  // Debounced auto-save of the character being edited so nothing is lost.
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => { saveCharacter(editing); refresh(); }, 500);
    return () => clearTimeout(t);
  }, [editing]);

  if (editing) {
    return (
      <CharacterEditor
        character={editing}
        onChange={setEditing}
        onBack={() => { saveCharacter(editing); refresh(); setEditing(null); }}
        onDelete={() => {
          if (confirm(`Delete "${editing.name || "Unnamed character"}"?`)) {
            deleteCharacter(editing.id);
            refresh();
            setEditing(null);
          }
        }}
      />
    );
  }

  return (
    <div className="dnd-section">
      <div className="dnd-section-head">
        <h2>Character Sheets</h2>
        <button className="dnd-primary" onClick={() => setEditing(blankCharacter())}>
          + New character
        </button>
      </div>
      {chars.length === 0 ? (
        <p className="muted">No characters yet. Click <b>+ New character</b> to build a 5e sheet.</p>
      ) : (
        <ul className="dnd-card-list">
          {chars.map((c) => (
            <li key={c.id} className="dnd-card-row">
              <div className="dnd-card-main">
                <div className="dnd-card-title">{c.name || "Unnamed character"}</div>
                <div className="muted small">
                  {[c.className, c.race, c.background].filter(Boolean).join(" · ") || "—"}
                  {" · "}Lv {c.level} · updated {new Date(c.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="dnd-card-actions">
                <button onClick={() => setEditing(loadCharacter(c.id) ?? c)}>Open</button>
                <button className="danger" onClick={() => {
                  if (confirm(`Delete "${c.name || "Unnamed character"}"?`)) { deleteCharacter(c.id); refresh(); }
                }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CharacterEditor({ character, onChange, onBack, onDelete }: {
  character: DndCharacter;
  onChange: (c: DndCharacter) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const c = character;
  const set = <K extends keyof DndCharacter>(k: K, v: DndCharacter[K]) => onChange({ ...c, [k]: v });

  const mods = useMemo(() => {
    const m = {} as Record<AbilityKey, number>;
    for (const a of ABILITIES) m[a.key] = abilityModifier(c.abilities[a.key]);
    return m;
  }, [c.abilities]);

  const perceptionMod = mods.wis + (c.skillProf.perception ? c.proficiencyBonus : 0);
  const passivePerception = 10 + perceptionMod;

  function setAbility(k: AbilityKey, v: number) {
    onChange({ ...c, abilities: { ...c.abilities, [k]: v } });
  }

  return (
    <div className="dnd-section dnd-sheet">
      <div className="dnd-section-head">
        <button className="ghost-btn" onClick={onBack}>← All characters</button>
        <span className="muted small dnd-autosave">Auto-saving</span>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>

      {/* Header block */}
      <div className="dnd-sheet-header">
        <label className="dnd-name-field">
          <span>Character name</span>
          <input value={c.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Lyra Half-Elf" />
        </label>
        <div className="dnd-header-grid">
          <Field label="Class & Level" value={c.className} onChange={(v) => set("className", v)} placeholder="Wizard 3" />
          <NumField label="Level" value={c.level} onChange={(v) => set("level", v)} min={1} max={20} />
          <Field label="Background" value={c.background} onChange={(v) => set("background", v)} />
          <Field label="Race" value={c.race} onChange={(v) => set("race", v)} />
          <Field label="Alignment" value={c.alignment} onChange={(v) => set("alignment", v)} />
          <Field label="Player" value={c.playerName} onChange={(v) => set("playerName", v)} />
          <Field label="Experience" value={c.xp} onChange={(v) => set("xp", v)} />
        </div>
      </div>

      <div className="dnd-sheet-cols">
        {/* Left column: abilities, saves, skills */}
        <div className="dnd-sheet-col">
          <div className="dnd-inspiration-prof">
            <label className="dnd-check">
              <input type="checkbox" checked={c.inspiration} onChange={(e) => set("inspiration", e.target.checked)} />
              Inspiration
            </label>
            <label className="dnd-prof-field">
              Proficiency bonus
              <input type="number" value={c.proficiencyBonus} onChange={(e) => set("proficiencyBonus", Number(e.target.value) || 0)} />
            </label>
          </div>

          <div className="dnd-abilities">
            {ABILITIES.map((a) => (
              <div key={a.key} className="dnd-ability">
                <span className="dnd-ability-name">{a.short}</span>
                <input className="dnd-ability-score" type="number" min={1} max={30}
                       value={c.abilities[a.key]}
                       onChange={(e) => setAbility(a.key, Number(e.target.value) || 0)} />
                <span className="dnd-ability-mod">{formatModifier(mods[a.key])}</span>
              </div>
            ))}
          </div>

          <fieldset className="dnd-box">
            <legend>Saving Throws</legend>
            {ABILITIES.map((a) => {
              const total = mods[a.key] + (c.saveProf[a.key] ? c.proficiencyBonus : 0);
              return (
                <label key={a.key} className="dnd-prof-row">
                  <input type="checkbox" checked={c.saveProf[a.key]}
                         onChange={(e) => onChange({ ...c, saveProf: { ...c.saveProf, [a.key]: e.target.checked } })} />
                  <b className="dnd-prof-total">{formatModifier(total)}</b>
                  <span>{a.label}</span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="dnd-box">
            <legend>Skills</legend>
            {SKILLS.map((s) => {
              const total = mods[s.ability] + (c.skillProf[s.key] ? c.proficiencyBonus : 0);
              return (
                <label key={s.key} className="dnd-prof-row">
                  <input type="checkbox" checked={c.skillProf[s.key]}
                         onChange={(e) => onChange({ ...c, skillProf: { ...c.skillProf, [s.key]: e.target.checked } })} />
                  <b className="dnd-prof-total">{formatModifier(total)}</b>
                  <span>{s.label} <em className="muted">({s.ability.toUpperCase()})</em></span>
                </label>
              );
            })}
          </fieldset>

          <div className="dnd-box dnd-passive">
            Passive Perception (Wis) <b>{passivePerception}</b>
          </div>
        </div>

        {/* Middle column: combat */}
        <div className="dnd-sheet-col">
          <div className="dnd-combat-top">
            <NumBox label="Armor Class" value={c.armorClass} onChange={(v) => set("armorClass", v)} />
            <div className="dnd-combat-box">
              <span>Initiative</span>
              <b>{formatModifier(mods.dex)}</b>
            </div>
            <Field label="Speed" value={c.speed} onChange={(v) => set("speed", v)} compact />
          </div>

          <fieldset className="dnd-box">
            <legend>Hit Points</legend>
            <div className="dnd-hp-grid">
              <NumField label="Max" value={c.hpMax} onChange={(v) => set("hpMax", v)} />
              <NumField label="Current" value={c.hpCurrent} onChange={(v) => set("hpCurrent", v)} />
              <NumField label="Temp" value={c.hpTemp} onChange={(v) => set("hpTemp", v)} />
            </div>
            <Field label="Hit Dice" value={c.hitDice} onChange={(v) => set("hitDice", v)} placeholder="3d8" />
            <div className="dnd-death-saves">
              <span>Death saves</span>
              <DeathRow label="Successes" count={c.deathSuccesses} onChange={(n) => set("deathSuccesses", n)} tone="ok" />
              <DeathRow label="Failures" count={c.deathFailures} onChange={(n) => set("deathFailures", n)} tone="bad" />
            </div>
          </fieldset>

          <fieldset className="dnd-box">
            <legend>Attacks & Spellcasting</legend>
            <AttacksEditor attacks={c.attacks} onChange={(a) => set("attacks", a)} />
          </fieldset>

          <fieldset className="dnd-box">
            <legend>Spellcasting</legend>
            <div className="dnd-spell-grid">
              <Field label="Class" value={c.spellcastingClass} onChange={(v) => set("spellcastingClass", v)} compact />
              <label className="dnd-mini-field">Ability
                <select value={c.spellAbility} onChange={(e) => set("spellAbility", e.target.value as AbilityKey | "")}>
                  <option value="">—</option>
                  {ABILITIES.map((a) => <option key={a.key} value={a.key}>{a.short}</option>)}
                </select>
              </label>
              <Field label="Save DC" value={c.spellSaveDc} onChange={(v) => set("spellSaveDc", v)} compact />
              <Field label="Atk Bonus" value={c.spellAttackBonus} onChange={(v) => set("spellAttackBonus", v)} compact />
            </div>
            <p className="muted small">Add spells in the Spellbook below.</p>
          </fieldset>

          <fieldset className="dnd-box">
            <legend>Coin</legend>
            <div className="dnd-coin">
              {(["cp", "sp", "ep", "gp", "pp"] as const).map((k) => (
                <label key={k} className="dnd-mini-field">{k.toUpperCase()}
                  <input value={c[k]} onChange={(e) => set(k, e.target.value)} />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Right column: text blocks */}
        <div className="dnd-sheet-col">
          <TextArea label="Other Proficiencies & Languages" value={c.otherProficiencies} onChange={(v) => set("otherProficiencies", v)} rows={4} />
          <TextArea label="Equipment" value={c.equipment} onChange={(v) => set("equipment", v)} rows={5} />
          <TextArea label="Features & Traits" value={c.featuresTraits} onChange={(v) => set("featuresTraits", v)} rows={6} />
          <TextArea label="Personality Traits" value={c.personality} onChange={(v) => set("personality", v)} rows={2} />
          <TextArea label="Ideals" value={c.ideals} onChange={(v) => set("ideals", v)} rows={2} />
          <TextArea label="Bonds" value={c.bonds} onChange={(v) => set("bonds", v)} rows={2} />
          <TextArea label="Flaws" value={c.flaws} onChange={(v) => set("flaws", v)} rows={2} />
        </div>
      </div>

      {/* Spellbook: full width below the three columns. */}
      <SpellbookEditor
        spellbook={c.spellbook ?? []}
        slots={c.spellSlots ?? emptySpellSlots()}
        legacyNotes={c.spells}
        onSpellbook={(sb) => set("spellbook", sb)}
        onSlots={(s) => set("spellSlots", s)}
      />
    </div>
  );
}

// --- small field helpers ---------------------------------------------------

function Field({ label, value, onChange, placeholder, compact }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; compact?: boolean;
}) {
  return (
    <label className={"dnd-field" + (compact ? " compact" : "")}>
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumField({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <label className="dnd-field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max}
             onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

function NumBox({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="dnd-combat-box">
      <span>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function TextArea({ label, value, onChange, rows }: {
  label: string; value: string; onChange: (v: string) => void; rows: number;
}) {
  return (
    <label className="dnd-field dnd-textarea">
      <span>{label}</span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function DeathRow({ label, count, onChange, tone }: {
  label: string; count: number; onChange: (n: number) => void; tone: "ok" | "bad";
}) {
  return (
    <div className="dnd-death-row">
      <span className="muted small">{label}</span>
      <div className={"dnd-death-pips " + tone}>
        {[1, 2, 3].map((i) => (
          <button key={i} type="button"
                  className={"dnd-pip" + (count >= i ? " filled" : "")}
                  onClick={() => onChange(count === i ? i - 1 : i)}
                  aria-label={`${label} ${i}`} />
        ))}
      </div>
    </div>
  );
}

function SpellbookEditor({ spellbook, slots, legacyNotes, onSpellbook, onSlots }: {
  spellbook: Spell[];
  slots: SpellSlot[];
  legacyNotes: string;
  onSpellbook: (s: Spell[]) => void;
  onSlots: (s: SpellSlot[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  function addSpell(level: number) {
    const s = newSpell(level);
    onSpellbook([...spellbook, s]);
    setOpenId(s.id);
  }
  function updateSpell(id: string, patch: Partial<Spell>) {
    onSpellbook(spellbook.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSpell(id: string) { onSpellbook(spellbook.filter((s) => s.id !== id)); }
  function setSlot(i: number, patch: Partial<SpellSlot>) {
    onSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  return (
    <section className="dnd-spellbook">
      <div className="dnd-section-head">
        <h2>Spellbook</h2>
        <button className="dnd-primary" onClick={() => addSpell(0)}>+ Add spell</button>
      </div>

      <div className="dnd-slots">
        {slots.map((slot, i) => {
          const level = i + 1;
          return (
            <div key={level} className="dnd-slot">
              <span className="dnd-slot-lvl">{["1st","2nd","3rd","4th","5th","6th","7th","8th","9th"][i]}</span>
              <div className="dnd-slot-fields">
                <label>Total<input type="number" min={0} max={9} value={slot.total}
                  onChange={(e) => setSlot(i, { total: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label>Used<input type="number" min={0} max={slot.total} value={slot.used}
                  onChange={(e) => setSlot(i, { used: Math.max(0, Math.min(slot.total, Number(e.target.value) || 0)) })} /></label>
              </div>
            </div>
          );
        })}
      </div>

      {spellbook.length === 0 ? (
        <p className="muted small">No spells yet. Use <b>+ Add spell</b>, or the per-level <b>+</b> buttons below.</p>
      ) : null}

      <div className="dnd-spell-levels">
        {SPELL_LEVELS.map((level) => {
          const inLevel = spellbook.filter((s) => s.level === level)
            .sort((a, b) => a.name.localeCompare(b.name));
          if (inLevel.length === 0 && level > 0) return null;
          return (
            <div key={level} className="dnd-spell-level">
              <div className="dnd-spell-level-head">
                <h3>{spellLevelLabel(level)}</h3>
                <button className="ghost-btn small" onClick={() => addSpell(level)}>+ {level === 0 ? "cantrip" : "spell"}</button>
              </div>
              {inLevel.map((s) => (
                <div key={s.id} className="dnd-spell-row">
                  <div className="dnd-spell-main">
                    {level > 0 && (
                      <input type="checkbox" checked={s.prepared} title="Prepared"
                             onChange={(e) => updateSpell(s.id, { prepared: e.target.checked })} />
                    )}
                    <input className="dnd-spell-name" value={s.name} placeholder="Spell name"
                           onChange={(e) => updateSpell(s.id, { name: e.target.value })} />
                    <select value={s.level} onChange={(e) => updateSpell(s.id, { level: Number(e.target.value) })} title="Level">
                      {SPELL_LEVELS.map((l) => <option key={l} value={l}>{l === 0 ? "Cantrip" : `Lv ${l}`}</option>)}
                    </select>
                    <button className="ghost-btn small" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      {openId === s.id ? "▾" : "▸"}
                    </button>
                    <button className="danger" onClick={() => removeSpell(s.id)} aria-label="Remove spell">×</button>
                  </div>
                  {openId === s.id && (
                    <div className="dnd-spell-detail">
                      <div className="dnd-spell-meta">
                        <Field label="School" value={s.school} onChange={(v) => updateSpell(s.id, { school: v })} compact />
                        <Field label="Casting time" value={s.castingTime} onChange={(v) => updateSpell(s.id, { castingTime: v })} compact />
                        <Field label="Range" value={s.range} onChange={(v) => updateSpell(s.id, { range: v })} compact />
                        <Field label="Components" value={s.components} onChange={(v) => updateSpell(s.id, { components: v })} compact />
                        <Field label="Duration" value={s.duration} onChange={(v) => updateSpell(s.id, { duration: v })} compact />
                      </div>
                      <TextArea label="Description" value={s.notes} onChange={(v) => updateSpell(s.id, { notes: v })} rows={3} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {legacyNotes.trim() && (
        <div className="dnd-box dnd-legacy-spells">
          <span className="muted small">Older free-form spell notes:</span>
          <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{legacyNotes}</p>
        </div>
      )}
    </section>
  );
}

function AttacksEditor({ attacks, onChange }: { attacks: Attack[]; onChange: (a: Attack[]) => void }) {
  function update(i: number, patch: Partial<Attack>) {
    onChange(attacks.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }
  return (
    <div className="dnd-attacks">
      <div className="dnd-attack-head">
        <span>Name</span><span>Bonus</span><span>Damage / Type</span><span />
      </div>
      {attacks.map((a, i) => (
        <div key={i} className="dnd-attack-row">
          <input value={a.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Longsword" />
          <input value={a.bonus} onChange={(e) => update(i, { bonus: e.target.value })} placeholder="+5" />
          <input value={a.damage} onChange={(e) => update(i, { damage: e.target.value })} placeholder="1d8+3 slashing" />
          <button className="danger" onClick={() => onChange(attacks.filter((_, j) => j !== i))} aria-label="Remove attack">×</button>
        </div>
      ))}
      <button className="ghost-btn small" onClick={() => onChange([...attacks, { name: "", bonus: "", damage: "" }])}>
        + Add attack
      </button>
    </div>
  );
}
