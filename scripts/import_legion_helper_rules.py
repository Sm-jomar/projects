"""Pull unit keywords and weapons, and the rules glossary, from Legion Helper.

    npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/catalog.json
    python3 scripts/import_legion_helper_rules.py /tmp/catalog.json

Legion Helper (https://legion.takras.net) prints each unit card's text as
HTML: keywords with their numbers ("Armor 5", "Weak Point 1: Rear") and each
weapon's name, range, dice and keywords. Unit pages are matched to our units
the same way as in import_legion_helper_minis.py. Writes
src/data/unit-rules.json (keywords + weapons per unit id).

Every rules page in the sitemap (keywords, phases, terrain, tokens, ...) goes
into src/data/rules-glossary.json for the in-app glossary.
"""

import html as htmllib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from import_legion_helper_minis import FACTIONS, SITE, get, slug

OUT = "src/data/unit-rules.json"
GLOSSARY_OUT = "src/data/rules-glossary.json"

# Site pages that aren't rules.
NOT_RULES = {
    "", "about", "about-army-builder", "army-builder", "changelog", "dice-calculator", "dice-roller",
    "print-play", "quiz", "resources", "scoreboard", "search_result_blank", "whats-new",
}

# Units whose Legion Helper page is under another name. Retired printings
# Legion Helper doesn't list (Anakin Hero Without Fear, Mandalorian
# Resistance, the old Super Tactical Droid) keep no rules.
MANUAL = {
    "rebels-han-solo": "han-solo-unorthodox-general",
    "rebels-the-bad-batch": "the-bad-batch-clone-force-99-mercenary",
    "republic-clone-commander": "clone-commander-trained-for-leadership",
    "republic-jedi-knight": "jedi-knight-keeper-of-the-peace",
    "republic-jedi-knight-general": "jedi-knight-general-strong-in-the-force",
    "republic-tx-130-saber-class-fighter-tank": "saber-class-tank",
    "separatists-geonosian-warriors": "geonosian-warriors-soldiers-of-the-hive",
    "separatists-ig-100-magnaguards": "ig-100-magnaguard",
    "separatists-ig-100-magnaguards-prototype-assassin-droids": "ig-100-magnaguard-prototype-assassin-droids",
    "separatists-nr-n99-persuader-class-tank-droid": "persuader-class-tank-droid",
    "separatists-nr-n99-persuader-class-tank-droid-prototype-tank-droid": "persuader-class-tank-droid-prototype-tank-droid",
    "separatists-super-tactical-command-droid": "super-tactical-command-droid-command-and-control-droid",
    "separatists-super-tactical-command-droid-operative": "super-tactical-command-droid-auxilirary-command-droid",
    "imperials-ig-11-nurse-droid": "ig-11-nurse-and-protect",
    "imperials-ig-88-assassin-droid": "ig-88-notorious-assassin-droid",
    "mercenary-a-a5-speeder-truck": "a-a5-speeder-truck-mercenary",
}


def strip_classes(h: str) -> str:
    """CSS module classes look like `foo-module__AbC123__name`; keep `name`."""
    return re.sub(r"[\w-]+-module__[\w-]+?__(\w+)", r"\1", h)


def to_text(h: str) -> str:
    """Card HTML to plain text; inline icons become their title, e.g. [hit]."""
    h = re.sub(r'<img[^>]*?title="([^"]*)"[^>]*>', r" [\1] ", h)
    h = re.sub(r"<br\s*/?>|</div>|</p>|</li>", "\n", h)
    h = re.sub(r"<!-- -->", "", h)
    h = htmllib.unescape(re.sub(r"<[^>]+>", "", h))
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in h.split("\n")]
    text = "\n".join(l for l in lines if l)
    return re.sub(r" ([.,;:)])", r"\1", text)


