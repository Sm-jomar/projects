import { useMemo, useState } from "react";
import { rulesUrl, RULES_SITE } from "../lib/rules";
import { useGlossary } from "./useGlossary";

/** Searchable 2024 rules glossary (keywords, phases, terrain, ...). */
export function RulesGlossary() {
  const entries = useGlossary();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const tags = useMemo(() => [...new Set((entries ?? []).map((e) => e.tag))].sort(), [entries]);
  const bySlug = useMemo(() => new Map((entries ?? []).map((e) => [e.slug, e])), [entries]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (entries ?? []).filter((e) => !tag || e.tag === tag);
    if (!q) return list;
    // Name matches first, then matches in the rules text.
    const byName = list.filter((e) => e.name.toLowerCase().includes(q));
    const byText = list.filter((e) => !byName.includes(e) && e.text.toLowerCase().includes(q));
    return byName.concat(byText);
  }, [entries, query, tag]);

  const jump = (slug: string) => {
    setQuery(""); setTag(""); setOpenSlug(slug);
    requestAnimationFrame(() => document.getElementById(`rule-${slug}`)?.scrollIntoView({ block: "start" }));
  };

  return (
    <div className="rules-glossary">
      <div className="rb-bar">
        <input type="search" placeholder="Search keywords and rules…" value={query} autoFocus
               onChange={(e) => setQuery(e.target.value)} />
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All ({entries?.length ?? 0})</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="rules-list">
        {!entries && <div className="muted empty">Loading rules…</div>}
        {entries && shown.length === 0 && <div className="muted empty">Nothing matches "{query}".</div>}
        {shown.map((e) => {
          const open = openSlug === e.slug || (!!query.trim() && shown.length <= 3);
          return (
            <div key={e.slug} id={`rule-${e.slug}`} className={"rules-entry" + (open ? " open" : "")}>
              <button className="rules-entry-head" onClick={() => setOpenSlug(openSlug === e.slug ? null : e.slug)}>
                <span>{e.name}</span>
                <span className="muted small">{e.tag}</span>
              </button>
              {open && (
                <div className="rules-entry-body">
                  <p>{e.text}</p>
                  {e.related && (
                    <div className="rules-related small">
                      See also:{" "}
                      {e.related.filter((s) => bySlug.has(s)).map((s) => (
                        <button key={s} className="link-btn" onClick={() => jump(s)}>{bySlug.get(s)!.name}</button>
                      ))}
                    </div>
                  )}
                  <a className="small" href={rulesUrl(e.slug)} target="_blank" rel="noreferrer">Full rules on Legion Helper ↗</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="rules-source muted">
        Rules text from <a href={RULES_SITE} target="_blank" rel="noreferrer">Legion Helper</a> (2024 rules).
      </div>
    </div>
  );
}
