"""Pull each unit's miniature count (the number in the top-right corner of
the unit card) from Legion Helper and write src/data/unit-miniatures.json.

    npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/units.json
    python3 scripts/import_legion_helper_minis.py /tmp/units.json

Legion Helper (https://legion.takras.net) has one page per unit card, and
each says "Miniatures N". Pages are matched to our units by name, subtitle
and faction. MANUAL pins units with no page there (older printings).
"""

import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SITE = "https://legion.takras.net"
OUT = "src/data/unit-miniatures.json"

FACTIONS = {
    "Galactic Republic": "republic", "Rebel Alliance": "rebels", "Galactic Empire": "imperials",
    "Separatist Alliance": "separatists", "Mercenaries": "mercenary",
}

# Units Legion Helper doesn't list (retired printings) or names too
# differently to match (or files under another faction), from their cards.
MANUAL = {
    "rebels-mandalorian-resistance": 4,
    "rebels-mandalorian-resistance-clan-wren": 1,
    "rebels-the-bad-batch": 0,  # the minis come with its heavy weapon upgrades
    "imperials-ig-11-nurse-droid": 1,
    "imperials-ig-88-assassin-droid": 1,
    "republic-tx-130-saber-class-fighter-tank": 1,
    "separatists-ig-100-magnaguards": 3,
    "separatists-ig-100-magnaguards-prototype-assassin-droids": 4,
    "separatists-nr-n99-persuader-class-tank-droid": 1,
    "separatists-nr-n99-persuader-class-tank-droid-prototype-tank-droid": 1,
    "separatists-super-tactical-droid": 1,
}


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "legion-army-builder"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("é", "e")).strip("-")


def page(url: str):
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", get(url)))
    minis = re.search(r"Miniatures (\d+)", text)
    faction = re.search(r"Faction (.+?) Rank", text)
    if not minis or not faction:
        return None
    return url.rstrip("/").rsplit("/", 1)[1], int(minis.group(1)), FACTIONS.get(faction.group(1))


def main() -> None:
    units = json.load(open(sys.argv[1]))
    urls = re.findall(rf"<loc>({SITE}/cards/units/[^<]+)</loc>", get(f"{SITE}/sitemap.xml"))
    with ThreadPoolExecutor(8) as ex:
        pages = {p[0]: p[1:] for p in ex.map(page, urls) if p}

    out: dict[str, int] = {}
    unmatched = []
    for u in units:
        name, sub, fac = slug(u["name"]), slug(u.get("sub_title") or ""), u["faction"]
        exact = [k for k in (f"{name}-{sub}" if sub else None, name, u["id"].split("-", 1)[1]) if k in pages]
        cands = exact[:1] or [k for k in pages if k.startswith(name + "-") and pages[k][1] == fac]
        counts = {pages[k][0] for k in cands}
        if u["id"] in MANUAL:
            out[u["id"]] = MANUAL[u["id"]]
        elif len(counts) == 1:
            out[u["id"]] = counts.pop()
        else:
            unmatched.append(u["id"])
    json.dump(dict(sorted(out.items())), open(OUT, "w"), indent=1)
    open(OUT, "a").write("\n")
    print(f"wrote {len(out)} units to {OUT}; kept catalog value for {len(unmatched)}: {', '.join(unmatched)}")


if __name__ == "__main__":
    main()
