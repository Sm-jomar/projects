"""Extract card images from Legion PDFs, OCR titles, write a manifest.

Usage: python3 scripts/extract_cards.py [pdf_glob...]
If no args, processes the default card PDFs in Legion/.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import fitz
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
LEGION = ROOT / "Legion"
OUT_CARDS = ROOT / "public" / "cards"
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"

# (filename pattern) -> (faction, kind)
SOURCES: list[tuple[str, str, str]] = [
    ("DOC51_RebelAlliance_Units.pdf", "rebels", "unit"),
    ("DOC51_RebelAlliance_Upgrades.pdf", "rebels", "upgrade"),
    ("DOC51_GalacticEmpire_Units.pdf", "imperials", "unit"),
    ("DOC51_GalacticEmpire_Upgrades.pdf", "imperials", "upgrade"),
    ("DOC51_GalacticRepublic_Units.pdf", "republic", "unit"),
    ("DOC51_GalacticRepublic_Upgrades.pdf", "republic", "upgrade"),
    ("DOC51_SeparatistAlliance_Units_05-01_Update.pdf", "separatists", "unit"),
    ("DOC51_SeparatistAlliance_Upgrades.pdf", "separatists", "upgrade"),
    ("DOC13_Mercenary_Units.pdf", "mercenary", "unit"),
    ("DOC13_Mercenary_Upgrades.pdf", "mercenary", "upgrade"),
    ("DOC13_Mercenary_Ewoks.pdf", "mercenary", "unit"),
    ("DOC51_Generic_Upgrades.pdf", "generic", "upgrade"),
    ("DOC51_UpgradeCards.pdf", "generic", "upgrade"),
    ("DOC13_GalacticEmpire_Commands.pdf", "imperials", "command"),
    ("DOC13_RebelAlliance_Commands.pdf", "rebels", "command"),
    ("DOC13_SeparatistAlliance_Commands.pdf", "separatists", "command"),
    ("DOC51_Mercenary_Commands_05-01_Update.pdf", "mercenary", "command"),
    ("SWQ_GalacticRepublic_Commands.pdf", "republic", "command"),
    ("DOC41_BattleCards_11.26.2025.pdf", "generic", "battle"),
]


def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.strip().lower())
    return re.sub(r"-+", "-", s).strip("-") or "card"


def _ocr(img: Image.Image, invert: bool = True) -> str:
    """OCR helper. Upscales 3x, optionally inverts (for white-on-dark title bars), autocontrasts."""
    up = img.resize((img.size[0] * 3, img.size[1] * 3), Image.LANCZOS)
    up = ImageOps.grayscale(up)
    if invert:
        up = ImageOps.invert(up)
    up = ImageOps.autocontrast(up, cutoff=2)
    buf = io.BytesIO()
    up.save(buf, format="PNG")
    try:
        r = subprocess.run(
            ["tesseract", "stdin", "stdout", "--psm", "11", "--oem", "1"],
            input=buf.getvalue(),
            capture_output=True,
            check=False,
            timeout=20,
        )
        out = r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""
    # take first non-trivial line (the title)
    for line in out.splitlines():
        line = line.strip()
        if len(re.sub(r"[^A-Za-z0-9]", "", line)) >= 3:
            return line
    return ""


def ocr_title(img: Image.Image) -> str:
    """OCR the title region of a card image. Cards come in landscape (unit) or portrait (upgrade/command/battle)."""
    w, h = img.size
    if w >= h:
        # landscape unit card: title is white text on dark bar across the top (skip faction icon + points)
        crop = img.crop((int(w * 0.10), int(h * 0.005), int(w * 0.86), int(h * 0.10)))
        text = _ocr(crop, invert=True)
    else:
        # portrait card: title is at top (front) on dark bar OR bottom on light background
        top = img.crop((int(w * 0.05), int(h * 0.005), int(w * 0.95), int(h * 0.08)))
        bot = img.crop((int(w * 0.05), int(h * 0.92), int(w * 0.95), int(h * 0.995)))
        top_t = _ocr(top, invert=True)
        bot_t = _ocr(bot, invert=False)

        def score(s: str) -> int:
            letters = sum(c.isalpha() for c in s)
            return letters - (len(s) - letters) // 2
        text = top_t if score(top_t) >= score(bot_t) else bot_t
    # cleanup: remove noise lines, fix common ocr glitches
    text = re.sub(r"[\r\n]+", " ", text)
    text = re.sub(r"[^A-Za-z0-9 ’'\-/.&]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Tesseract often mis-reads MEDIUM as MEPIUM, etc. Light corrections only.
    fixes = {
        "Mepium": "Medium",
        "MEPIUM": "MEDIUM",
        "RIFLEMEN": "Riflemen",
    }
    for k, v in fixes.items():
        text = text.replace(k, v)
    return text


@dataclass
class CardEntry:
    faction: str
    kind: str
    title: str
    slug: str
    file: str  # relative path under public/
    source: str  # source PDF
    sha1: str  # image hash for dedupe


def main() -> int:
    OUT_CARDS.mkdir(parents=True, exist_ok=True)
    manifest: list[CardEntry] = []
    seen_hashes: set[str] = set()
    slug_counters: dict[str, int] = {}

    for pdf_name, faction, kind in SOURCES:
        pdf_path = LEGION / pdf_name
        if not pdf_path.exists():
            print(f"  skip (missing): {pdf_name}")
            continue
        print(f"+ {pdf_name}  -> {faction}/{kind}")
        doc = fitz.open(pdf_path)
        out_dir = OUT_CARDS / faction / kind
        out_dir.mkdir(parents=True, exist_ok=True)
        for pi, page in enumerate(doc):
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                info = doc.extract_image(xref)
                data: bytes = info["image"]
                ext: str = info["ext"]
                h = hashlib.sha1(data).hexdigest()
                if h in seen_hashes:
                    continue
                # filter: card images are ~1039x726 (unit, landscape) or ~726x1039 (upgrade/command/battle, portrait)
                w_px, h_px = info.get("width", 0), info.get("height", 0)
                long_side, short_side = max(w_px, h_px), min(w_px, h_px)
                if long_side < 900 or short_side < 600:
                    continue
                seen_hashes.add(h)
                # OCR for title
                try:
                    pil = Image.open(io.BytesIO(data)).convert("RGB")
                except Exception:
                    continue
                title = ocr_title(pil)
                if not title or len(title) < 2:
                    title = f"{faction}-{kind}-{h[:8]}"
                slug = slugify(title)
                slug_counters[slug] = slug_counters.get(slug, 0) + 1
                if slug_counters[slug] > 1:
                    slug = f"{slug}-{slug_counters[slug]}"
                # compress: cap long side at 900px, JPEG q82. Cards stay legible, repo stays small.
                pil_rgb = pil
                long_side = max(pil_rgb.size)
                if long_side > 900:
                    scale = 900 / long_side
                    new_size = (int(pil_rgb.size[0] * scale), int(pil_rgb.size[1] * scale))
                    pil_rgb = pil_rgb.resize(new_size, Image.LANCZOS)
                fname = f"{slug}.jpg"
                pil_rgb.save(out_dir / fname, "JPEG", quality=82, optimize=True)
                rel = f"cards/{faction}/{kind}/{fname}"
                manifest.append(
                    CardEntry(
                        faction=faction,
                        kind=kind,
                        title=title,
                        slug=slug,
                        file=rel,
                        source=pdf_name,
                        sha1=h[:12],
                    )
                )
        doc.close()
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps([asdict(c) for c in manifest], indent=2))
    print(f"\nWrote {len(manifest)} cards to {OUT_CARDS}")
    print(f"Manifest: {MANIFEST.relative_to(ROOT)}")
    # quick summary
    by = {}
    for c in manifest:
        by.setdefault((c.faction, c.kind), 0)
        by[(c.faction, c.kind)] += 1
    print("\nBy faction/kind:")
    for (f, k), n in sorted(by.items()):
        print(f"  {f:12s} {k:8s} {n:4d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
