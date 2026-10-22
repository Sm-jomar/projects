"""Build the lookup that maps Tabletop Admiral list exports onto our catalog.

Tabletop Admiral exports a list three ways: a JSON file (its Tabletop
Simulator format, units and upgrades by `tts_name` or `name`), a
listbuilder link (units and upgrades by hex `public_id`), and plain text
(display names, "Name (Title)"). src/lib/ttaList.ts parses all three and
needs every TTA printing's ids and names mapped to our unit/upgrade ids.

Reads the snapshot in Legion/tabletop-admiral/ and the layer written by
import_tabletop_admiral.py (src/data/tabletop-admiral.json, which carries
our id -> tta_id), and writes src/data/tta-list-lookup.json. Re-run after
import_tabletop_admiral.py:
  python3 scripts/build_tta_list_lookup.py
"""
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / "Legion" / "tabletop-admiral"
LAYER = ROOT / "src" / "data" / "tabletop-admiral.json"
OUT = ROOT / "src" / "data" / "tta-list-lookup.json"


def norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main() -> None:
    layer = json.loads(LAYER.read_text())
    units = json.loads((SNAP / "units.json").read_text())
    upgrades = json.loads((SNAP / "upgrades.json").read_text())
    type_name = {int(t["id"]): t["name"] for t in json.loads((SNAP / "upgrade-types.json").read_text())}

    # ---- units -----------------------------------------------------------
    tta_to_ours: dict[str, str] = {}
    for oid, p in layer["units"].items():
        tta_to_ours[p["tta_id"]] = oid
    for u in layer["new_units"]:
        tta_to_ours[u["tta_id"]] = u["id"]
    by_id = {t["id"]: t for t in units}
    # Other printings (classic/Revamp twins, hidden duplicates) of a unit we
    # carry share its name and title.
    key_to_ours: dict[tuple[str, str], str] = {}
    for tid, oid in tta_to_ours.items():
        t = by_id[tid]
        key_to_ours.setdefault((norm(t["name"]), norm(t.get("title"))), oid)
    for t in units:
        k = (norm(t["name"]), norm(t.get("title")))
        if t["id"] not in tta_to_ours and k in key_to_ours:
            tta_to_ours[t["id"]] = key_to_ours[k]

    unit_ids: dict[str, str] = {}
    unit_names: dict[str, set[str]] = collections.defaultdict(set)
    unmatched_units = []
    for t in units:
        oid = tta_to_ours.get(t["id"])
        if not oid:
            unmatched_units.append(" ".join(x for x in [t["name"], t.get("title")] if x))
            continue
        unit_ids[format(t["public_id"], "x")] = oid
        names = {t["name"] + " " + (t.get("title") or ""), t.get("tts_name") or ""}
        if t.get("title"):
            names.add(f"{t['name']} ({t['title']})")
        # TTA shows "Name" alone when the title isn't part of the name, so
        # "Arc Troopers" is the untitled unit, not Arc Troopers Strike Team.
        if not t.get("title") or not t.get("include_title"):
            names.add(t["name"])
        for n in names:
            if norm(n):
                unit_names[norm(n)].add(oid)

    # ---- upgrades --------------------------------------------------------
    up_to_ours: dict[str, str] = {}
    for oid, p in layer["upgrades"].items():
        up_to_ours[p["tta_id"]] = oid
    for u in layer["new_upgrades"]:
        up_to_ours[u["tta_id"]] = u["id"]
    ubid = {t["id"]: t for t in upgrades}
    ukey = lambda t: (norm(t["name"]), t["upgrade_type_fkey"])
    key_to_up: dict = {}
    for tid, oid in up_to_ours.items():
        key_to_up.setdefault(ukey(ubid[tid]), oid)
    for t in upgrades:
        if t["id"] not in up_to_ours and ukey(t) in key_to_up:
            up_to_ours[t["id"]] = key_to_up[ukey(t)]

    upgrade_ids: dict[str, str] = {}
    upgrade_names: dict[str, set[str]] = collections.defaultdict(set)
    unmatched_upgrades = set()
    for t in upgrades:
        oid = up_to_ours.get(t["id"])
        if not oid:
            unmatched_upgrades.add(f"{t['name']} ({type_name.get(t['upgrade_type_fkey'], '?')})")
            continue
        upgrade_ids[format(t["public_id"], "x")] = oid
        for n in {t["name"], t.get("tts_name") or ""}:
            if norm(n):
                upgrade_names[norm(n)].add(oid)

    out = {
        "generated_by": "scripts/build_tta_list_lookup.py",
        # Hex public_id (as in listbuilder links) -> our id.
        "unit_ids": dict(sorted(unit_ids.items(), key=lambda kv: int(kv[0], 16))),
        "upgrade_ids": dict(sorted(upgrade_ids.items(), key=lambda kv: int(kv[0], 16))),
        # Normalised name -> our ids (more than one when factions share a name).
        "unit_names": {k: sorted(v) for k, v in sorted(unit_names.items())},
        "upgrade_names": {k: sorted(v) for k, v in sorted(upgrade_names.items())},
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"units {len(unit_ids)}/{len(units)}, upgrades {len(upgrade_ids)}/{len(upgrades)}")
    print("TTA units we don't carry:", sorted(set(unmatched_units)))
    print("TTA upgrades we don't carry:", sorted(unmatched_upgrades))


if __name__ == "__main__":
    main()
