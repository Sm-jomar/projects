"""Parse Legion points.csv into a JSON points-adjustment table.

Each section has its own header row that may or may not include a
"Category" column and may or may not include the 1.5.1 column. We read
the header row of each section to figure out which column holds the
printed cost and which holds the 2.6 cost.

Emits:
  {
    "units": { "Darth Vader": {"printed": 200, "v2_6": 190, "faction": "imperials"}, ... },
    "upgrades": { "<faction>:<card>": {"printed": ..., "v2_6": ..., "faction": ...}, ... }
  }

Upgrade keys are namespaced by faction since an upgrade name can repeat
across factions (e.g. multiple factions have a "Black Sun Vigo" personnel
upgrade with different costs).
"""
from __future__ import annotations
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Legion" / "Legion points.csv"
OUT = ROOT / "src" / "data" / "points-adjustments.json"

UNIT_SECTIONS = {
    "Imperial Units": "imperials",
    "Rebel Units": "rebels",
    "Galactic Republic Units": "republic",
    "Separatist Alliance Units": "separatists",
    "Mercenaries Units": "mercenary",
}
UPGRADE_SECTIONS = {
    "Neutral Upgrades": "generic",
    "Imperial Upgrades": "imperials",
    "Rebel Upgrades": "rebels",
    "Galactic Republic Upgrades": "republic",
    "Separatist Alliance Upgrades": "separatists",
    "Mercenaries Upgrades": "mercenary",
}


def to_int(s: str) -> int | None:
    s = s.strip()
    if s in ("", "-", "—"):
        return None
    try:
        return int(s)
    except ValueError:
        return None


def main() -> int:
    units: dict[str, dict] = {}
    upgrades: dict[str, dict] = {}
    section: str | None = None
    section_kind: str | None = None
    headers: list[str] = []
    name_col: int | None = None
    printed_col: int | None = None
    v26_col: int | None = None

    def reset_section(name: str, kind: str) -> None:
        nonlocal section, section_kind, headers, name_col, printed_col, v26_col
        section = name
        section_kind = kind
        headers = []
        name_col = printed_col = v26_col = None

    def consume_header(row: list[str]) -> None:
        nonlocal headers, name_col, printed_col, v26_col
        headers = [c.strip() for c in row]
        for i, h in enumerate(headers):
            if h == "Card":
                name_col = i
            elif h in ("Printed Point Cost", "Printed"):
                printed_col = i
            elif h == "2.6":
                v26_col = i

    with SRC.open(encoding="utf-8-sig", newline="") as f:
        for raw in csv.reader(f):
            row = list(raw)
            while row and row[-1].strip() == "":
                row.pop()
            if not row:
                continue
            first = row[0].strip()

            if first in UNIT_SECTIONS:
                reset_section(first, "unit")
                continue
            if first in UPGRADE_SECTIONS:
                reset_section(first, "upgrade")
                continue

            if first in ("Card", "Category"):
                consume_header(row)
                continue

            if section_kind is None:
                continue
            if name_col is None or printed_col is None:
                # No header consumed yet (e.g. preamble before first section).
                continue

            if len(row) <= max(printed_col, name_col):
                continue
            card = row[name_col].strip()
            if not card:
                continue
            printed = to_int(row[printed_col])
            if printed is None:
                continue
            v26 = to_int(row[v26_col]) if v26_col is not None and v26_col < len(row) else None
            faction = (
                UNIT_SECTIONS[section]
                if section_kind == "unit"
                else UPGRADE_SECTIONS[section]
            )
            entry = {"printed": printed, "faction": faction}
            if v26 is not None:
                entry["v2_6"] = v26
            if section_kind == "unit":
                units[card] = entry
            else:
                upgrades[f"{faction}:{card}"] = entry | {"card": card}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"units": units, "upgrades": upgrades}, indent=2, sort_keys=True)
    )
    print(f"Wrote {len(units)} units and {len(upgrades)} upgrades to {OUT.relative_to(ROOT)}")
    adj_units = sum(
        1 for v in units.values()
        if "v2_6" in v and v["v2_6"] != v["printed"]
    )
    adj_upgrades = sum(
        1 for v in upgrades.values()
        if "v2_6" in v and v["v2_6"] != v["printed"]
    )
    print(f"  units with a 2.6 adjustment: {adj_units}")
    print(f"  upgrades with a 2.6 adjustment: {adj_upgrades}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
