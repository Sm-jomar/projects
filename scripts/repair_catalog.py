"""Repair the catalog after the wiki rebuild:

1. Map every upgrade's `restricted_to_unit` from the old short id (e.g.
   `jyn-erso`) to the new wiki-rebuilt id (e.g. `rebels-jyn-erso`). Drop
   restrictions that point at units removed from play (Royal Guards,
   Pathfinders, etc.).

2. Add default `upgrades` slots to every unit that doesn't already have
   one, based on its rank and type. This restores the "+ Upgrade" button
   on units that lost it after the wiki rebuild.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "src" / "data" / "catalog.base.json"
SEED = ROOT / "src" / "data" / "catalog.seed.ts"


# Default upgrade slots per rank/type. Hand-picked to match typical
# Legion unit slot loadouts.
DEFAULT_SLOTS_TROOPER: dict[str, dict[str, int]] = {
    "commander": {"command": 1, "training": 2, "gear": 1, "comms": 1},
    "operative": {"training": 1, "gear": 1, "comms": 1},
    "corps": {"heavy-weapon": 1, "personnel": 1, "training": 1, "gear": 1, "grenades": 1, "comms": 1},
    "special-forces": {"heavy-weapon": 1, "training": 1, "gear": 1, "grenades": 1, "comms": 1},
    "support": {"heavy-weapon": 1, "personnel": 1, "training": 1, "gear": 1, "comms": 1},
    "heavy": {"heavy-weapon": 1, "training": 1, "gear": 1, "comms": 1},
}
DEFAULT_SLOTS_VEHICLE: dict[str, dict[str, int]] = {
    "support": {"comms": 1, "pilot": 1, "hard-point": 1, "crew": 1},
    "heavy": {"comms": 1, "pilot": 1, "hard-point": 2, "crew": 1, "armament": 1},
    "operative": {"comms": 1, "pilot": 1, "hard-point": 1},
}


def default_slots(rank: str, unit_type: str, *, force_user: bool = False) -> dict[str, int]:
    if unit_type in ("ground-vehicle", "repulsor-vehicle"):
        return dict(DEFAULT_SLOTS_VEHICLE.get(rank, {}))
    slots = dict(DEFAULT_SLOTS_TROOPER.get(rank, {}))
    if force_user:
        # Force users get force slots (varies by character; default to 3
        # for commanders, 2 for operatives) and drop the gear slot to
        # keep the slot count reasonable.
        slots["force"] = 3 if rank == "commander" else 2
    return slots


def collect_catalog_unit_ids() -> dict[str, str]:
    """Return a map from old (short) id -> new (faction-prefixed) id."""
    text = SEED.read_text()
    new_ids = re.findall(r'id:\s*"([^"]+)"', text)
    by_tail: dict[str, str] = {}
    for nid in new_ids:
        parts = nid.split("-", 1)
        if len(parts) == 2:
            tail = parts[1]
            by_tail.setdefault(tail, nid)
        by_tail.setdefault(nid, nid)
    return by_tail


# Old IDs referring to units the wiki marks as removed/discontinued.
REMOVED_UNIT_IDS = {
    "imperial-royal-guards",
    "rebel-pathfinders",
}

# Old IDs whose canonical new id has a sub-title suffix the auto-tail
# lookup misses.
OLD_ID_ALIASES: dict[str, str] = {
    "wookiee-warriors": "rebels-wookiee-warriors-freedom-fighters",
    "darth-vader": "imperials-darth-vader-dark-lord-of-the-sith",
    "luke-skywalker": "rebels-luke-skywalker-hero-of-the-rebellion",
    "obi-wan-kenobi": "republic-obi-wan-kenobi-civilized-warrior",
    "anakin-skywalker": "republic-anakin-skywalker-hero-without-fear",
    "boba-fett": "mercenary-boba-fett-daimyo-of-mos-espa",
    "yoda": "republic-yoda-grand-master-of-the-jedi-order",
    "general-grievous": "separatists-general-grievous-sinister-cyborg",
    "count-dooku": "separatists-count-dooku-darth-tyranus",
    "padme-amidala": "republic-padme-amidala-spirited-senator",
    "asajj-ventress": "separatists-asajj-ventress-sith-assassin",
    "tx-225-gav-w-occupier-combat-assault-tank": "imperials-tx-225-gavw-occupier-tank",
}


def fix_upgrades(by_tail: dict[str, str]) -> None:
    data = json.loads(BASE.read_text())
    upgrades = data.get("upgrades", [])
    fixed = 0
    dropped = 0
    for up in upgrades:
        restrictions = up.get("restricted_to_unit") or []
        if not restrictions:
            continue
        new_restrictions = []
        for r in restrictions:
            old = r.get("id", "")
            if old in REMOVED_UNIT_IDS:
                dropped += 1
                continue
            mapped = OLD_ID_ALIASES.get(old) or by_tail.get(old)
            if mapped:
                if old != mapped:
                    fixed += 1
                new_restrictions.append({"id": mapped})
            else:
                new_restrictions.append(r)
        up["restricted_to_unit"] = new_restrictions
    BASE.write_text(json.dumps(data, indent=2))
    print(f"Upgrades: fixed {fixed} restricted_to_unit ids, dropped {dropped} obsolete.")


def add_default_slots() -> None:
    """Insert a default `upgrades:` line into every unit block that lacks
    one. Operates on the TS file as text to preserve formatting."""
    text = SEED.read_text()
    pattern = re.compile(r"(  \{)(\n(?:    [^\n]*\n)+)(  \},)")
    added = 0

    def handle(m: re.Match) -> str:
        nonlocal added
        open_brace, body, close_brace = m.group(1), m.group(2), m.group(3)
        if "upgrades:" in body:
            return m.group(0)
        m_rank = re.search(r'rank:\s*"([^"]+)"', body)
        m_type = re.search(r'type:\s*"([^"]+)"', body)
        if not m_rank:
            return m.group(0)
        rank = m_rank.group(1)
        unit_type = m_type.group(1) if m_type else "trooper"
        # Detect Force users from force_alignment field; they need a force slot.
        force_user = bool(re.search(r'force_alignment:\s*"(light|dark)"', body))
        slots = default_slots(rank, unit_type, force_user=force_user)
        if not slots:
            return m.group(0)
        parts = []
        for k, v in slots.items():
            key = f'"{k}"' if "-" in k else k
            parts.append(f"{key}: {v}")
        slot_line = f"    upgrades: {{ {', '.join(parts)} }},\n"
        added += 1
        return open_brace + body + slot_line + close_brace

    new_text = pattern.sub(handle, text)
    SEED.write_text(new_text)
    print(f"Seed: added default upgrade slots to {added} units.")


def main() -> int:
    by_tail = collect_catalog_unit_ids()
    fix_upgrades(by_tail)
    add_default_slots()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
