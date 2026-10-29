"""Download unit and upgrade card pictures from Legion Helper for cards we
have no scan of.

    python3 scripts/import_legion_helper_cards.py [unit ids]
    python3 scripts/import_legion_helper_cards.py --upgrades /tmp/catalog-cards.json

For upgrades, the JSON is {"ups": [{"id", "faction", "card"}]} as dumped from
the catalog with cardForUpgrade (card null = no scan); pictures come from
Legion/legion-helper/upgrade-images.json (see import_legion_helper_card_text.py)
and go to public/cards/<faction>/upgrade/lh/, listed in
src/data/upgrade-card-images.json.

Each Legion Helper unit page shows the card's stat side ("front") and, for
some units, the art side ("back"), both on takras.net. Like our other unit
cards (see legion-unit-card-images in cardLookup.ts), the art side goes on
top and the stat side below with a 6px black gap; with no art side the
picture is the stat side alone. Writes public/cards/<faction>/unit/<page>.jpg
and prints the UNIT_CARD_OVERRIDES lines to paste into cardLookup.ts.
"""

import io
import json
import os
import re
import sys
import urllib.request

from PIL import Image

from import_legion_helper_minis import SITE, get

# Our unit id -> Legion Helper unit page.
UNITS = {
    "rebels-rebel-agent": "rebel-agent-defender-of-democracy",
    "imperials-imperial-agent": "imperial-agent-bringing-order-to-the-galaxy",
    "republic-ahsoka-tano-padawan-commander": "ahsoka-tano-padawan-commander",
    "republic-jedi-knight-general": "jedi-knight-general-strong-in-the-force",
    "republic-jedi-knight": "jedi-knight-keeper-of-the-peace",
    "republic-clone-trooper-marksmen": "clone-trooper-marksmen",
    "republic-arf-troopers": "arf-troopers",
    "republic-obi-wan-kenobi-mounted-jedi-general": "obi-wan-kenobi-mounted-jedi-general",
    "republic-shaak-ti-jedi-council": "shaak-ti-jedi-council",
    "separatists-super-tactical-command-droid": "super-tactical-command-droid-command-and-control-droid",
    "separatists-super-tactical-command-droid-operative": "super-tactical-command-droid-auxilirary-command-droid",
    "separatists-lm-432-crab-droid": "lm-432-crab-droid",
    "separatists-aqua-droids": "aqua-droids",
    "separatists-admiral-trench-fleet-commander": "admiral-trench-fleet-commander",
    "separatists-b2-super-rocket-battle-droids": "b2-super-rocket-battle-droids",
    "mercenary-hondo-ohnaka": "hondo-ohnaka-trustworthy-compatriot",
    "mercenary-weequay-pirates": "weequay-pirates",
    "mercenary-wlo-5-speeder-tank": "wlo-5-speeder-tank",
    "mercenary-gar-saxon-head-of-clan-saxon": "gar-saxon-head-of-clan-saxon",
    "mercenary-mandalorian-warriors-fire-support": "mandalorian-warriors-fire-support",
    "mercenary-mandalorian-warriors": "mandalorian-warriors",
    "mercenary-rook-kast-devoted-to-the-cause": "rook-kast-devoted-to-the-cause",
    "mercenary-sabine-wren-back-in-the-fold": "sabine-wren-back-in-the-fold",
    "mercenary-super-commandos": "super-commandos",
    "mercenary-the-armorer-forging-the-future": "the-armorer-forging-the-future",
    "mercenary-ursa-wren-leader-of-clan-wren": "ursa-wren-leader-of-clan-wren",
    # Revamp-only printings (scripts/import_tabletop_admiral.py).
    "republic-anakin-skywalker-mounted-jedi-general": "anakin-skywalker-mounted-jedi-general",
    "mercenary-axe-woves-cunning-warrior": "axe-woves-cunning-warrior",
    "mercenary-bo-katan-kryze-savior-of-mandalore": "bo-katan-kryze-savior-of-mandalore",
    "mercenary-clan-kryze-veterans": "clan-kryze-veterans",
    "mercenary-clan-wren-veterans": "clan-wren-veterans",
    "separatists-general-grievous-wheel-bike-warlord": "general-grievous-wheel-bike-warlord",
    "imperials-general-tagge-imperial-high-command": "general-tagge-imperial-high-command",
    "separatists-geonosian-warriors-geonosian-engineers": "geonosian-warriors-geonosian-engineers",
    "imperials-grand-admiral-thrawn-imperial-high-command": "grand-admiral-thrawn-imperial-high-command",
    "imperials-grand-moff-tarkin-imperial-high-command": "grand-moff-tarkin-imperial-high-command",
    "mercenary-han-chewie-notorious-scoundrels": "han-and-chewie-notorious-scoundrels",
    "rebels-han-solo-reluctant-hero": "han-solo-reluctant-hero",
    "imperials-imperial-officer-ruthless-efficiency": "imperial-officer-ruthless-efficiency",
    "imperials-imperial-probe-droid": "imperial-probe-droid",
    "republic-jedi-knight-mounted-jedi-general": "jedi-knight-mounted-jedi-general",
    "republic-ki-adi-mundi-jedi-council": "ki-adi-mundi-jedi-council",
    "rebels-luke-skywalker-commander-skywalker": "luke-skywalker-commander-skywalker",
    "republic-mace-windu-jedi-council": "mace-windu-jedi-council",
    "mercenary-mandalorian-hunter": "mandalorian-hunter",
    "mercenary-mandalorian-initiates": "mandalorian-initiates",
    "mercenary-mandalorian-leader": "mandalorian-leader",
    "mercenary-paz-vizsla-proud-warrior": "paz-vizsla-proud-warrior",
    "republic-plo-koon-jedi-council": "plo-koon-jedi-council",
    "rebels-rebel-officer-fighting-for-freedom": "rebel-officer-fighting-for-freedom",
    "separatists-savage-opress-dooku-s-apprentice": "savage-opress-dooku-s-apprentice",
    "mercenary-savage-opress-maul-s-enforcer": "savage-opress-maul-s-enforcer",
    "separatists-tsmeu-6-wheel-bikes": "tsmeu-6-wheel-bikes",
}

