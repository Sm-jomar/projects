"""Combine card front + back images into single composites.

Walks public/cards/<faction>/<kind>/ and groups files whose normalized
slugs match (after stripping the -N duplicate suffix and applying a
fuzzy comparison on the manifest title). Groups with 2+ images are
composited side-by-side (landscape) or stacked (portrait), replacing
the originals. Singletons are left alone. Rewrites the manifest.
"""
from __future__ import annotations
import json
import re
import shutil
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "public" / "cards"
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"

# Pad between sides in the composite (px on the long side)
PAD_PX = 6
PAD_RGB = (0, 0, 0)


@dataclass
class CardEntry:
    faction: str
    kind: str
    title: str
    slug: str
    file: str
    source: str
    sha1: str


def _norm(title: str) -> str:
    """Aggressive normalization for fuzzy matching."""
    t = title.lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _slug_base(slug: str) -> str:
    # Strip trailing -N appended by the extractor for duplicates
    return re.sub(r"-\d+$", "", slug)


def _similar(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _group_by_similarity(entries: list[CardEntry], threshold: float = 0.78) -> list[list[CardEntry]]:
    """Group entries whose titles (or slug bases) are similar enough to be the same card."""
    groups: list[list[CardEntry]] = []
    used = [False] * len(entries)
    # Pre-compute norms once.
    norms = [_norm(e.title) for e in entries]
    bases = [_slug_base(e.slug) for e in entries]
    for i, e in enumerate(entries):
        if used[i]:
            continue
        group = [e]
        used[i] = True
        for j in range(i + 1, len(entries)):
            if used[j]:
                continue
            same_base = bases[i] == bases[j]
            sim = _similar(norms[i], norms[j])
            if same_base or sim >= threshold:
                group.append(entries[j])
                used[j] = True
        groups.append(group)
    return groups


def _composite(group: list[CardEntry]) -> Image.Image:
    """Composite all images in the group. Landscape -> horizontal; portrait -> vertical."""
    images = [Image.open(ROOT / "public" / e.file).convert("RGB") for e in group]
    # All images in a group should share orientation, but if not, normalize to first.
    first = images[0]
    landscape = first.width >= first.height
    # Match the first image's "short side" so they line up.
    if landscape:
        target_h = first.height
        resized = []
        for img in images:
            if img.height != target_h:
                scale = target_h / img.height
                img = img.resize(
                    (int(img.width * scale), target_h), Image.LANCZOS
                )
            resized.append(img)
        total_w = sum(i.width for i in resized) + PAD_PX * (len(resized) - 1)
        canvas = Image.new("RGB", (total_w, target_h), PAD_RGB)
        x = 0
        for img in resized:
            canvas.paste(img, (x, 0))
            x += img.width + PAD_PX
        return canvas
    else:
        target_w = first.width
        resized = []
        for img in images:
            if img.width != target_w:
                scale = target_w / img.width
                img = img.resize(
                    (target_w, int(img.height * scale)), Image.LANCZOS
                )
            resized.append(img)
        total_h = sum(i.height for i in resized) + PAD_PX * (len(resized) - 1)
        canvas = Image.new("RGB", (target_w, total_h), PAD_RGB)
        y = 0
        for img in resized:
            canvas.paste(img, (0, y))
            y += img.height + PAD_PX
        return canvas


def _pick_canonical_slug(group: list[CardEntry]) -> str:
    """Pick the slug from the entry whose base slug is shortest and contains the most letters."""
    def score(e: CardEntry) -> tuple[int, int, int]:
        base = _slug_base(e.slug)
        letters = sum(c.isalpha() for c in base)
        return (-letters, len(base), 0)
    return _slug_base(sorted(group, key=score)[0].slug)


def _pick_canonical_title(group: list[CardEntry]) -> str:
    """Title is the longest-letter entry."""
    return sorted(group, key=lambda e: sum(c.isalpha() for c in e.title), reverse=True)[0].title


def main() -> int:
    manifest = [
        CardEntry(**d) for d in json.loads(MANIFEST.read_text())
    ]
    by_bucket: dict[tuple[str, str], list[CardEntry]] = {}
    for e in manifest:
        by_bucket.setdefault((e.faction, e.kind), []).append(e)

    new_entries: list[CardEntry] = []
    used_slugs: dict[tuple[str, str], set[str]] = {}
    combined = 0
    singletons = 0
    for (faction, kind), entries in sorted(by_bucket.items()):
        groups = _group_by_similarity(entries)
        slugs_here: set[str] = set()
        used_slugs[(faction, kind)] = slugs_here
        for group in groups:
            slug = _pick_canonical_slug(group)
            # Ensure unique slug in this bucket
            base = slug
            n = 1
            while slug in slugs_here:
                n += 1
                slug = f"{base}-{n}"
            slugs_here.add(slug)
            title = _pick_canonical_title(group)
            out_rel = f"cards/{faction}/{kind}/{slug}.jpg"
            out_path = ROOT / "public" / out_rel
            if len(group) == 1:
                singletons += 1
                # Just rename if needed.
                if group[0].file != out_rel:
                    src = ROOT / "public" / group[0].file
                    src.rename(out_path)
            else:
                combined += 1
                composite = _composite(group)
                # Cap the long side at 1600 px to keep the file reasonable.
                if max(composite.size) > 1600:
                    scale = 1600 / max(composite.size)
                    composite = composite.resize(
                        (int(composite.size[0] * scale), int(composite.size[1] * scale)),
                        Image.LANCZOS,
                    )
                composite.save(out_path, "JPEG", quality=84, optimize=True)
                # Delete the originals that got merged (except if a source happens
                # to share the destination path).
                for e in group:
                    if e.file != out_rel:
                        try:
                            (ROOT / "public" / e.file).unlink()
                        except FileNotFoundError:
                            pass
            new_entries.append(
                CardEntry(
                    faction=faction,
                    kind=kind,
                    title=title,
                    slug=slug,
                    file=out_rel,
                    source=group[0].source,
                    sha1=group[0].sha1,
                )
            )
    MANIFEST.write_text(json.dumps([asdict(e) for e in new_entries], indent=2))
    print(f"Combined: {combined} groups (2+ sides)  Singletons: {singletons}")
    print(f"Manifest rewritten with {len(new_entries)} cards.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
