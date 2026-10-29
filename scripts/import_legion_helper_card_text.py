"""Pull upgrade card text and the command cards from Legion Helper.

    npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/catalog.json
    python3 scripts/import_legion_helper_card_text.py /tmp/catalog.json

Writes:
- src/data/upgrade-rules.json: card text, printed restriction ("Stormtroopers
  Only") and weapon per upgrade id, for upgrades matched by name (and slot
  when a name is printed on more than one card).
- src/data/command-cards.json: every command card with its pips, who it
  orders, its requirement (resolved to our unit ids, a faction or a battle
  force where possible) and its text.
"""

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from import_legion_helper_minis import SITE, get, slug
from import_legion_helper_rules import parse_weapon, strip_classes, to_text

UPGRADES_OUT = "src/data/upgrade-rules.json"
COMMANDS_OUT = "src/data/command-cards.json"

# Inline icons in card text, by their alt text (or file name).
ICONS = {
    "action": "[Action]", "actionfree": "[Free action]", "exhaust": "[Exhaust]",
    "exhaustfree": "[Exhaust, free action]", "rangeHalf": "Range ½", "rangeInfinite": "Range ∞",
    "hit": "[hit]", "hitCritical": "[crit]", "hit-critical": "[crit]", "hitSurge": "[hit surge]",
    "hit-surge": "[hit surge]", "block": "[block]", "blockSurge": "[defense surge]",
    "block-surge": "[defense surge]", "courage": "courage",
    "commander": "Commander", "operative": "Operative", "corps": "Corps",
    "specialforces": "Special Forces", "support": "Support", "heavy": "Heavy",
    "empire": "Imperial", "rebel": "Rebel", "gar": "Republic", "cis": "Separatist",
    "ewoks": "Ewok", "raiders": "Raider", "upgradeForce": "Force",
    "clan_wren": "Clan Wren", "clan_kryze": "Clan Kryze", "clan_saxon": "Clan Saxon",
    "clan_covert": "Clan Covert", "blacksun": "Black Sun", "pyke": "Pyke Syndicate", "creedless": "Creedless",
    "defenseDiceWhite": "white defense die", "expend": "[Expend]",
}


def icon(alt: str) -> str:
    alt = re.sub(r"^.*/|\.png$", "", alt)
    m = re.match(r"^range-?(\d)$", alt)
    if m:
        return f"Range {m.group(1)}"
    m = re.match(r"^upgrade(\w+)$", alt)
    if m:
        return m.group(1)
    return ICONS.get(alt, f"[{alt}]")


def card_text(h: str) -> str:
    h = re.sub(r'<img[^>]*?alt="([^"]*)"[^>]*>', lambda m: f" {icon(m.group(1))} ", h)
    return re.sub(r" ([.,;:!?)])", r"\1", to_text(h))


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("é", "e"))


# Legion Helper slot name -> our upgrade type.
SLOTS = {
    "Heavy": "heavy-weapon", "Hardpoint": "hard-point", "Squad Leader": "squad-leader",
    "Grenade": "grenades", "Grenades": "grenades",
}


def upgrade_page(url: str):
    raw = strip_classes(get(url))
    name = re.search(r'class="upgTextName">(.*?)</span>', raw)
    slot = re.search(r"<dt>Slot</dt><dd>(.*?)</dd>", raw)
    desc = re.search(r'class="upgTextDescription">(.*?)</div></div>(?:<div class="upgTextWeapons">|</div>)', raw, flags=re.S)
    if not name or not slot:
        return None
    req = re.search(r'class="upgTextRequirements">(.*?)</div>', raw)
    w = raw.find('class="upgTextWeapons"><div class="weapon">')
    slot_name = to_text(slot.group(1))
    out = {
        "name": to_text(name.group(1)).strip("• "),
        "type": SLOTS.get(slot_name, slug(slot_name)),
        "text": card_text(desc.group(1)) if desc else "",
    }
    if req:
        out["requirement"] = card_text(req.group(1))
    if w >= 0:
        out["weapon"] = parse_weapon(raw[w:])
    return out


def upgrades_main(upgrades: list, sitemap: str) -> None:
    urls = re.findall(rf"<loc>({SITE}/cards/upgrades/[^<]+)</loc>", sitemap)
    with ThreadPoolExecutor(8) as ex:
        pages = [p for p in ex.map(upgrade_page, urls) if p]
    by_name: dict[str, list[dict]] = {}
    for p in pages:
        by_name.setdefault(norm(p["name"]), []).append(p)

    out, unmatched = {}, []
    for u in upgrades:
        cands = by_name.get(norm(u["name"]), [])
        if len(cands) > 1:
            cands = [p for p in cands if p["type"] == u["type"]] or cands
        found = {json.dumps({k: v for k, v in p.items() if k not in ("name", "type")}, sort_keys=True) for p in cands}
        if len(found) == 1:
            rules = json.loads(found.pop())
            if rules.get("text") or rules.get("weapon"):
                out[u["id"]] = {k: v for k, v in rules.items() if v}
                continue
        unmatched.append(u["id"])
    json.dump(dict(sorted(out.items())), open(UPGRADES_OUT, "w"), indent=1, ensure_ascii=False)
    open(UPGRADES_OUT, "a").write("\n")
    print(f"wrote {len(out)} upgrades to {UPGRADES_OUT}; no single match for {len(unmatched)}")


