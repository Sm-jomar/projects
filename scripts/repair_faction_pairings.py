"""Re-pair Rebel, Republic, and Separatist unit cards from their source PDFs.

Each faction has a hand-curated list of catalog-id -> (front_page, front_pos,
back_page, back_pos) tuples, derived from OCR inspection of extract_pdf().
Composites are picture/front on top, stats/back below.
"""
import fitz, io
from pathlib import Path
from PIL import Image

LEGION = Path("Legion")
ROOT = Path(".")

# faction -> (pdf filename, output subdir, pairings list)
# pairing tuple = (output_filename, front_page, front_pos, back_page, back_pos)
JOBS = {
    "rebels": (
        "DOC51_RebelAlliance_Units.pdf",
        [
            ("mark-ii-medium-blaster-trooper.jpg", 0, 1, 0, 0),
            ("rebel-troopers.jpg",                 0, 5, 0, 2),
            ("fleet-troopers.jpg",                 1, 2, 1, 1),
            ("rebel-veterans.jpg",                 2, 1, 2, 0),
            ("rebel-commandos.jpg",                2, 5, 2, 2),
            ("wookiee-warriors-freedom-fighters.jpg", 3, 1, 3, 2),
            ("wookiee-warriors-kashyyyk-resistance.jpg", 4, 1, 4, 0),
            ("mandalorian-resistance.jpg",         4, 5, 4, 2),
            ("mandalorian-resistance-clan-wren.jpg", 5, 0, 4, 8),
            ("rebel-sleeper-cell.jpg",             5, 4, 5, 1),
            ("at-rt.jpg",                          5, 2, 5, 5),
            ("1-4-fd-laser-cannon-team.jpg",       6, 1, 6, 0),
            ("tauntaun-riders.jpg",                6, 2, 6, 5),
            ("t-47-airspeeder.jpg",                7, 0, 6, 8),
            ("a-a5-speeder-truck.jpg",             7, 3, 7, 1),
            ("x-34-landspeeder.jpg",               7, 4, 7, 2),
            ("c-3po.jpg",                          7, 5, 7, 7),
            ("leia-organa.jpg",                    7, 8, 7, 6),
            ("han-solo.jpg",                       8, 1, 8, 6),
            ("luke-skywalker-hero.jpg",            8, 3, 8, 0),
            ("cassian-andor.jpg",                  8, 5, 8, 2),
            ("jyn-erso.jpg",                       8, 7, 8, 4),
            ("lando-calrissian.jpg",               9, 0, 8, 8),
            ("sabine-wren.jpg",                    9, 4, 9, 1),
            ("luke-skywalker-jedi.jpg",            9, 2, 9, 7),
            ("chewbacca.jpg",                      9, 6, 9, 3),
            ("r2-d2.jpg",                          9, 8, 9, 5),
            ("k-2so.jpg",                          10, 1, 10, 3),
            ("ahsoka-tano.jpg",                    10, 2, 10, 0),
        ],
    ),
    "separatists": (
        "DOC51_SeparatistAlliance_Units_05-01_Update.pdf",
        [
            ("b1-battle-droids.jpg",               0, 1, 0, 0),
            ("b2-super-battle-droids.jpg",         0, 5, 0, 2),
            ("geonosian-warriors.jpg",             1, 2, 1, 1),
            ("bx-series-droid-commandos.jpg",      2, 1, 2, 0),
            ("ig-100-magnaguards.jpg",             3, 0, 2, 4),
            ("ig-100-magnaguards-prototype.jpg",   3, 2, 3, 1),
            ("stap-riders.jpg",                    4, 2, 4, 0),
            ("dsd1-dwarf-spider-droid.jpg",        5, 0, 4, 4),
            ("aat-battle-tank.jpg",                5, 4, 5, 1),
            ("persuader-class-tank-droid.jpg",     5, 2, 5, 5),
            ("persuader-prototype-tank-droid.jpg", 5, 8, 5, 7),
            ("general-grievous.jpg",               6, 3, 6, 0),
            ("count-dooku.jpg",                    6, 1, 6, 6),
            ("kraken.jpg",                         6, 5, 6, 2),
            ("t-series-tactical-droid.jpg",        6, 7, 6, 4),
            ("kalani.jpg",                         7, 0, 6, 8),
            ("maul.jpg",                           7, 4, 7, 1),
            ("drk-1-sith-probe-droids.jpg",        7, 2, 7, 7),
            ("poggle-the-lesser.jpg",              7, 6, 7, 3),
            ("asajj-ventress.jpg",                 7, 8, 7, 5),
            ("sun-fac.jpg",                        8, 4, 8, 0),
        ],
    ),
    "republic": (
        "DOC51_GalacticRepublic_Units.pdf",
        [
            ("clone-trooper-infantry.jpg",         0, 1, 0, 0),
            ("arc-troopers.jpg",                   0, 5, 0, 2),
            ("wookiee-warriors-kashyyyk-defenders.jpg", 1, 1, 1, 2),
            ("wookiee-warriors-noble-fighters.jpg", 2, 1, 2, 0),
            ("barc-speeder.jpg",                   2, 5, 2, 2),
            ("at-rt.jpg",                          3, 0, 2, 8),
            ("raddaugh-gnasp-fluttercraft.jpg",    3, 2, 3, 1),
            ("raddaugh-gnasp-fluttercraft-attack.jpg", 3, 8, 3, 5),
            ("clone-commandos.jpg",                4, 1, 4, 2),
            ("clone-commandos-delta-squad.jpg",    4, 5, 4, 4),
            ("saber-class-tank.jpg",               5, 0, 4, 8),
            ("infantry-support-platform.jpg",      5, 4, 5, 1),
            ("laat-le-patrol-transport.jpg",       5, 6, 5, 3),
            ("obi-wan-kenobi.jpg",                 5, 8, 5, 5),
            ("clone-captain-rex.jpg",              6, 3, 6, 0),
            ("anakin-skywalker.jpg",               6, 1, 6, 6),
            ("yoda.jpg",                           6, 5, 6, 2),
            ("clone-commander.jpg",                6, 7, 6, 4),
            ("wookiee-chieftain.jpg",              7, 0, 6, 8),
            ("clone-commander-cody.jpg",           7, 4, 7, 1),
            ("chewbacca.jpg",                      7, 6, 7, 3),
            ("padme-amidala.jpg",                  7, 8, 7, 5),
        ],
    ),
}


def get_image(doc, page_idx, pos):
    page = doc[page_idx]
    info = doc.extract_image(page.get_images(full=True)[pos][0])
    return Image.open(io.BytesIO(info["image"])).convert("RGB")


def stack_vertical(front, back):
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
        canvas = canvas.resize((int(canvas.size[0] * s), int(canvas.size[1] * s)), Image.LANCZOS)
    return canvas


def main():
    for faction, (pdf_name, pairings) in JOBS.items():
        pdf = LEGION / pdf_name
        out = ROOT / "public" / "cards" / faction / "unit"
        out.mkdir(parents=True, exist_ok=True)
        doc = fitz.open(pdf)
        n = 0
        for fname, fp, fpos, bp, bpos in pairings:
            try:
                front = get_image(doc, fp, fpos)
                back = get_image(doc, bp, bpos)
            except IndexError as e:
                print(f"  SKIP {faction}/{fname}: {e}")
                continue
            stack_vertical(front, back).save(out / fname, "JPEG", quality=84, optimize=True)
            n += 1
            print(f"  wrote {faction}/{fname}")
        doc.close()
        print(f"{faction}: {n} composites")


if __name__ == "__main__":
    main()
