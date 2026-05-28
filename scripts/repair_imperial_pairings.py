"""Manually re-pair Imperial unit cards from the Galactic Empire Units PDF.

Each catalog id maps to (front_page, front_pos, back_page, back_pos). Reads
those specific embedded images from the PDF, composites them vertically
(picture/front on top, stats/back below), and writes to
public/cards/imperials/unit/.

Positions identified from OCR output of extract_pdf() on
DOC51_GalacticEmpire_Units.pdf.
"""
import fitz, io
from pathlib import Path
from PIL import Image

PDF = Path("Legion/DOC51_GalacticEmpire_Units.pdf")
OUT = Path("public/cards/imperials/unit")

# (catalog_id, output_filename, front_page_idx, front_pos, back_page_idx, back_pos)
PAIRINGS = [
    # Stormtroopers (regular) and Heavy Response Unit + Snowtroopers
    ("stormtroopers",                        "stormtroopers.jpg",            0, 1, 0, 0),
    ("stormtrooper-riot-squad",              "stormtrooper-riot-squad.jpg",  0, 5, 0, 2),
    ("stormtroopers-heavy-response-unit",    "stormtroopers-hru.jpg",        1, 2, 1, 1),
    ("snowtroopers",                         "snowtroopers.jpg",             1, 8, 1, 5),
    # Shoretroopers, DF-90, Scout Troopers
    ("shoretroopers",                        "shoretroopers.jpg",            2, 5, 2, 2),
    ("df-90-mortar-trooper",                 "df-90-mortar-trooper.jpg",     3, 2, 3, 1),
    ("scout-troopers",                       "scout-troopers.jpg",           3, 8, 3, 5),
    # Imperial Death Troopers, Special Forces (Inferno) — regular Special Forces
    # front not detected, leave for later.
    ("imperial-death-troopers",              "imperial-death-troopers.jpg",  4, 3, 4, 1),
    ("imperial-special-forces-inferno",      "imperial-special-forces-inferno.jpg", 5, 2, 5, 1),
    # 74-Z Speeder Bikes
    ("74-z-speeder-bikes",                   "74-z-speeder-bikes.jpg",       5, 8, 5, 5),
    # E-Web Heavy Blaster Team, Dewback Rider
    ("e-web-heavy-blaster-team",             "e-web-heavy-blaster-team.jpg", 6, 1, 6, 4),
    ("dewback-rider",                        "dewback-rider.jpg",            6, 5, 6, 2),
    # Range Troopers, AT-ST, TX-225, LAAT
    ("range-troopers",                       "range-troopers.jpg",           7, 4, 7, 1),
    ("at-st",                                "at-st.jpg",                    7, 2, 7, 7),
    ("tx-225-gavw-occupier-tank",            "tx-225-gavw-occupier-tank.jpg",7, 8, 7, 5),
    ("laat-le-patrol-transport",             "laat-le-patrol-transport.jpg", 8, 3, 8, 0),
    # Imperial Dark Troopers, Krennic, Veers
    ("imperial-dark-troopers",               "imperial-dark-troopers.jpg",   8, 1, 8, 6),
    ("director-orson-krennic",               "director-orson-krennic.jpg",   8, 5, 8, 2),
    ("general-veers",                        "general-veers.jpg",            8, 7, 8, 4),
    # Vader Dark Lord, Vader Apprentice
    ("darth-vader",                          "darth-vader-dark-lord.jpg",    9, 0, 8, 8),
    ("darth-vader-apprentice",               "darth-vader-apprentice.jpg",   9, 8, 9, 5),
    # Iden's ID10 Seeker Droid
    ("idens-id10-seeker-droid",              "idens-id10-seeker-droid.jpg",  9, 4, 9, 1),
    # Moff Gideon (Long Live the Empire), Iden Versio (Inferno Squad Leader)
    ("moff-gideon",                          "moff-gideon.jpg",              9, 2, 9, 7),
    ("iden-versio",                          "iden-versio.jpg",              9, 6, 9, 3),
    # Fifth Brother, Seventh Sister, Major Marquand, Agent Kallus
    ("fifth-brother",                        "fifth-brother.jpg",            10, 3, 10, 0),
    ("seventh-sister",                       "seventh-sister.jpg",           10, 1, 10, 6),
    ("major-marquand",                       "major-marquand.jpg",           10, 5, 10, 2),
    ("agent-kallus",                         "agent-kallus.jpg",             10, 7, 10, 4),
]


def get_image(doc, page_idx: int, pos: int) -> Image.Image:
    page = doc[page_idx]
    info = doc.extract_image(page.get_images(full=True)[pos][0])
    return Image.open(io.BytesIO(info["image"])).convert("RGB")


def stack_vertical(front: Image.Image, back: Image.Image) -> Image.Image:
    w = front.width
    if back.width != w:
        scale = w / back.width
        back = back.resize((w, int(back.height * scale)), Image.LANCZOS)
    total_h = front.height + back.height + 6
    canvas = Image.new("RGB", (w, total_h), (0, 0, 0))
    canvas.paste(front, (0, 0))
    canvas.paste(back, (0, front.height + 6))
    if max(canvas.size) > 1600:
        s = 1600 / max(canvas.size)
        canvas = canvas.resize(
            (int(canvas.size[0] * s), int(canvas.size[1] * s)), Image.LANCZOS
        )
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)
    written = 0
    for cat_id, fname, fp, fpos, bp, bpos in PAIRINGS:
        try:
            front = get_image(doc, fp, fpos)
            back = get_image(doc, bp, bpos)
        except IndexError as e:
            print(f"  SKIP {cat_id}: {e}")
            continue
        composite = stack_vertical(front, back)
        composite.save(OUT / fname, "JPEG", quality=84, optimize=True)
        written += 1
        print(f"  wrote {fname}")
    print(f"\nWrote {written} re-paired Imperial unit composites.")


if __name__ == "__main__":
    main()
