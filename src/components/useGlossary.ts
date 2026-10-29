import { useEffect, useState } from "react";
import { loadGlossary, type RulesEntry } from "../lib/rules";

/** The rules glossary, once loaded (it is a separate chunk). */
export function useGlossary(): RulesEntry[] | null {
  const [entries, setEntries] = useState<RulesEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    loadGlossary().then((g) => live && setEntries(g));
    return () => { live = false; };
  }, []);
  return entries;
}
