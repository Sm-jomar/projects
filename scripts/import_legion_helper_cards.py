"""Download unit card pictures from Legion Helper for units we have no scan of.

    python3 scripts/import_legion_helper_cards.py

Each Legion Helper unit page shows the card's stat side ("front") and, for
some units, the art side ("back"), both on takras.net. Like our other unit
cards (see legion-unit-card-images in cardLookup.ts), the art side goes on
top and the stat side below with a 6px black gap; with no art side the
picture is the stat side alone. Writes public/cards/<faction>/unit/<page>.jpg
and prints the UNIT_CARD_OVERRIDES lines to paste into cardLookup.ts.
"""

import io
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
}

WIDTH = 1039  # our other unit cards
GAP = 6


def image(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "legion-army-builder"})
    with urllib.request.urlopen(req, timeout=60) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    return im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)


def main() -> None:
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
