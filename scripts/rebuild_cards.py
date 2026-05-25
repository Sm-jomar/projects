"""End-to-end rebuild of public/cards from the Legion PDFs.

Extracts every embedded card image, OCRs the title and cost (top-right
corner), groups likely-duplicate sides by fuzzy title match, then
composites groups vertically with the FRONT (the side showing the cost
in the top-right corner) on top and the BACK (rules text) on bottom.
Singleton cards are left unstacked. Rewrites card-manifest.json with
title and points (best-effort OCR) for every output file.
"""
from __future__ import annotations
import hashlib
import io
import json
import re
import shutil
import subprocess
from dataclasses import dataclass, asdict, field
from difflib import SequenceMatcher
from pathlib import Path

import fitz
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
LEGION = ROOT / "Legion"
OUT_CARDS = ROOT / "public" / "cards"
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"

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

# --- OCR helpers ---

def _ocr_text(img: Image.Image, *, invert: bool = True, psm: str = "11") -> str:
    up = img.resize((img.size[0] * 3, img.size[1] * 3), Image.LANCZOS)
    up = ImageOps.grayscale(up)
    if invert:
        up = ImageOps.invert(up)
    up = ImageOps.autocontrast(up, cutoff=2)
    buf = io.BytesIO()
    up.save(buf, format="PNG")
    try:
        r = subprocess.run(
            ["tesseract", "stdin", "stdout", "--psm", psm, "--oem", "1"],
            input=buf.getvalue(),
            capture_output=True,
            check=False,
            timeout=20,
        )
        return r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def _ocr_digits(img: Image.Image, *, invert: bool = True) -> str:
    up = img.resize((img.size[0] * 4, img.size[1] * 4), Image.LANCZOS)
    up = ImageOps.grayscale(up)
    if invert:
        up = ImageOps.invert(up)
    up = ImageOps.autocontrast(up, cutoff=4)
    buf = io.BytesIO()
    up.save(buf, format="PNG")
    try:
        r = subprocess.run(
            [
                "tesseract", "stdin", "stdout",
                "--psm", "7", "--oem", "1",
                "-c", "tessedit_char_whitelist=0123456789",
            ],
            input=buf.getvalue(),
            capture_output=True,
            check=False,
            timeout=15,
        )
        return r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def ocr_title(img: Image.Image) -> str:
    w, h = img.size
    if w >= h:
        crop = img.crop((int(w * 0.10), int(h * 0.005), int(w * 0.86), int(h * 0.10)))
        text = _ocr_text(crop, invert=True)
    else:
        top = img.crop((int(w * 0.05), int(h * 0.005), int(w * 0.95), int(h * 0.08)))
        bot = img.crop((int(w * 0.05), int(h * 0.92), int(w * 0.95), int(h * 0.995)))
        top_t = _ocr_text(top, invert=True)
        bot_t = _ocr_text(bot, invert=False)
        def score(s: str) -> int:
            letters = sum(c.isalpha() for c in s)
            return letters - (len(s) - letters) // 2
        text = top_t if score(top_t) >= score(bot_t) else bot_t
    for line in text.splitlines():
        line = line.strip()
        if len(re.sub(r"[^A-Za-z0-9]", "", line)) >= 3:
            text = line
            break
    text = re.sub(r"[\r\n]+", " ", text)
    text = re.sub(r"[^A-Za-z0-9 ’'\-/.&]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    fixes = {
        "Mepium": "Medium",
        "MEPIUM": "MEDIUM",
        "RIFLEMEN": "Riflemen",
    }
    for k, v in fixes.items():
        text = text.replace(k, v)
    return text


