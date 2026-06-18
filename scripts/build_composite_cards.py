"""Build Legion card images from one or more extracted PDF folders.

The pipeline:
  1. Walk each input folder for images.
  2. Bucket each image as "picture" or "stats" using aspect-ratio / size
     filters (configurable).
  3. OCR the title bar of each candidate to get the unit name.
  4. Pair pictures and stats by normalized title.
  5. Optionally stitch the matched pairs into a composite (picture on
     top, stats on bottom).
  6. Write outputs and update src/data/card-manifest.json.

Usage:
    # Stitch picture+stats pairs from one or more extracted folders:
    python3 scripts/build_composite_cards.py \
        --input Legion/blizzard_force Legion/echo_base \
        --mode pair-stitch \
        --out public/cards/composite \
        --manifest-faction generic \
        --manifest-kind composite

    # Import stats-only cards (no picture half available) as a new
    # browseable section:
    python3 scripts/build_composite_cards.py \
        --input Legion/spec-ops_small \
        --mode stats-only \
        --out public/cards/spec-ops \
        --stats-min-ratio 1.3 --stats-max-ratio 1.5 \
        --manifest-faction generic \
        --manifest-kind spec-ops

Requires the same deps as scripts/pdf_to_json.py: Pillow, tesseract CLI.
"""
from __future__ import annotations
import argparse
import io
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Missing dependency: pip install Pillow")


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"


# --- Image classification --------------------------------------------------

@dataclass
class ImageRef:
    """One source image inside an extracted folder."""
    path: Path
    width: int
    height: int
    page: int  # the PDF page it came from
    folder: str  # e.g. "spec-ops_small"

    @property
    def ratio(self) -> float:
        return self.width / self.height if self.height else 0.0


def collect_images(folders: list[Path]) -> list[ImageRef]:
    """Walk each extracted folder, returning every image with metadata."""
    out: list[ImageRef] = []
    for folder in folders:
        img_dir = folder / "images"
        if not img_dir.is_dir():
            print(f"  (skipping {folder}: no images/ subfolder)")
            continue
        for p in sorted(img_dir.iterdir()):
            if not p.is_file() or p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            try:
                with Image.open(p) as im:
                    w, h = im.size
            except Exception as e:
                print(f"  (skipping {p}: {e})")
                continue
            m = re.match(r"p(\d+)_", p.stem)
            page = int(m.group(1)) if m else 0
            out.append(ImageRef(path=p, width=w, height=h, page=page, folder=folder.name))
    return out


def in_range(value: float, lo: float | None, hi: float | None) -> bool:
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


def filter_images(
    images: list[ImageRef],
    *, min_ratio: float | None, max_ratio: float | None,
    min_short_side: int | None, max_short_side: int | None,
) -> list[ImageRef]:
    """Apply the configured size/ratio filter to pick a category."""
    out = []
    for im in images:
        short = min(im.width, im.height)
        if not in_range(im.ratio, min_ratio, max_ratio):
            continue
        if not in_range(short, min_short_side, max_short_side):
            continue
        out.append(im)
    return out


# --- OCR ------------------------------------------------------------------