WIDTH = 1039  # our other unit cards
GAP = 6
UPGRADE_WIDTH = 450  # big enough for the picker preview, ~30KB each
UPGRADE_IMAGES = "Legion/legion-helper/upgrade-images.json"
UPGRADE_MAP = "src/data/upgrade-card-images.json"


def image(url: str, width: int = WIDTH) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "legion-army-builder"})
    with urllib.request.urlopen(req, timeout=60) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def upgrades_main(dump: str) -> None:
    urls = json.load(open(UPGRADE_IMAGES))
    out = json.load(open(UPGRADE_MAP)) if os.path.exists(UPGRADE_MAP) else {}
    for u in json.load(open(dump))["ups"]:
        if u["card"] or u["id"] in out or u["id"] not in urls:
            continue
        url = urls[u["id"]]
        path = f"cards/{u.get('faction') or 'generic'}/upgrade/lh/{url.rsplit('/', 1)[1]}"
        os.makedirs(os.path.dirname(f"public/{path}"), exist_ok=True)
        image(url, UPGRADE_WIDTH).save(f"public/{path}", quality=80)
        out[u["id"]] = path
    json.dump(dict(sorted(out.items())), open(UPGRADE_MAP, "w"), indent=1)
    open(UPGRADE_MAP, "a").write("\n")
    print(f"{len(out)} upgrade pictures in {UPGRADE_MAP}")


def main() -> None:
    if sys.argv[1:2] == ["--upgrades"]:
        return upgrades_main(sys.argv[2])
    only = set(sys.argv[1:])
    for unit_id, page in UNITS.items():
        if only and unit_id not in only:
            continue
        html = get(f"{SITE}/cards/units/{page}/")
        front = re.search(r'<img src="(https://takras\.net/[^"]+)" alt="[^"]* card"', html)
        back = re.search(r'<img src="(https://takras\.net/[^"]+)" alt="[^"]* card back"', html)
        if not front:
            print(f"# {unit_id}: no card picture on {page}", file=sys.stderr)
            continue
        sides = [image(back.group(1))] if back else []
        sides.append(image(front.group(1)))
        out = Image.new("RGB", (WIDTH, sum(s.height for s in sides) + GAP * (len(sides) - 1)), (0, 0, 0))
        y = 0
        for s in sides:
            out.paste(s, (0, y))
            y += s.height + GAP
        faction = unit_id.split("-", 1)[0]
        path = f"cards/{faction}/unit/{page}.jpg"
        out.save(f"public/{path}", quality=85)
        print(f'  "{unit_id}": "{path}",{"" if back else "  // stat side only"}')


if __name__ == "__main__":
    main()