def detect_cost(img: Image.Image) -> tuple[int | None, float]:
    """Return (points, saturation_score). FRONT cards have a saturated colored
    cost badge in the top-right; BACK cards do not. Ensemble OCR over a few
    crop sizes to handle badge styles that vary across cards.
    """
    w, h = img.size
    landscape = w >= h
    # The cost badge sits in the top-right corner. Try several crop sizes
    # since the badge geometry varies by card style.
    crop_specs = (
        (0.82, 0.18) if landscape else (0.75, 0.14),
        (0.78, 0.20) if landscape else (0.70, 0.16),
        (0.86, 0.14) if landscape else (0.80, 0.10),
    )
    # Saturation score from the widest crop.
    base = img.crop((int(w * 0.82), int(h * 0.005), w, int(h * 0.18)))
    hsv = base.convert("HSV")
    sat_band = hsv.split()[1]
    sat_mean = sum(sat_band.getdata()) / max(1, sat_band.width * sat_band.height)
    candidates: list[int] = []
    for x_pct, y_pct in crop_specs:
        crop = img.crop((int(w * x_pct), int(h * 0.005), w, int(h * y_pct)))
        for inv in (True, False):
            s = _ocr_digits(crop, invert=inv)
            for tok in re.findall(r"\d+", s):
                v = int(tok)
                if 1 <= v <= 500:
                    candidates.append(v)
    if not candidates:
        return None, float(sat_mean)
    # Pick the most common candidate; tie-break by largest.
    from collections import Counter
    counts = Counter(candidates)
    most_common = counts.most_common()
    top_count = most_common[0][1]
    leaders = [v for v, c in most_common if c == top_count]
    return max(leaders), float(sat_mean)


# --- Extraction ---

@dataclass
class RawCard:
    page: int
    pos: int  # image index on page (0..8)
    bbox: tuple[float, float, float, float]
    sha1: str
    title: str
    points: int | None
    sat: float
    pil: Image.Image = field(repr=False)


def extract_pdf(pdf: Path) -> list[RawCard]:
    doc = fitz.open(pdf)
    cards: list[RawCard] = []
    seen = set()
    for pi, page in enumerate(doc):
        infos = page.get_image_info()
        for ii, img_ref in enumerate(page.get_images(full=True)):
            xref = img_ref[0]
            info = doc.extract_image(xref)
            data: bytes = info["image"]
            w_px, h_px = info.get("width", 0), info.get("height", 0)
            long_side, short_side = max(w_px, h_px), min(w_px, h_px)
            if long_side < 900 or short_side < 600:
                continue
            h = hashlib.sha1(data).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            try:
                pil = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception:
                continue
            bbox = tuple(infos[ii].get("bbox")) if ii < len(infos) else (0.0, 0.0, 0.0, 0.0)
            title = ocr_title(pil)
            points, sat = detect_cost(pil)
            cards.append(
                RawCard(
                    page=pi + 1,
                    pos=ii,
                    bbox=bbox,
                    sha1=h,
                    title=title,
                    points=points,
                    sat=sat,
                    pil=pil,
                )
            )
    doc.close()
    return cards


# --- Pairing ---

def _norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def group_cards(cards: list[RawCard], threshold: float = 0.82) -> list[list[RawCard]]:
    groups: list[list[RawCard]] = []
    used = [False] * len(cards)
    norms = [_norm(c.title) for c in cards]
    for i, c in enumerate(cards):
        if used[i]:
            continue
        group = [c]
        used[i] = True
        if norms[i]:
            for j in range(i + 1, len(cards)):
                if used[j] or not norms[j]:
                    continue
                if _sim(norms[i], norms[j]) >= threshold:
                    group.append(cards[j])
                    used[j] = True
        groups.append(group)
    return groups


# --- Compositing ---

PAD_PX = 6
PAD_RGB = (0, 0, 0)


def composite_pair_vertical(front: Image.Image, back: Image.Image | None) -> Image.Image:
    """Front on top, back below, both scaled to a common width."""
    target_w = front.width
    images = [front]
    if back is not None:
        if back.width != target_w:
            scale = target_w / back.width
            back = back.resize((target_w, int(back.height * scale)), Image.LANCZOS)
        images.append(back)
    total_h = sum(i.height for i in images) + PAD_PX * (len(images) - 1)
    canvas = Image.new("RGB", (target_w, total_h), PAD_RGB)
    y = 0
    for img in images:
        canvas.paste(img, (0, y))
        y += img.height + PAD_PX
    return canvas


