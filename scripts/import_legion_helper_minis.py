"""Pull miniature counts from Legion Helper: each unit's own minis (the
number in the top-right corner of the unit card) into
src/data/unit-miniatures.json, and the minis each heavy weapon, personnel
and squad leader upgrade adds ("Add N ... miniature") into
src/data/upgrade-miniatures.json.

    npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/catalog.json
    python3 scripts/import_legion_helper_minis.py /tmp/catalog.json

Legion Helper (https://legion.takras.net) has one page per card. Unit pages
say "Miniatures N" and are matched to our units by name, subtitle and
faction; MANUAL pins units with no page there (older printings). Upgrade
pages are matched by name and slot; an upgrade with no page keeps the
catalog's own guess (heavy weapons and personnel add one mini).
"""

import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SITE = "https://legion.takras.net"
OUT = "src/data/unit-miniatures.json"
UPGRADES_OUT = "src/data/upgrade-miniatures.json"
SLOTS = {"Heavy": "heavy-weapon", "Personnel": "personnel", "Squad Leader": "squad-leader"}

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
    "mercenary-han-chewie-notorious-scoundrels": 2,
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


def text_of(url: str) -> str:
    html = re.sub(r"<script.*?</script>|<style.*?</style>", "", get(url), flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def upgrade_page(url: str):
    text = text_of(url)
    m = re.search(r"Back to Legion Helper (.+?) is an? (.+?) upgrade card", text)
    if not m or m.group(2) not in SLOTS:
        return None
    # The title is printed twice ("Echo Echo is a ..."); keep one copy.
    title = m.group(1)
    half = title[: len(title) // 2].strip()
    name = half if title == f"{half} {half}" else title
    adds = sum(int(n) for n in re.findall(r"Add (\d+) [^.]*?min[ia]*tures?\b", text, flags=re.I))
    # The Leader keyword makes the added mini the unit leader.
    leader = " Leader A miniature with the Leader keyword" in text
    return {"name": name.strip("• "), "type": SLOTS[m.group(2)], "adds": adds, "leader": leader}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def units_main(units: list, sitemap: str) -> None:
    urls = re.findall(rf"<loc>({SITE}/cards/units/[^<]+)</loc>", sitemap)
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


def upgrades_main(upgrades: list, sitemap: str) -> None:
    urls = re.findall(rf"<loc>({SITE}/cards/upgrades/[^<]+)</loc>", sitemap)
    with ThreadPoolExecutor(8) as ex:
        pages = [p for p in ex.map(upgrade_page, urls) if p]

    out: dict[str, dict] = {}
    unmatched = []
    for u in upgrades:
        if u["type"] not in SLOTS.values():
            continue
        found = {(p["adds"], p["leader"]) for p in pages if p["type"] == u["type"] and norm(p["name"]) == norm(u["name"])}
        if len(found) == 1:
            adds, leader = found.pop()
            out[u["id"]] = {"adds": adds, **({"leader": True} if leader else {})}
        else:
            unmatched.append(u["id"])
    json.dump(dict(sorted(out.items())), open(UPGRADES_OUT, "w"), indent=1)
    open(UPGRADES_OUT, "a").write("\n")
    print(f"wrote {len(out)} upgrades to {UPGRADES_OUT}; no page for {len(unmatched)}: {', '.join(unmatched)}")


def main() -> None:
    catalog = json.load(open(sys.argv[1]))
    sitemap = get(f"{SITE}/sitemap.xml")
    units_main(catalog["units"], sitemap)
    upgrades_main(catalog["upgrades"], sitemap)


if __name__ == "__main__":
    main()