def ocr_title(image_path: Path, *, top_frac: float = 0.18, left_frac: float = 0.6) -> str:
    """Crop just the title-bar region (top of the card, left portion) and
    OCR it with an uppercase-only whitelist. Returns the raw text.
    Empty string if tesseract is missing or fails.

    The right portion of a Legion card's title bar is icons + dice +
    points cost; we skip it because tesseract turns the iconography
    into garbage like "yy,", "wae", "EE", "3)", which then mangles the
    title. Cropping ~60% from the left gets the name + subtitle alone.
    """
    if not shutil.which("tesseract"):
        return ""
    try:
        with Image.open(image_path) as im:
            w, h = im.size
            # Indent from the left so the faction roundel doesn't OCR as
            # noise either; restrict to the title bar's left half.
            crop = im.crop((int(w * 0.06), 0, int(w * left_frac), int(h * top_frac)))
            # Upsample + grayscale + autocontrast for cleaner OCR.
            crop = crop.resize((crop.size[0] * 3, crop.size[1] * 3), Image.LANCZOS)
            crop = ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=2)
        buf = io.BytesIO()
        crop.save(buf, "PNG")
        # PSM 6 = single uniform block. Whitelist uppercase letters,
        # apostrophe, hyphen, comma, period, space — that's the full
        # alphabet of a Legion title line.
        whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ '-,."
        r = subprocess.run(
            [
                "tesseract", "stdin", "stdout",
                "--psm", "6", "--oem", "1",
                "-c", f"tessedit_char_whitelist={whitelist}",
            ],
            input=buf.getvalue(),
            capture_output=True,
            check=False,
            timeout=20,
        )
        return r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def parse_title_lines(raw: str) -> list[str]:
    """Extract candidate title lines from OCR output. The whitelist-
    restricted OCR already gives us uppercase-only text, so we mainly
    have to strip stray icon-noise tokens off the front and reject
    obvious garbage lines."""
    lines: list[str] = []
    for line in raw.splitlines():
        s = line.strip(" -,.'")
        if not s:
            continue
        # Strip leading short tokens — those are usually misread icons
        # at the start of the title bar ("Y REBEL COMMANDO",
        # "AY ARC TROOPER"). Stop once we hit a real word.
        words = s.split()
        while words and len(words[0].strip(",.'-")) <= 2:
            words.pop(0)
        if not words:
            continue
        s = " ".join(words)
        # Reject if too short — single-word OCR noise like "OOO".
        letters = [c for c in s if c.isalpha()]
        if len(letters) < 4:
            continue
        # Reject if too long — probably wrapped rules text from a
        # mis-cropped card.
        if len(s) > 50:
            continue
        # Reject "fragmented" lines: too many single-letter tokens
        # remaining is OCR garbage.
        single_letter_tokens = sum(1 for w in words if len(w.strip(",.'-")) == 1)
        if len(words) >= 3 and single_letter_tokens >= len(words) // 2:
            continue
        lines.append(s)
    return lines


# Common OCR misreads on Legion title bars. Applied after slugification
# so the lookups always operate on token boundaries. Pure cosmetic;
# nothing in the app keys off the corrected text other than display.
SLUG_CORRECTIONS = {
    # Word-level corrections (require hyphen boundaries to avoid eating
    # legitimate substrings like "drop" or "sport").
    "dr": "droid",
    "wie": "wookiee",
    "ewk": "ewok",
    "hnting": "hunting",
    "bttle": "battle",
    "sper": "super",
    "wker": "worker",
    "seris": "series",
    "sers": "series",
    "scot": "scout",
    "comma": "commando",
    "comman": "commando",
    "magnagr": "magnaguard",
    "isx": "15x",
    "idi": "id",
    "vehi": "vehicle",
    "iarge": "large",
}


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    # Walk tokens left-to-right and substitute any that hit the
    # correction table.
    parts = [SLUG_CORRECTIONS.get(p, p) for p in s.split("-")]
    return "-".join(p for p in parts if p)


def looks_like_garbage_slug(slug: str) -> bool:
    """Reject slugs where most tokens are 1-2 chars (typical of failed
    OCR that turned dice/icons into stray letters like 'tyn-ar-zy-ss').
    """
    parts = slug.split("-")
    if len(parts) < 3:
        return False
    short = sum(1 for p in parts if len(p) <= 2)
    return short / len(parts) > 0.4


def title_to_slug(raw_ocr: str) -> tuple[str, str]:
    """Pick a clean (display_title, slug) pair from OCR output. Returns
    ("", "") if the OCR didn't surface a usable title."""
    lines = parse_title_lines(raw_ocr)
    if not lines:
        return "", ""
    # First line is the unit name. Second (if present, and shorter) is
    # the subtitle which we fold into the slug to disambiguate
    # variants ("REBEL COMMANDO" + "CAPTAIN" → rebel-commando-captain).
    title = lines[0]
    sub = lines[1] if len(lines) > 1 and len(lines[1]) < len(lines[0]) + 8 else ""
    display = title + (f", {sub.title()}" if sub else "")
    slug = slugify(title + ("-" + sub if sub else ""))
    return display, slug


def ocr_card_title(image_path: Path) -> tuple[str, str]:
    """Multi-pass OCR for a single card. Tries the tight title crop
    first (fewer false positives from rules text); falls back to
    progressively larger crops if it produced nothing usable.
    Returns (display_title, slug); ("", "") on total failure."""
    for top_frac, left_frac in [(0.18, 0.6), (0.25, 0.75), (0.32, 0.9)]:
        raw = ocr_title(image_path, top_frac=top_frac, left_frac=left_frac)
        display, slug = title_to_slug(raw)
        if slug and not looks_like_garbage_slug(slug):
            return display, slug
    return "", ""


