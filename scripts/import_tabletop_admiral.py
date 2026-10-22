"""Import Legion units, upgrades, points and slots from Tabletop Admiral.

Tabletop Admiral (https://tabletopadmiral.com) serves its Legion list
builder data as public JSON. This script snapshots it into
Legion/tabletop-admiral/ (trimmed to the fields we use), matches it
against our catalog, and writes src/data/tabletop-admiral.json, the layer
merged by src/data/catalog.ts.

Usage:
  python3 scripts/import_tabletop_admiral.py --ours /tmp/ours.json --fetch  # refresh snapshot
  python3 scripts/import_tabletop_admiral.py --ours /tmp/ours.json          # rebuild from snapshot

Our catalog before this layer (seed units + base upgrades) is read from a
JSON dump, passed as --ours:
  npx esbuild scripts/dump_catalog.ts --bundle --platform=node | node > /tmp/ours.json
See docs/data-corrections.md.

Points: TTA's `original_cost` is the printed card cost, `current_cost` the
classic tournament cost (our "2.6" mode), `revamp_cost` its Revamp mode
cost. In Revamp mode TTA falls back revamp -> current -> original, and in
classic mode current -> original; we mirror that.
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / "Legion" / "tabletop-admiral"
OUT = ROOT / "src" / "data" / "tabletop-admiral.json"
API = "https://tabletopadmiral.com/api"

FACTION = {1: "rebels", 2: "imperials", 3: "neutral", 4: "republic", 5: "separatists", 6: "mercenary"}
RANK = {1: "commander", 2: "corps", 3: "special-forces", 4: "support", 5: "heavy", 6: "operative"}
UNIT_TYPE = {
    1: ("trooper", "trooper"),
    2: ("repulsor-vehicle", "repulsor-vehicle"),
    3: ("ground-vehicle", "ground-vehicle"),
    4: ("emplacement-trooper", "emplacement-trooper"),
    5: ("trooper", "clone-trooper"),
    6: ("trooper", "droid-trooper"),
    7: ("trooper", "creature-trooper"),
    8: ("trooper", "wookiee-trooper"),
    9: ("trooper", "mandalorian-trooper"),
}
SLOT_RENAME = {"Hardpoint": "hard-point"}

UNIT_FIELDS = [
    "id", "name", "title", "faction_fkey", "rank_fkey", "unit_type_fkey", "is_unique",
    "original_cost", "current_cost", "revamp_cost", "health", "courage", "speed", "figures",
    "red_defense", "surge_hit", "surge_crit", "surge_defense", "classic", "revamp", "hidden",
    "has_new_image", "image_url", "upgrade_types", "public_id", "tts_name", "include_title",
]
SLOT_FIELDS = ["upgrade_type_fkey", "classic", "revamp", "unlocked_by", "battle_force_fkey"]
UPGRADE_FIELDS = [
    "id", "name", "upgrade_type_fkey", "faction_fkey", "is_unique", "original_cost", "current_cost",
    "revamp_cost", "classic", "revamp", "hide", "image_url", "rank_fkey", "rank_fkey2", "alignment",
    "public_id", "tts_name",
] + [f"unit_fkey{s}" for s in ["", "2", "3", "4", "5"]] + [
    f"unit_type_fkey{s}" for s in ["", "2", "3", "4", "5", "6", "7"]
]

# Units removed from play that the seed leaves out on purpose.
EXCLUDED = {"emperorpalpatine", "imperialroyalguards", "phaseiclonetroopers", "phaseiiclonetroopers", "rebelpathfinders"}
# Name spellings that differ between our catalog and TTA.
ALIAS = {
    "c3po": "c3p0",
    "padmamidala": "padmeamidala",
    "tx130saberclassfightertank": "saberclasstank",
    "ig100magnaguards": "ig100magnaguard",
    "nrn99persuaderclasstankdroid": "persuaderclasstankdroid",
}
# Corrections to TTA fields for units we add, checked against card scans.
NEW_UNIT_FIXES = {
    "separatists-maul-impatient-apprentice": {"defense": "red", "force_alignment": "dark"},
    "republic-obi-wan-kenobi-mounted-jedi-general": {"force_alignment": "light"},
    "republic-shaak-ti-jedi-council": {"force_alignment": "light"},
}
# Our unit id -> TTA id, where the name/title/faction rules below pick the
# wrong printing (TTA keeps classic and Revamp printings side by side).
MANUAL = {
    "rebels-han-solo": "15",
    "rebels-rebel-officer": "22",
    "rebels-cassian-andor": "29930",
    "rebels-jyn-erso": "29928",
    "rebels-k-2so": "68",
    "rebels-sabine-wren": "33",
    "rebels-chewbacca": "25",
    "rebels-rebel-agent": "31670",
    "rebels-din-djarin-the-mandalorian": "6179",
    "rebels-the-bad-batch": "25086",
    "imperials-imperial-officer": "23",
    "imperials-agent-kallus": "29931",
    "imperials-imperial-agent": "31667",
    "imperials-bossk-trandoshan-terror": "4999",
    "imperials-boba-fett-infamous-bounty-hunter": "5000",
    "republic-chewbacca-republic": "1565",
    "republic-ahsoka-tano-padawan-commander": "29671",
    "republic-anakin-skywalker-hero-without-fear": "73",
    "republic-obi-wan-kenobi-civilized-warrior": "41",
    "republic-jedi-knight": "31843",
    "republic-jedi-knight-general": "31842",
    "republic-clone-commandos-delta-squad": "24084",
    "separatists-general-grievous-sinister-cyborg": "45",
    "separatists-super-tactical-command-droid": "31844",
    "separatists-super-tactical-command-droid-operative": "31845",
    "separatists-geonosian-warriors": "19103",
    "mercenary-cad-bane-needs-no-introduction": "5001",
    "mercenary-hondo-ohnaka": "29681",
}


def norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower().replace("é", "e"))).strip("-")


def get(path: str):
    req = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": "legion-builder-import"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch() -> None:
    SNAP.mkdir(parents=True, exist_ok=True)
    types = get("upgrade-types")
    units = []
    for u in get("units"):
        detail = get(f"unit/{u['id']}")
        time.sleep(0.2)
        d = {k: detail.get(k) for k in UNIT_FIELDS}
        d["upgrade_types"] = [{k: s.get(k) for k in SLOT_FIELDS} for s in detail.get("upgrade_types") or []]
        units.append(d)
    upgrades = [{k: u.get(k) for k in UPGRADE_FIELDS} for u in get("upgrades")]
    for name, data in [("upgrade-types", types), ("units", units), ("upgrades", upgrades)]:
        (SNAP / f"{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")


def classic_cost(t) -> int:
    return t["current_cost"] if t["current_cost"] is not None else t["original_cost"]


def revamp_cost(t) -> int:
    return t["revamp_cost"] if t["revamp_cost"] is not None else classic_cost(t)


def build(ours_path: Path) -> None:
    ours = json.loads(ours_path.read_text())
    tta = json.loads((SNAP / "units.json").read_text())
    tupg = [u for u in json.loads((SNAP / "upgrades.json").read_text()) if u.get("hide") is not True]
    type_name = {int(t["id"]): t["name"] for t in json.loads((SNAP / "upgrade-types.json").read_text())}
    by_id = {t["id"]: t for t in tta}

    def slot_key(fkey) -> str:
        name = type_name.get(fkey, str(fkey))
        return SLOT_RENAME.get(name, slug(name))

    upgrade_slots = {slot_key(u["upgrade_type_fkey"]) for u in tupg}

    # ---- units: match ours -> TTA ------------------------------------------
    idx = collections.defaultdict(list)
    for t in tta:
        if t.get("hidden") is not True:
            idx[norm(t["name"])].append(t)

    def pick(u):
        if u["id"] in MANUAL:
            return by_id[MANUAL[u["id"]]]
        k = norm(u["name"])
        c = idx.get(ALIAS.get(k, k), [])
        if len(c) > 1:
            st = norm(u.get("sub_title"))
            c = [t for t in c if norm(t.get("title")) == st] or [t for t in c if not t.get("title")] or c
        if len(c) > 1:
            c = [t for t in c if FACTION.get(t["faction_fkey"]) == u["faction"]] or c
        if len(c) > 1:
            c = [t for t in c if t["classic"]] or c
        return c[0] if c else None

    def slots(t) -> dict[str, int]:
        era = "classic" if t["classic"] else "revamp"
        out: dict[str, int] = collections.Counter()
        for s in t.get("upgrade_types") or []:
            if s.get("unlocked_by") or s.get("battle_force_fkey") or not s.get(era):
                continue
            key = slot_key(s["upgrade_type_fkey"])
            if key in upgrade_slots:
                out[key] += 1
        return dict(sorted(out.items()))

    def unit_patch(t) -> dict:
        utype, subtype = UNIT_TYPE.get(t["unit_type_fkey"], ("trooper", "trooper"))
        p = {
            "tta_id": t["id"],
            "points": t["original_cost"],
            "points_v2_6": classic_cost(t),
            "points_revamp": revamp_cost(t),
            "rank": RANK[t["rank_fkey"]],
            "type": utype,
            "unit_subtype": subtype,
            "is_unique": bool(t["is_unique"]),
        }
        # A few TTA entries carry no slots at all; keep ours for those.
        if slots(t):
            p["upgrades"] = slots(t)
        if t.get("health"):
            p["wounds"] = t["health"]
        if t.get("courage") is not None:
            p["courage"] = t["courage"]
        if t.get("speed"):
            p["speed"] = t["speed"]
        if t.get("figures"):
            p["miniatures"] = t["figures"]
        return p

    our_to_tta: dict[str, str] = {}
    unit_layer: dict[str, dict] = {}
    for u in ours["units"]:
        t = pick(u)
        if t:
            our_to_tta[u["id"]] = t["id"]
            unit_layer[u["id"]] = unit_patch(t)

    # New units: classic printings we don't carry yet, skipping removed
    # units and other-faction/Revamp reprints of units we already have.
    have = {(norm(by_id[i]["name"]), norm(by_id[i].get("title"))) for i in our_to_tta.values()}
    new_units = []
    for t in tta:
        key = (norm(t["name"]), norm(t.get("title")))
        if t.get("hidden") is True or not t["classic"] or t["id"] in our_to_tta.values():
            continue
        if key in have or key[0] in EXCLUDED:
            continue
        have.add(key)
        fac = FACTION[t["faction_fkey"]]
        uid = "-".join(x for x in [fac, slug(t["name"]), slug(t.get("title") or "")] if x)
        nu = {
            "id": uid,
            "name": t["name"],
            **({"sub_title": t["title"]} if t.get("title") else {}),
            "faction": fac,
            "miniatures": 1,
            "wounds": 1,
            "defense": "red" if t.get("red_defense") else "white",
            "has_defense_surge": bool(t.get("surge_defense")),
            **({"attack_surge": "crit" if t.get("surge_crit") else "hit"} if t.get("surge_crit") or t.get("surge_hit") else {}),
            **unit_patch(t),
        }
        nu.update(NEW_UNIT_FIXES.get(uid, {}))
        new_units.append(nu)
        our_to_tta[uid] = t["id"]

    # TTA id -> our id, including hidden/other-faction duplicates of a unit
    # we carry (TTA restricts some upgrades to every printing separately).
    tta_to_ours: dict[str, str] = {}
    key_to_ours = {}
    for oid, tid in our_to_tta.items():
        tta_to_ours[tid] = oid
        key_to_ours.setdefault((norm(by_id[tid]["name"]), norm(by_id[tid].get("title"))), oid)
    for t in tta:
        k = (norm(t["name"]), norm(t.get("title")))
        if t["id"] not in tta_to_ours and k in key_to_ours:
            tta_to_ours[t["id"]] = key_to_ours[k]

    # ---- upgrades --------------------------------------------------------
    def restrictions(t) -> dict:
        r = {}
        units = [t.get(f"unit_fkey{s}") for s in ["", "2", "3", "4", "5"]]
        units = [str(x) for x in units if x]
        if units:
            mapped = sorted({tta_to_ours[x] for x in units if x in tta_to_ours})
            r["restricted_to_unit"] = [{"id": x} for x in mapped]
            r["_unit_restricted"] = True
        ranks = [RANK[x] for x in (t.get("rank_fkey"), t.get("rank_fkey2")) if x in RANK]
        if ranks:
            r["restricted_to_rank"] = ranks
        types = [t.get(f"unit_type_fkey{s}") for s in ["", "2", "3", "4", "5", "6", "7"]]
        types = sorted({UNIT_TYPE[x][1] for x in types if x in UNIT_TYPE})
        if types:
            r["restricted_to_unit_type"] = types
        if t.get("alignment") in ("Light", "Dark"):
            r["force_alignment"] = t["alignment"].lower()
        if t.get("faction_fkey") in FACTION and FACTION[t["faction_fkey"]] != "neutral":
            r["faction"] = FACTION[t["faction_fkey"]]
        return r

    # Collapse classic/Revamp twins (same name + slot) into one entry.
    groups = collections.defaultdict(list)
    for t in tupg:
        groups[(norm(t["name"]), slot_key(t["upgrade_type_fkey"]))].append(t)
    merged = []
    for (_, _), ts in groups.items():
        cl = next((t for t in ts if t["classic"]), None)
        rv = next((t for t in ts if t["revamp"] and not t["classic"]), None)
        base = cl or ts[0]
        merged.append((base, rv))

    our_upg = {norm(u["name"]): u for u in ours["upgrades"]}
    used_ids = {u["id"] for u in ours["upgrades"]}
    upgrade_layer: dict[str, dict] = {}
    new_upgrades = []
    matched_names = set()
    for base, rv in sorted(merged, key=lambda p: (p[0]["name"], p[0]["id"])):
        r = restrictions(base)
        unit_restricted = r.pop("_unit_restricted", False)
        if unit_restricted and not r["restricted_to_unit"]:
            continue  # only fits units we don't carry
        pts = {
            "tta_id": base["id"],
            "points": base["original_cost"],
            "points_v2_6": classic_cost(base),
            "points_revamp": revamp_cost(rv or base),
            "is_unique": bool(base["is_unique"]),
        }
        mine = our_upg.get(norm(base["name"]))
        if mine and mine["type"] == slot_key(base["upgrade_type_fkey"]) and norm(base["name"]) not in matched_names:
            matched_names.add(norm(base["name"]))
            patch = {**pts, **{k: v for k, v in r.items() if k != "restricted_to_unit"}}
            if r.get("restricted_to_unit") and not mine.get("restricted_to_unit"):
                patch["restricted_to_unit"] = r["restricted_to_unit"]
            upgrade_layer[mine["id"]] = patch
            continue
        uid = slug(base["name"])
        if uid in used_ids:
            uid = f"{uid}-{slot_key(base['upgrade_type_fkey'])}"
        n = 2
        while uid in used_ids:
            uid = f"{slug(base['name'])}-{n}"
            n += 1
        used_ids.add(uid)
        new_upgrades.append({
            "id": uid,
            "name": base["name"],
            "type": slot_key(base["upgrade_type_fkey"]),
            **pts,
            **({"revamp_only": True} if not base["classic"] else {}),
            **r,
        })

    layer = {
        "source": "https://tabletopadmiral.com/api",
        "generated_by": "scripts/import_tabletop_admiral.py",
        "units": unit_layer,
        "new_units": new_units,
        "upgrades": upgrade_layer,
        "new_upgrades": new_upgrades,
    }
    OUT.write_text(json.dumps(layer, indent=1, ensure_ascii=False) + "\n")
    print(f"units patched {len(unit_layer)}, new units {len(new_units)}: {[u['id'] for u in new_units]}")
    print(f"upgrades patched {len(upgrade_layer)}, new upgrades {len(new_upgrades)}")
    unmatched = [u["id"] for u in ours["units"] if u["id"] not in unit_layer]
    print("units without TTA match:", unmatched)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="refresh the snapshot from tabletopadmiral.com first")
    ap.add_argument("--ours", type=Path, required=True, help="JSON dump of our catalog without this layer")
    a = ap.parse_args()
    if a.fetch:
        fetch()
    build(a.ours)
