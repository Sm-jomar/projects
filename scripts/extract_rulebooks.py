"""Render rulebook + reference PDFs as page-level JPEGs for in-app viewing."""
from __future__ import annotations
import io
import json
import re
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LEGION = ROOT / "Legion"
OUT = ROOT / "public" / "rulebooks"
MANIFEST = ROOT / "src" / "data" / "rulebook-manifest.json"

# (pdf_filename, slug, display_title)
SOURCES: list[tuple[str, str, str]] = [
    ("DOC51_SWQ_Rulebook_05-01_Update.pdf", "core-rulebook", "Core Rulebook (SWQ, 05/01 Update)"),
    ("DOC51_TOD_Rulebook.pdf", "tours-of-duty", "Tours of Duty Rulebook"),
    ("DOC13_ReconRulebook_04302025.pdf", "recon-rulebook", "Recon Rulebook (04/30/2025)"),
    ("DOC51_ErrataReference-05-01-Update.pdf", "errata-reference", "Errata Reference (05/01 Update)"),
    ("DOC51_BattleForces.pdf", "battle-forces", "Battle Forces"),
    ("DOC28_LeaguePacket.pdf", "league-packet", "League Packet"),
    ("DOC28_GalacticConquestEvent.pdf", "galactic-conquest", "Galactic Conquest Event"),
    ("SWK23_DangerousEnvironments-1.pdf", "dangerous-environments", "Dangerous Environments"),
    ("SWQ_ToursOfDuty_Register_9_29.pdf", "tod-register", "Tours of Duty Register"),
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for fname, slug, title in SOURCES:
        path = LEGION / fname
        if not path.exists():
            print(f"  skip (missing): {fname}")
            continue
        out_dir = OUT / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        doc = fitz.open(path)
        page_files = []
        for pi, page in enumerate(doc):
            # render at 144 dpi (2x of 72) for readable text
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            pil = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            # cap long side at 1400px for web display
            long_side = max(pil.size)
            if long_side > 1400:
                scale = 1400 / long_side
                pil = pil.resize(
                    (int(pil.size[0] * scale), int(pil.size[1] * scale)),
                    Image.LANCZOS,
                )
            fn = f"p{pi + 1:03d}.jpg"
            pil.save(out_dir / fn, "JPEG", quality=78, optimize=True)
            page_files.append(f"rulebooks/{slug}/{fn}")
        doc.close()
        manifest.append({
            "slug": slug,
            "title": title,
            "source": fname,
            "pages": page_files,
            "pageCount": len(page_files),
        })
        print(f"  {slug:24s} {len(page_files):3d} pages")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote {sum(m['pageCount'] for m in manifest)} pages across {len(manifest)} books")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