def composite_group(group: list[RawCard]) -> tuple[Image.Image, int | None, str]:
    """Composite a group as picture-on-top / stats-on-bottom and return the
    composite plus the best-known cost (from the FRONT) and canonical title."""
    if not group:
        raise ValueError("empty group")
    # Pick FRONT: the card with the highest saturation in the top-right (or
    # the one whose OCR'd cost is present and large). Cost-bearing image wins.
    def front_score(c: RawCard) -> tuple[int, float, int]:
        # has_cost preferred, then saturation, then number value
        return (1 if c.points is not None else 0, c.sat, c.points or 0)
    ordered = sorted(group, key=front_score, reverse=True)
    front = ordered[0]
    back = ordered[1] if len(ordered) > 1 else None
    # If there are more than 2 sides (rare; usually misgrouping), keep just
    # front + the next-best back (lowest saturation, i.e. text-heavy).
    if back is None or len(ordered) == 2:
        chosen_back = back
    else:
        chosen_back = sorted(ordered[1:], key=lambda c: c.sat)[0]
    composite = composite_pair_vertical(front.pil, chosen_back.pil if chosen_back else None)
    # Cost: use front's OCR'd cost; if absent, try the next image's.
    cost = front.points
    if cost is None and chosen_back is not None:
        cost = chosen_back.points
    # Title: pick the title with the most letters from the group.
    title = sorted(group, key=lambda c: sum(ch.isalpha() for ch in c.title), reverse=True)[0].title
    return composite, cost, title


# --- Pipeline ---

def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.strip().lower())
    return re.sub(r"-+", "-", s).strip("-") or "card"


@dataclass
class ManifestEntry:
    faction: str
    kind: str
    title: str
    slug: str
    file: str
    source: str
    points: int | None


def main() -> int:
    if OUT_CARDS.exists():
        shutil.rmtree(OUT_CARDS)
    OUT_CARDS.mkdir(parents=True, exist_ok=True)
    manifest: list[ManifestEntry] = []
    for pdf_name, faction, kind in SOURCES:
        pdf = LEGION / pdf_name
        if not pdf.exists():
            print(f"  skip (missing): {pdf_name}")
            continue
        print(f"+ {pdf_name} -> {faction}/{kind}")
        cards = extract_pdf(pdf)
        groups = group_cards(cards)
        out_dir = OUT_CARDS / faction / kind
        out_dir.mkdir(parents=True, exist_ok=True)
        slug_counts: dict[str, int] = {}
        for group in groups:
            composite, cost, title = composite_group(group)
            # Cap long side to 1600 px so the repo stays small.
            if max(composite.size) > 1600:
                scale = 1600 / max(composite.size)
                composite = composite.resize(
                    (int(composite.size[0] * scale), int(composite.size[1] * scale)),
                    Image.LANCZOS,
                )
            slug = slugify(title) if title else f"{faction}-{kind}-{group[0].sha1[:8]}"
            slug_counts[slug] = slug_counts.get(slug, 0) + 1
            if slug_counts[slug] > 1:
                slug = f"{slug}-{slug_counts[slug]}"
            fname = f"{slug}.jpg"
            composite.save(out_dir / fname, "JPEG", quality=82, optimize=True)
            manifest.append(
                ManifestEntry(
                    faction=faction,
                    kind=kind,
                    title=title,
                    slug=slug,
                    file=f"cards/{faction}/{kind}/{fname}",
                    source=pdf_name,
                    points=cost,
                )
            )
    MANIFEST.write_text(json.dumps([asdict(e) for e in manifest], indent=2))
    print(f"\nWrote {len(manifest)} cards.")
    by_kind: dict[tuple[str, str], int] = {}
    with_pts = 0
    for e in manifest:
        by_kind[(e.faction, e.kind)] = by_kind.get((e.faction, e.kind), 0) + 1
        if e.points is not None:
            with_pts += 1
    print(f"With OCR'd points: {with_pts}/{len(manifest)}")
    for (f, k), n in sorted(by_kind.items()):
        print(f"  {f:12s} {k:8s} {n:4d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
