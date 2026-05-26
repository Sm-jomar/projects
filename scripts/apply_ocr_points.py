"""Apply OCR'd point costs from card-manifest.json to catalog.base.json.

Only updates units where:
  - The fuzzy-matched manifest entry has a point cost
  - The OCR'd cost is in a plausible range (25..275) for a unit card
  - The cost differs from the catalog's current value by 5+

Prints a diff of every change. catalog.seed.ts is handled separately by
gen_mercenary_seed.py (which derives mercenary entries from scratch).
"""
from __future__ import annotations
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "src" / "data" / "catalog.base.json"
MANIFEST = ROOT / "src" / "data" / "card-manifest.json"

MIN_PTS = 25
MAX_PTS = 275
MIN_DIFF = 5  # don't bother reporting tiny corrections


def _norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    cat = json.loads(CATALOG.read_text())
    cards = json.loads(MANIFEST.read_text())
    # Index manifest by (faction, kind="unit", normalized title).
    by_norm: dict[tuple[str, str], list[dict]] = {}
    for c in cards:
        if c["kind"] != "unit":
            continue
        key = (c["faction"], _norm(c["title"]))
        by_norm.setdefault(key, []).append(c)

    def find_card(unit: dict) -> dict | None:
        target = _norm(unit["name"])
        target_tokens = set(target.split())
        same_faction = [
            c for c in cards
            if c["kind"] == "unit" and c["faction"] == unit["faction"]
        ]
        # Exact normalized hit wins.
        for c in same_faction:
            if _norm(c["title"]) == target:
                return c
        # Fuzzy match with a high bar AND token containment: every
        # distinctive token in the catalog name should appear in the OCR'd
        # title. This prevents "Scout Troopers Strike Team" from collapsing
        # onto "Scout Troopers" (where the OCR'd title lacks "Strike Team").
        distinct = {t for t in target_tokens if len(t) >= 4}
        best, score = None, 0.0
        for c in same_faction:
            cand = _norm(c["title"])
            if distinct and not distinct.issubset(set(cand.split())):
                continue
            s = SequenceMatcher(None, target, cand).ratio()
            if s > score:
                best, score = c, s
        return best if score >= 0.85 else None

    changes: list[tuple[str, int, int, str]] = []  # (id, old, new, reason)
    skipped: list[tuple[str, str]] = []
    # Skip variant suffixes that share a name with the parent card (e.g.
    # Scout Troopers vs. Scout Troopers (Strike Team)) — the OCR'd title
    # can't tell them apart.
    VARIANT_SUFFIXES = ("-strike-team", "-elite", "-veteran")
    for u in cat["units"]:
        if any(u["id"].endswith(s) for s in VARIANT_SUFFIXES):
            skipped.append((u["id"], "variant: skip OCR (ambiguous name)"))
            continue
        c = find_card(u)
        if c is None:
            skipped.append((u["id"], "no card match"))
            continue
        new_pts = c.get("points")
        if new_pts is None:
            continue
        if not (MIN_PTS <= new_pts <= MAX_PTS):
            skipped.append((u["id"], f"OCR pts {new_pts} out of range"))
            continue
        old_pts = u["points"]
        if abs(new_pts - old_pts) < MIN_DIFF:
            continue
        changes.append((u["id"], old_pts, new_pts, c["title"]))
        u["points"] = new_pts

    if not changes:
        print("No catalog updates.")
        return 0

    print(f"Applying {len(changes)} point updates:")
    for uid, old, new, why in changes:
        print(f"  {uid:40s} {old:>4} -> {new:<4}  ({why})")
    CATALOG.write_text(json.dumps(cat, indent=2))
    print(f"\nWrote {CATALOG.relative_to(ROOT)}")
    if skipped:
        print(f"\nSkipped ({len(skipped)}):")
        for sid, why in skipped[:10]:
            print(f"  {sid:40s} {why}")
        if len(skipped) > 10:
            print(f"  ... and {len(skipped) - 10} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
