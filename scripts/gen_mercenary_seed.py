"""Generate a mercenary catalog seed from the card manifest.

Walks src/data/card-manifest.json for mercenary unit cards and emits
TypeScript entries (one Unit per card) with OCR'd point cost. Names get
a light cleanup pass for the worst OCR errors. Unique-character cards
(prefixed with "•" in the title) default to operative rank; the rest
default to support. The user can correct rank/wounds/etc. as needed.

Prints the TypeScript array to stdout for inclusion in catalog.seed.ts.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"

# OCR'd titles that need correction. Keys are the slug from the manifest.
NAME_FIXES: dict[str, str] = {
    "bosa-feeetr": "Boba Fett",
    "ebosa-fett": "Boba Fett",
    "e-bosa-fett": "Boba Fett",
    "ebosa-fetr": "Boba Fett",
    "bossk": "Bossk",
    "cap-bane": "Cad Bane",
    "emaul": "Maul",
    "maul-2": "Maul",
    "egrogu": "Grogu",
    "elogray": "Logray",
    "eomega": "Omega",
    "eajan-kloss": "Ahsoka Tano (Padawan)",
    "din-djarin": "Din Djarin",
    "ewicket": "Wicket",
    "wicket": "Wicket",
    "ewok-skirmishers": "Ewok Skirmishers",
    "a-ewok-skirmishers": "Ewok Skirmishers",
    "ig": "IG-88",
    "ig-11": "IG-11",
    "ig-17": "IG-17",
    "ig-83": "IG-83",
    "iy-swoop-bike-riders": "Swoop Bike Riders",
    "iy-swoop-bixe-riders": "Swoop Bike Riders",
    "mandalorian-super-commandos": "Mandalorian Super Commandos",
    "pyke-syndicate-foot-soldiers": "Pyke Syndicate Foot Soldiers",
    "pyke-syndicate-capo": "Pyke Syndicate Capo",
    "black-sun-vigo": "Black Sun Vigo",
    "black-sun-enforcers": "Black Sun Enforcers",
    "gar-saxon": "Gar Saxon",
    "ok-slingers": "Ok Slingers (?)",
    "the-bap-batcu": "The Bad Batch",
    "a-a5-speeder-truck": "A-A5 Speeder Truck",
    "chewbacca": "Chewbacca",
    "c-3po": "C-3PO",
}

# Best-guess rank for major known characters and unit types. Falls back to
# "operative" for unique characters, "support" otherwise.
RANK_HINTS: dict[str, str] = {
    "Boba Fett": "operative",
    "Bossk": "operative",
    "Cad Bane": "operative",
    "Maul": "commander",
    "Grogu": "operative",
    "Logray": "support",
    "Omega": "operative",
    "Din Djarin": "operative",
    "Wicket": "operative",
    "Ewok Skirmishers": "special-forces",
    "IG-88": "operative",
    "IG-11": "operative",
    "Swoop Bike Riders": "support",
    "Mandalorian Super Commandos": "special-forces",
    "Pyke Syndicate Foot Soldiers": "corps",
    "Pyke Syndicate Capo": "commander",
    "Black Sun Vigo": "commander",
    "Black Sun Enforcers": "corps",
    "Gar Saxon": "operative",
    "The Bad Batch": "special-forces",
    "A-A5 Speeder Truck": "support",
    "Chewbacca": "operative",
    "C-3PO": "operative",
}

PLACEHOLDER_POINTS = 50


def slug_to_id(slug: str) -> str:
    return f"mercenary-{slug}"


def clean_name(slug: str, raw_title: str) -> tuple[str, bool]:
    """Return (display name, is_unique)."""
    fixed = NAME_FIXES.get(slug)
    if fixed:
        return fixed, fixed[0].isupper() and fixed in RANK_HINTS  # treat curated names as unique-known
    # Strip leading "•" / "e" OCR remnants and dashes.
    t = re.sub(r"^[•·\-eEEC]\s*", "", raw_title).strip()
    t = re.sub(r"\s+", " ", t)
    # Title-case where it's clearly all-caps.
    if t.isupper():
        t = t.title()
    return t or slug, raw_title.lstrip().startswith("•") or raw_title.lstrip().startswith("e ")


def rank_for(name: str, is_unique: bool) -> str:
    return RANK_HINTS.get(name, "operative" if is_unique else "support")


def main() -> int:
    cards = json.loads(MANIFEST.read_text())
    mercs = [c for c in cards if c["faction"] == "mercenary" and c["kind"] == "unit"]
    # Dedup by cleaned name so we don't end up with both "Boba Fett (Daimyo)"
    # and a second Boba Fett collapsed under one id.
    seen: dict[str, dict] = {}
    for c in mercs:
        name, is_unique = clean_name(c["slug"], c["title"])
        key = name.lower()
        if key in seen:
            # If duplicate, prefer the one with a known point cost.
            if c.get("points") and not seen[key].get("points"):
                seen[key] = c
                seen[key]["_resolved_name"] = name
                seen[key]["_is_unique"] = is_unique
            continue
        c["_resolved_name"] = name
        c["_is_unique"] = is_unique
        seen[key] = c

    entries = []
    for c in seen.values():
        name = c["_resolved_name"]
        is_unique = c["_is_unique"]
        rank = rank_for(name, is_unique)
        raw = c.get("points")
        # Filter implausible OCR hits: unit costs in Legion are typically
        # 30+ pts. Anything under 15 is almost certainly a stray "1" from
        # an icon, not the actual cost.
        points = raw if raw and raw >= 15 else PLACEHOLDER_POINTS
        entry_id = slug_to_id(c["slug"])
        entry = {
            "id": entry_id,
            "name": name,
            "is_unique": is_unique,
            "faction": "mercenary",
            "type": "trooper",
            "points": int(points),
            "rank": rank,
            "miniatures": 1,
            "wounds": 1,
            "defense": "white",
            "has_defense_surge": False,
        }
        entries.append(entry)
    # Sort by rank order then name for stable output.
    rank_idx = {
        "commander": 0,
        "operative": 1,
        "corps": 2,
        "special-forces": 3,
        "support": 4,
        "heavy": 5,
    }
    entries.sort(key=lambda e: (rank_idx.get(e["rank"], 99), e["name"]))

    # Emit as TS object literal append.
    print("// AUTO-GENERATED mercenary seed; points from OCR of card art, ")
    print("// other stats are placeholders. Adjust by hand as catalog matures.")
    print("export const MERCENARY_SEED: Unit[] = [")
    for e in entries:
        kv = []
        for k, v in e.items():
            if isinstance(v, str):
                kv.append(f'    {k}: "{v}",')
            elif isinstance(v, bool):
                kv.append(f"    {k}: {'true' if v else 'false'},")
            else:
                kv.append(f"    {k}: {v},")
        print("  {")
        for line in kv:
            print(line)
        print("  },")
    print("];")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