# Icons inside keywords, by <img> title or by the raw icon code Legion Helper
# sometimes leaves as text ("Compel: corps Trooper").
ICONS = {
    "action": "", "actionfree": "", "empire": "Imperial", "cis": "Separatist", "rebel": "Rebel",
    "gar": "Republic", "corps": "Corps", "specialforces": "Special Forces", "commander": "Commander",
    "operative": "Operative", "range1": "Range 1", "range 2": "Range 2", "range 3": "Range 3",
    "upgrade force": "Force", "upgradeDoctrines": "Doctrine", "upgradeArmament": "Armament", "blacksun": "Black Sun",
    "pyke": "Pyke Syndicate", "ewoks": "Ewok", "clan_saxon": "Clan Saxon", "clan_covert": "Clan Covert",
    "clan_saxoncommander": "Clan Saxon Commander",
}


def keyword_list(htmls: list[str]) -> list[str]:
    """Card keywords as printed: 'Armor 5', 'Weak Point 1: Rear', 'Impact 3'.
    Legion Helper writes weapon magnitudes as 'Impact x 3', doubles some
    words ('Long shot Shot') and has a few typos ('Marksman. Victory or
    Death', 'New keyword line')."""
    out = []
    for h in htmls:
        h = re.sub(r'<img[^>]*?title="([^"]*)"[^>]*>', lambda m: f" {ICONS.get(m.group(1), m.group(1))} ", h)
        t = re.sub(r"[\w]+", lambda m: ICONS.get(m.group(0), m.group(0)), to_text(h))
        t = re.sub(r",(?=\S)", ", ", t)
        # "Recharge 1, Shielded 1" is two keywords; "Equip: Del Meeko, Gideon Hask" is one.
        for k in re.split(r"\. |, (?=[A-Z][^:]*$)" if ":" not in t else r"\. ", t):
            k = re.sub(r"\s+", " ", re.sub(r" x (\d)", r" \1", k)).strip(" .,")
            k = re.sub(r"(\w+) (\w+) (\w+)$", lambda m: f"{m.group(1)} {m.group(3)}" if m.group(2).lower() == m.group(3).lower() else m.group(0), k)
            k = k.replace("Non- ", "Non-")
            k = re.sub(r"^(Fixed|Immune):? (\w)", lambda m: f"{m.group(1)}: {m.group(2).upper()}", k)
            if k.startswith("Mercenary: "):
                k = "Mercenary: " + ", ".join(k[11:].split())
            if k and k != "New keyword line":
                out.append(k[0].upper() + k[1:])
    return out


def parse_range(r: str) -> dict:
    r = re.sub(r"(?i)^melee(?=-)", "0", r.strip())
    # Legion Helper prints "-1+" for a few melee weapons (Jedi Knight, Swoop
    # Bike Riders); their cards say Melee.
    if r == "-1+":
        r = "melee"
    if r.lower() == "melee":
        return {"min_range": 0, "max_range": 0}
    m = re.match(r"^(\d+)\s*-\s*(\d+)$", r)
    if m:
        return {"min_range": int(m.group(1)), "max_range": int(m.group(2))}
    m = re.match(r"^(\d+)\+$", r)
    if m:
        return {"min_range": int(m.group(1))}
    m = re.match(r"^(\d+)$", r)
    if m:
        return {"min_range": int(m.group(1)), "max_range": int(m.group(1))}
    raise ValueError(f"range {r!r}")