# --- Matching + stitching ------------------------------------------------

def stitch_vertical(picture: Path, stats: Path, out: Path, *, gap_px: int = 0) -> None:
    """Stack picture on top, stats on bottom into one composite JPEG."""
    with Image.open(picture).convert("RGB") as top:
        with Image.open(stats).convert("RGB") as bot:
            # Match widths: scale the narrower image up to the wider one.
            w = max(top.width, bot.width)
            top_h = round(top.height * (w / top.width))
            bot_h = round(bot.height * (w / bot.width))
            top_r = top.resize((w, top_h), Image.LANCZOS)
            bot_r = bot.resize((w, bot_h), Image.LANCZOS)
            canvas = Image.new("RGB", (w, top_h + gap_px + bot_h), "white")
            canvas.paste(top_r, (0, 0))
            canvas.paste(bot_r, (0, top_h + gap_px))
            canvas.save(out, "JPEG", quality=88, optimize=True)


# --- Manifest update -----------------------------------------------------

def update_manifest(new_entries: list[dict]) -> int:
    """Merge new entries into card-manifest.json, replacing any with the
    same (faction, kind, slug). Returns count of entries added/updated."""
    existing: list[dict] = []
    if MANIFEST.exists():
        existing = json.loads(MANIFEST.read_text("utf-8"))
    by_key: dict[tuple[str, str, str], int] = {}
    for i, e in enumerate(existing):
        by_key[(e["faction"], e["kind"], e["slug"])] = i
    changed = 0
    for e in new_entries:
        key = (e["faction"], e["kind"], e["slug"])
        if key in by_key:
            existing[by_key[key]] = e
        else:
            existing.append(e)
        changed += 1
    # Sort to keep the diff readable.
    existing.sort(key=lambda x: (x["faction"], x["kind"], x["slug"]))
    MANIFEST.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
    return changed


# --- Main pipelines ------------------------------------------------------

@dataclass
class Counts:
    pictures: int = 0
    stats: int = 0
    paired: int = 0
    unmatched_pictures: list[str] = field(default_factory=list)
    unmatched_stats: list[str] = field(default_factory=list)


def run_pair_stitch(args, all_images: list[ImageRef]) -> Counts:
    """Find pictures + stats, OCR titles, pair by normalized title,
    stitch composites."""
    pictures = filter_images(
        all_images,
        min_ratio=args.picture_min_ratio, max_ratio=args.picture_max_ratio,
        min_short_side=args.picture_min_short_side, max_short_side=args.picture_max_short_side,
    )
    stats = filter_images(
        all_images,
        min_ratio=args.stats_min_ratio, max_ratio=args.stats_max_ratio,
        min_short_side=args.stats_min_short_side, max_short_side=args.stats_max_short_side,
    )
    print(f"  candidates: {len(pictures)} picture, {len(stats)} stats")
    counts = Counts(pictures=len(pictures), stats=len(stats))

    pic_by_slug: dict[str, ImageRef] = {}
    for p in pictures:
        _, slug = ocr_card_title(p.path)
        if slug:
            pic_by_slug[slug] = p

    stats_by_slug: dict[str, tuple[ImageRef, str]] = {}
    for s in stats:
        display, slug = ocr_card_title(s.path)
        if slug:
            stats_by_slug[slug] = (s, display)

    args.out.mkdir(parents=True, exist_ok=True)
    new_manifest: list[dict] = []
    for slug, pic in pic_by_slug.items():
        if slug in stats_by_slug:
            stats_img, display = stats_by_slug[slug]
            out_path = args.out / f"{slug}.jpg"
            stitch_vertical(pic.path, stats_img.path, out_path)
            rel = out_path.resolve().relative_to(ROOT / "public").as_posix()
            new_manifest.append({
                "faction": args.manifest_faction,
                "kind": args.manifest_kind,
                "title": display,
                "slug": slug,
                "file": rel,
                "source": pic.folder,
                "points": None,
            })
            counts.paired += 1
            print(f"  paired {slug} ({pic.path.name} + {stats_img.path.name})")
        else:
            counts.unmatched_pictures.append(slug)
    for slug in stats_by_slug:
        if slug not in pic_by_slug:
            counts.unmatched_stats.append(slug)

    if args.write_manifest and new_manifest:
        n = update_manifest(new_manifest)
        print(f"  manifest: +{n} entries")
    return counts