FACTION_NAMES = {
    "galactic empire": "imperials", "rebel alliance": "rebels", "galactic republic": "republic",
    "separatist alliance": "separatists", "separatist alliancen": "separatists",
}
# As in BATTLE_FORCES in src/lib/factions.ts.
BATTLE_FORCES = [
    "212th Attack Battalion", "501st Legion", "Wookiee Defenders", "Bright Tree Village",
    "Echo Base Defenders", "Blizzard Force", "Imperial Remnant", "Stormtrooper Battalion", "Tempest Force",
    "Experimental Droids", "Rapid Interdiction Force", "Separatist Invasion", "Shadow Collective",
    "The Ohnaka Gang",
]
TYPOS = {"griveous": "grievous"}


def resolve_requirement(req: str, units: list) -> dict:
    """{} = any army; {"faction"}, {"battleForce"}, {"units", "all"}, or
    {"text"} when it names something we can't check (an affiliation)."""
    low = req.lower().strip()
    for t, fix in TYPOS.items():
        low = low.replace(t, fix)
    if not low:
        return {}
    if low in FACTION_NAMES:
        return {"faction": FACTION_NAMES[low]}
    if low.startswith("mercenary"):
        return {"faction": "mercenary", "text": req}
    for bf in BATTLE_FORCES:
        if bf.lower() == low:
            return {"battleForce": bf}
    every = " and " in low or " & " in low
    ids = []
    for part in re.split(r" or | and | & ", low):
        part = part.strip()
        name, _, sub = part.partition(", ")
        hits = [u["id"] for u in units
                if (u["name"].lower() == name and (not sub or (u.get("sub_title") or "").lower() == sub))
                or (u.get("sub_title") or "").lower() == part]
        if not hits:
            return {"text": req}
        ids.append(hits)
    return {"units": ids, **({"all": True} if every else {})}


def command_page(url: str):
    raw = strip_classes(get(url))
    name = re.search(r'class="cmdTextName">(.*?)</span>', raw)
    pips = re.search(r"<dt>Pips</dt><dd>(\d+)</dd>", raw)
    if not name or not pips:
        return None
    orders = re.search(r'class="cmdTextUnits">(.*?)</span>(?:<span class="cmdTextRequirement">|</div>)', raw, flags=re.S)
    req = re.search(r'class="cmdTextRequirement">(.*?)</span></div>', raw, flags=re.S)
    i = raw.find('class="cmdTextDescription"')
    j = min(k for k in (raw.find('<section class="section">'), raw.find('<div class="ctaRow"'), len(raw)) if k >= 0)
    body = raw[i:j] if i >= 0 else ""
    w = body.find('<div class="cmdTextWeapons"')
    weapon = parse_weapon(body[w:]) if w >= 0 else None
    if w >= 0:
        body = body[:w]
    out = {
        "slug": url.rstrip("/").rsplit("/", 1)[1],
        "name": card_text(name.group(1)),
        "pips": int(pips.group(1)),
        "orders": card_text(orders.group(1)) if orders else "",
        "requirementText": card_text(req.group(1)).replace("\n", " ") if req else "",
        "text": card_text(re.sub(r'<span class="cmdTextBullet">[^<]*</span>', "• ", body.split(">", 1)[-1])),
    }
    if weapon:
        out["weapon"] = weapon
    return out


def commands_main(units: list, sitemap: str) -> None:
    urls = re.findall(rf"<loc>({SITE}/cards/command/[^<]+)</loc>", sitemap)
    with ThreadPoolExecutor(8) as ex:
        pages = [p for p in ex.map(command_page, urls) if p]
    out, seen = [], set()
    for p in sorted(pages, key=lambda p: (p["pips"], p["name"].lower(), p["slug"])):
        # Legion Helper lists the generic cards twice, as …-og-… (the
        # printed card) and …-pre-… (a variant: its Assault orders 1 unit).
        key = (p["name"], p["pips"], p["orders"], p["requirementText"], p["text"])
        # Paragon cards are Tours of Duty only.
        if "-pre-" in p["slug"] or key in seen or p["requirementText"] == "Paragon":
            continue
        seen.add(key)
        card = {
            "id": re.sub(r"-(og|pre)-.*$", "", p["slug"]),
            "name": p["name"], "pips": p["pips"], "orders": p["orders"],
            "requirement": resolve_requirement(p["requirementText"], units),
            **({"requirementText": p["requirementText"]} if p["requirementText"] else {}),
            "text": p["text"],
            **({"weapon": p["weapon"]} if "weapon" in p else {}),
        }
        out.append(card)
    json.dump(out, open(COMMANDS_OUT, "w"), indent=1, ensure_ascii=False)
    open(COMMANDS_OUT, "a").write("\n")
    unresolved = [c["id"] for c in out if "text" in c["requirement"] and "faction" not in c["requirement"]]
    print(f"wrote {len(out)} command cards to {COMMANDS_OUT}; requirement not checkable for {len(unresolved)}: {', '.join(unresolved)}")


def main() -> None:
    catalog = json.load(open(sys.argv[1]))
    sitemap = get(f"{SITE}/sitemap.xml")
    upgrades_main(catalog["upgrades"], sitemap)
    commands_main(catalog["units"], sitemap)


if __name__ == "__main__":
    main()