def unit_page(url: str):
    raw = strip_classes(get(url))
    text = to_text(re.sub(r"<script.*?</script>|<style.*?</style>", "", raw, flags=re.S))
    faction = re.search(r"Faction\s*(.+?)\s*Rank", text)
    if not faction:
        return None
    # Some units (Jedi Knight General) have no weapons of their own.
    end = raw.find('class="keywordList"')
    i, j = raw.find('class="keywords"'), raw.find('class="weapons"')
    if j < 0:
        j = end
    kw_html = raw[i:j] if i >= 0 else ""
    keywords = keyword_list(re.findall(r"<li>(.*?)</li>", kw_html))
    weapons = []
    for w in re.split(r'<div class="weapon">', raw[j:end if end > 0 else None])[1:]:
        name = to_text(re.search(r'class="weaponName">(.*?)</span>', w).group(1))
        rng = to_text(re.search(r'class="weaponRange">(.*?)</span>', w).group(1))
        dice = {c: len(re.findall(rf"die_{c}\b", w)) for c in ("red", "black", "white")}
        weapon = {"name": name, "dice": {c: n for c, n in dice.items() if n}, **parse_range(rng)}
        kw = re.search(r'class="weaponKeywords">(.*?)</span>', w)
        if kw:
            weapon["keywords"] = keyword_list([kw.group(1)])
        weapons.append(weapon)
    return url.rstrip("/").rsplit("/", 1)[1], FACTIONS.get(faction.group(1)), {"keywords": keywords, "weapons": weapons}


def rules_page(url: str):
    raw = strip_classes(get(url))
    head = re.search(r'<h2 class="header">(.*?)</h2>(?:<div class="tag">(.*?)</div>)?', raw)
    start = raw.find('class="contentContainer"')
    if not head or start < 0:
        return None
    body = raw[raw.index(">", start) + 1:]
    body = re.split(r'<div class="container" id="related"|<section id="keywordCards"|<div class="container" id="share"', body)[0]
    body = re.sub(r'<span class="paragraph">|<h[3-6][^>]*>|</h[3-6]>', "\n", body)
    text = to_text(body)
    if not text:
        return None
    tag = to_text(head.group(2) or "").strip("()") or "Rules"
    related = re.findall(r'relatedButton" href="/([\w-]+)/"', raw)
    return {
        "slug": url.rstrip("/").rsplit("/", 1)[1],
        "name": to_text(head.group(1)),
        "tag": tag,
        "text": text,
        **({"related": related} if related else {}),
    }


def units_main(units: list, sitemap: str) -> None:
    urls = re.findall(rf"<loc>({SITE}/cards/units/[^<]+)</loc>", sitemap)
    with ThreadPoolExecutor(8) as ex:
        pages = {p[0]: p[1:] for p in ex.map(unit_page, urls) if p}

    out: dict[str, dict] = {}
    unmatched = []
    for u in units:
        name, sub, fac = slug(u["name"]), slug(u.get("sub_title") or ""), u["faction"]
        exact = [k for k in (MANUAL.get(u["id"]), f"{name}-{sub}" if sub else None, name, u["id"].split("-", 1)[1]) if k in pages]
        cands = exact[:1] or [k for k in pages if k.startswith(name + "-") and pages[k][0] == fac]
        rules = {json.dumps(pages[k][1], sort_keys=True) for k in cands}
        if len(rules) == 1:
            out[u["id"]] = json.loads(rules.pop())
        else:
            unmatched.append(u["id"])
    json.dump(dict(sorted(out.items())), open(OUT, "w"), indent=1)
    open(OUT, "a").write("\n")
    print(f"wrote {len(out)} units to {OUT}; no page for {len(unmatched)}: {', '.join(unmatched)}")


def glossary_main(sitemap: str) -> None:
    urls = [u for u in re.findall(rf"<loc>({SITE}/[^<]*)</loc>", sitemap)
            if "/cards/" not in u and u[len(SITE):].strip("/") not in NOT_RULES]
    with ThreadPoolExecutor(8) as ex:
        entries = [e for e in ex.map(rules_page, urls) if e]
    entries.sort(key=lambda e: e["name"].lower())
    json.dump(entries, open(GLOSSARY_OUT, "w"), indent=1, ensure_ascii=False)
    open(GLOSSARY_OUT, "a").write("\n")
    print(f"wrote {len(entries)} of {len(urls)} rules pages to {GLOSSARY_OUT}")


def main() -> None:
    catalog = json.load(open(sys.argv[1]))
    sitemap = get(f"{SITE}/sitemap.xml")
    units_main(catalog["units"], sitemap)
    glossary_main(sitemap)


if __name__ == "__main__":
    main()