def run_stats_only(args, all_images: list[ImageRef]) -> Counts:
    """Just import stats cards as-is (no picture half available)."""
    stats = filter_images(
        all_images,
        min_ratio=args.stats_min_ratio, max_ratio=args.stats_max_ratio,
        min_short_side=args.stats_min_short_side, max_short_side=args.stats_max_short_side,
    )
    print(f"  candidates: {len(stats)} stats cards")
    counts = Counts(stats=len(stats))

    args.out.mkdir(parents=True, exist_ok=True)
    new_manifest: list[dict] = []
    # Deduplicate by slug — multiple takes of the same card across
    # pages keep the first one we find.
    seen: dict[str, ImageRef] = {}
    titles: dict[str, str] = {}
    for s in stats:
        display, slug = ocr_card_title(s.path)
        if not slug:
            counts.unmatched_stats.append(s.path.name)
            continue
        if slug in seen:
            continue
        seen[slug] = s
        titles[slug] = display

    for slug, src in seen.items():
        out_path = args.out / f"{slug}.jpg"
        # Recompress so we hit a consistent quality/dpi target.
        with Image.open(src.path).convert("RGB") as im:
            im.save(out_path, "JPEG", quality=88, optimize=True)
        rel = out_path.resolve().relative_to(ROOT / "public").as_posix()
        new_manifest.append({
            "faction": args.manifest_faction,
            "kind": args.manifest_kind,
            "title": titles[slug],
            "slug": slug,
            "file": rel,
            "source": src.folder,
            "points": None,
        })
        print(f"  imported {slug} <- {src.path.name}")
    counts.paired = len(seen)

    if args.write_manifest and new_manifest:
        n = update_manifest(new_manifest)
        print(f"  manifest: +{n} entries")
    return counts


# --- CLI ----------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", nargs="+", type=Path, required=True,
                    help="one or more extracted-PDF folders (each containing images/)")
    ap.add_argument("--mode", choices=["pair-stitch", "stats-only"], required=True)
    ap.add_argument("--out", type=Path, required=True,
                    help="output folder (under public/ if you want it served)")
    ap.add_argument("--manifest-faction", default="generic",
                    help="faction field for the card-manifest.json entries")
    ap.add_argument("--manifest-kind", default="composite",
                    help="kind field for the card-manifest.json entries")
    ap.add_argument("--no-manifest", dest="write_manifest", action="store_false",
                    help="skip updating src/data/card-manifest.json (dry-run images)")

    # Picture (art-portrait) filters. Defaults assume a typical Legion
    # printed unit-art card: portrait orientation, ~0.7 aspect ratio.
    ap.add_argument("--picture-min-ratio", type=float, default=0.55)
    ap.add_argument("--picture-max-ratio", type=float, default=0.85)
    ap.add_argument("--picture-min-short-side", type=int, default=400)
    ap.add_argument("--picture-max-short-side", type=int, default=None)

    # Stats card filters. Defaults are tuned for Spec-Ops style landscape
    # stats reference cards (~1.42 ratio). Override for other PDFs.
    ap.add_argument("--stats-min-ratio", type=float, default=0.55)
    ap.add_argument("--stats-max-ratio", type=float, default=1.55)
    ap.add_argument("--stats-min-short-side", type=int, default=400)
    ap.add_argument("--stats-max-short-side", type=int, default=None)

    args = ap.parse_args()

    print("Collecting images...")
    images = collect_images(args.input)
    print(f"  {len(images)} images across {len(args.input)} folder(s)")
    if not images:
        sys.exit("Nothing to process.")

    if args.mode == "pair-stitch":
        counts = run_pair_stitch(args, images)
    else:
        counts = run_stats_only(args, images)

    print()
    print(f"Done. pictures={counts.pictures} stats={counts.stats} produced={counts.paired}")
    if counts.unmatched_pictures:
        print(f"  unmatched pictures: {len(counts.unmatched_pictures)}")
    if counts.unmatched_stats:
        print(f"  unmatched stats:    {len(counts.unmatched_stats)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
