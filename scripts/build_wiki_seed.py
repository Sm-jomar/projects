"""Build the seed catalog from the authoritative wiki Unit_List.

Hard-codes the per-faction unit lists transcribed from
https://starwarslegion.fandom.com/wiki/Unit_List (pasted by user). For each
wiki entry, looks up an existing catalog/seed entry by fuzzy name match and
carries over the point cost; defaults to a placeholder when no match is
found. Emits two TypeScript blocks for catalog.seed.ts: SEED_UNITS
(rebels/imperials/republic/separatists primary) and MERCENARY_SEED
(mercenary primary). Cross-faction units are emitted once under their
primary faction with also_factions covering the others.
"""
from __future__ import annotations
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (display_name, sub_title, rank, factions[], removed)
# factions order matters: primary is first; rest go in also_factions.
# Removed entries are skipped at output time.
WIKI_UNITS: list[tuple[str, str, str, list[str], bool]] = [
    # ===== REBELS (primary) =====
    ("C-3PO", "Golden God", "commander", ["rebels"], False),
    ("Han Solo", "", "commander", ["rebels"], False),
    ("Lando Calrissian", "", "commander", ["rebels"], False),
    ("Leia Organa", "", "commander", ["rebels"], False),
    ("Logray", "Superstitious Shaman", "commander", ["rebels"], False),
    ("Luke Skywalker", "Hero of the Rebellion", "commander", ["rebels"], False),
    ("Rebel Officer", "", "commander", ["rebels"], False),
    ("Wicket", "Hero of Bright Tree", "commander", ["rebels"], False),
    ("Cassian Andor", "", "operative", ["rebels"], False),
    ("Jyn Erso", "", "operative", ["rebels"], False),
    ("K-2SO", "", "operative", ["rebels"], False),
    ("Luke Skywalker", "Jedi Knight", "operative", ["rebels"], False),
    ("Rebel Agent", "", "operative", ["rebels"], False),
    ("Sabine Wren", "", "operative", ["rebels"], False),
    ("Fleet Troopers", "", "corps", ["rebels"], False),
    ("Rebel Troopers", "", "corps", ["rebels"], False),
    ("Rebel Veterans", "", "corps", ["rebels"], False),
    ("Mark II Medium Blaster Trooper", "", "corps", ["rebels"], False),
    ("Ewok Skirmishers", "", "corps", ["rebels"], False),
    ("Ewok Slingers", "", "special-forces", ["rebels"], False),
    ("Mandalorian Resistance", "", "special-forces", ["rebels"], False),
    ("Mandalorian Resistance", "Clan Wren", "special-forces", ["rebels"], False),
    ("Rebel Commandos", "", "special-forces", ["rebels"], False),
    ("Rebel Commandos", "Strike Team", "special-forces", ["rebels"], False),
    ("Rebel Pathfinders", "", "special-forces", ["rebels"], True),  # removed
    ("Rebel Sleeper Cell", "", "special-forces", ["rebels"], False),
    ("Wookiee Warriors", "Freedom Fighters", "special-forces", ["rebels"], False),
    ("Wookiee Warriors", "Kashyyyk Resistance", "special-forces", ["rebels"], False),
    ("1.4 FD Laser Cannon Team", "", "support", ["rebels"], False),
    ("AT-RT", "", "support", ["rebels"], False),
    ("Tauntaun Riders", "", "support", ["rebels"], False),
    ("Chewbacca", "Let the Wookiee Win", "heavy", ["rebels"], False),
    ("T-47 Airspeeder", "", "heavy", ["rebels"], False),
    ("X-34 Landspeeder", "", "heavy", ["rebels"], False),

    # ===== IMPERIALS =====
    ("Darth Vader", "Dark Lord of the Sith", "commander", ["imperials"], False),
    ("Director Orson Krennic", "", "commander", ["imperials"], False),
    ("Emperor Palpatine", "", "commander", ["imperials"], True),  # removed
    ("General Veers", "", "commander", ["imperials"], False),
    ("Iden Versio", "", "commander", ["imperials"], False),
    ("Imperial Officer", "", "commander", ["imperials"], False),
    ("Moff Gideon", "", "commander", ["imperials"], False),
    ("Agent Kallus", "", "operative", ["imperials"], False),
    ("Darth Vader", "The Emperor's Apprentice", "operative", ["imperials"], False),
    ("Fifth Brother", "", "operative", ["imperials"], False),
    ("Imperial Agent", "", "operative", ["imperials"], False),
    ("Seventh Sister", "", "operative", ["imperials"], False),
    ("Shoretroopers", "", "corps", ["imperials"], False),
    ("DF-90 Mortar Trooper", "", "corps", ["imperials"], False),
    ("Snowtroopers", "", "corps", ["imperials"], False),
    ("Stormtroopers", "", "corps", ["imperials"], False),
    ("Stormtroopers", "Heavy Response Unit", "corps", ["imperials"], False),
    ("Stormtrooper Riot Squad", "", "corps", ["imperials"], False),
    ("Imperial Death Troopers", "", "special-forces", ["imperials"], False),
    ("Imperial Royal Guards", "", "special-forces", ["imperials"], True),  # removed
    ("Imperial Special Forces", "", "special-forces", ["imperials"], False),
    ("Imperial Special Forces", "Inferno Squad", "special-forces", ["imperials"], False),
    ("Scout Troopers", "", "special-forces", ["imperials"], False),
    ("Scout Troopers", "Strike Team", "special-forces", ["imperials"], False),
    ("74-Z Speeder Bikes", "", "support", ["imperials"], False),
    ("Dewback Rider", "", "support", ["imperials"], False),
    ("E-Web Heavy Blaster Team", "", "support", ["imperials"], False),
    ("Range Troopers", "", "support", ["imperials"], False),
    ("AT-ST", "", "heavy", ["imperials"], False),
    ("Imperial Dark Troopers", "", "heavy", ["imperials"], False),
    ("LAAT/le Patrol Transport", "", "heavy", ["imperials"], False),
    ("Major Marquand", "", "heavy", ["imperials"], False),
    ("TX-225 GAVw Occupier Tank", "", "heavy", ["imperials"], False),

    # ===== REPUBLIC =====
    ("Ahsoka Tano", "Padawan Commander", "commander", ["republic"], False),
    ("Anakin Skywalker", "Hero Without Fear", "commander", ["republic"], False),
    ("Chewbacca", "Republic", "commander", ["republic"], False),
    ("Clone Captain Rex", "", "commander", ["republic"], False),
    ("Clone Commander", "", "commander", ["republic"], False),
    ("Clone Commander Cody", "", "commander", ["republic"], False),
    ("Jedi Knight General", "", "commander", ["republic"], False),
    ("Obi-Wan Kenobi", "Civilized Warrior", "commander", ["republic"], False),
    ("Wookiee Chieftain", "", "commander", ["republic"], False),
    ("Yoda", "Grand Master of the Jedi Order", "commander", ["republic"], False),
    ("Jedi Knight", "", "operative", ["republic"], False),
    ("Padmé Amidala", "Spirited Senator", "operative", ["republic"], False),
    ("Clone Trooper Infantry", "", "corps", ["republic"], False),
    ("Clone Trooper Marksmen", "", "corps", ["republic"], False),
    ("Phase I Clone Troopers", "", "corps", ["republic"], True),  # removed
    ("Phase II Clone Troopers", "", "corps", ["republic"], True),  # removed
    ("ARC Troopers", "", "special-forces", ["republic"], False),
    ("ARC Troopers", "Strike Team", "special-forces", ["republic"], False),
    ("ARF Troopers", "", "special-forces", ["republic"], False),
    ("Wookiee Warriors", "Kashyyyk Defenders", "special-forces", ["republic"], False),
    ("Wookiee Warriors", "Noble Fighters", "special-forces", ["republic"], False),
    ("AT-RT", "Galactic Republic", "support", ["republic"], False),
    ("BARC Speeder", "", "support", ["republic"], False),
    ("Clone Commandos", "", "support", ["republic"], False),
    ("Clone Commandos", "Delta Squad", "support", ["republic"], False),
    ("Raddaugh Gnasp Fluttercraft", "", "support", ["republic"], False),
    ("Raddaugh Gnasp Fluttercraft", "Attack Craft", "support", ["republic"], False),
    ("Infantry Support Platform", "", "heavy", ["republic"], False),
    ("LAAT/le Patrol Transport", "Republic", "heavy", ["republic"], False),
    ("TX-130 Saber-class Fighter Tank", "", "heavy", ["republic"], False),

    # ===== SEPARATISTS =====
    ("Count Dooku", "Darth Tyranus", "commander", ["separatists"], False),
    ("General Grievous", "Sinister Cyborg", "commander", ["separatists"], False),
    ("Kalani", "", "commander", ["separatists"], False),
    ("Kraken", "", "commander", ["separatists"], False),
    ("Poggle the Lesser", "", "commander", ["separatists"], False),
    ("Super Tactical Command Droid", "", "commander", ["separatists"], False),
    ("T-Series Tactical Droid", "", "commander", ["separatists"], False),
    ("Asajj Ventress", "Sith Assassin", "operative", ["separatists"], False),
    ("Sun Fac", "", "operative", ["separatists"], False),
    ("Super Tactical Command Droid", "Operative", "operative", ["separatists"], False),
    ("B1 Battle Droids", "", "corps", ["separatists"], False),
    ("B2 Super Battle Droids", "", "corps", ["separatists"], False),
    ("Geonosian Warriors", "", "corps", ["separatists"], False),
    ("BX-series Droid Commandos", "", "special-forces", ["separatists"], False),
    ("BX-series Droid Commandos", "Strike Team", "special-forces", ["separatists"], False),
    ("DRK-1 Sith Probe Droids", "", "special-forces", ["separatists"], False),
    ("IG-100 MagnaGuards", "", "special-forces", ["separatists"], False),
    ("IG-100 MagnaGuards", "Prototype Assassin Droids", "special-forces", ["separatists"], False),
    ("Droidekas", "", "support", ["separatists"], False),
    ("DSD1 Dwarf Spider Droid", "", "support", ["separatists"], False),
    ("LM-432 Crab Droid", "", "support", ["separatists"], False),
    ("STAP Riders", "", "support", ["separatists"], False),
    ("AAT Battle Tank", "", "heavy", ["separatists"], False),
    ("NR-N99 Persuader-Class Tank Droid", "", "heavy", ["separatists"], False),
    ("NR-N99 Persuader-Class Tank Droid", "Prototype Tank Droid", "heavy", ["separatists"], False),
    ("Aqua Droids", "", "heavy", ["separatists"], False),

    # ===== MERCENARY primary (Shadow Collective / Ohnaka only) =====
    ("Gar Saxon", "Militant Commando", "commander", ["mercenary"], False),
    ("Maul", "A Rival", "operative", ["mercenary"], False),
    ("Mandalorian Super Commandos", "", "special-forces", ["mercenary"], False),
    ("Weequay Pirates", "", "corps", ["mercenary"], False),
    ("WLO-5 Speeder Tank", "", "heavy", ["mercenary"], False),

    # ===== Cross-faction units (primary = mercenary, also_factions = others) =====
    # Pyke Capo: all 5 factions
    ("Pyke Syndicate Capo", "", "commander", ["mercenary", "rebels", "imperials", "republic", "separatists"], False),
    # Pyke Foot Soldiers: all 5 factions
    ("Pyke Syndicate Foot Soldiers", "", "corps", ["mercenary", "rebels", "imperials", "republic", "separatists"], False),
    # Black Sun Vigo: Mercenary, Empire, Separatists
    ("Black Sun Vigo", "", "commander", ["mercenary", "imperials", "separatists"], False),
    # Black Sun Enforcers: Mercenary, Empire, Separatists
    ("Black Sun Enforcers", "", "corps", ["mercenary", "imperials", "separatists"], False),
    # Bossk: Mercenary, Empire, Separatists
    ("Bossk", "Trandoshan Terror", "operative", ["imperials", "separatists"], False),
    # Cad Bane: Mercenary, Empire, Separatists
    ("Cad Bane", "Needs No Introduction", "operative", ["mercenary", "imperials", "separatists"], False),
    # Hondo Ohnaka: Empire, Separatists, Rebels, Republic, Mercenary (Ohnaka Gang)
    ("Hondo Ohnaka", "", "operative", ["rebels", "imperials", "republic", "separatists"], False),
    # Boba Fett: Empire (Operative variant) + Rebels (Daimyo variant). The
    # Daimyo cost (120) and Bounty Hunter cost (130) differ — treated as
    # two units with their own ids.
    ("Boba Fett", "Daimyo of Mos Espa", "operative", ["rebels"], False),
    ("Boba Fett", "Infamous Bounty Hunter", "operative", ["imperials"], False),
    # IG-11: Empire + Rebels
    ("IG-11", "Nurse Droid", "operative", ["imperials", "rebels"], False),
    ("IG-88", "Assassin Droid", "operative", ["imperials"], False),
    # Din Djarin: Empire + Rebels
    ("Din Djarin", "The Mandalorian", "operative", ["rebels", "imperials"], False),
    # The Bad Batch: Rebels + Republic
    ("The Bad Batch", "", "operative", ["rebels", "republic"], False),
    # R2-D2: Rebels (Operative) + Republic (Operative)
    ("R2-D2", "", "operative", ["rebels", "republic"], False),
    # Ahsoka Tano: Rebels Operative + Republic Commander. Different ranks =
    # two units with their own ids.
    ("Ahsoka Tano", "Fulcrum", "operative", ["rebels"], False),
    # Chewbacca: Rebels (Operative) only (the Heavy variant is "Let the
    # Wookiee Win" handled above; Republic variant is its own commander).
    ("Chewbacca", "", "operative", ["rebels"], False),
    # Mandalorian Resistance (Clan Wren): handled above

    # Swoop Bike Riders: Mercenary, Rebels, Republic
    ("Swoop Bike Riders", "", "support", ["mercenary", "rebels", "republic"], False),
    # A-A5 Speeder Truck: Mercenary, Rebels
    ("A-A5 Speeder Truck", "", "heavy", ["mercenary", "rebels"], False),
]

# Catalog files we'll harvest existing point costs from.
EXISTING_CATALOGS = [
    ROOT / "src" / "data" / "catalog.base.json",
]


def _norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_existing_points() -> dict[str, dict]:
    """Build a map keyed by normalised (name, sub_title) and (name,) of
    existing catalog entries so we can carry over their costs/stats."""
    by_name: dict[str, dict] = {}
    for path in EXISTING_CATALOGS:
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        for u in data.get("units", []):
            key = _norm(u["name"])
            by_name.setdefault(key, []).append(u)
    # Also include catalog.seed.ts via crude parse — pull `name:` / `sub_title:` / `points:` triples.
    seed_path = ROOT / "src" / "data" / "catalog.seed.ts"
    if seed_path.exists():
        text = seed_path.read_text()
        # Naive regex over object literals.
        for m in re.finditer(
            r'\{[^{}]*?name:\s*"([^"]+)"[^{}]*?points:\s*(\d+)[^{}]*?\}',
            text,
            re.DOTALL,
        ):
            name = m.group(1)
            pts = int(m.group(2))
            sub_m = re.search(r'sub_title:\s*"([^"]+)"', m.group(0))
            sub = sub_m.group(1) if sub_m else ""
            entry = {"name": name, "sub_title": sub, "points": pts}
            by_name.setdefault(_norm(name), []).append(entry)
    return by_name


def find_existing(
    name: str, sub_title: str, by_name: dict[str, dict]
) -> dict | None:
    candidates = by_name.get(_norm(name)) or []
    if not candidates:
        # fuzzy fallback by name
        best, score = None, 0.0
        for k, lst in by_name.items():
            s = SequenceMatcher(None, _norm(name), k).ratio()
            if s > score:
                best, score = lst, s
        if score >= 0.82:
            candidates = best or []
    if not candidates:
        return None
    if not sub_title:
        return candidates[0]
    # If sub_title given, prefer exact or fuzzy sub_title match.
    best, score = candidates[0], 0.0
    target = _norm(sub_title)
    for c in candidates:
        cand_sub = _norm(c.get("sub_title") or "")
        s = SequenceMatcher(None, target, cand_sub).ratio() if cand_sub else 0.0
        if s > score:
            best, score = c, s
    return best


def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower())
    return re.sub(r"-+", "-", s).strip("-")


def render_entry(
    name: str,
    sub_title: str,
    rank: str,
    factions: list[str],
    points: int,
    is_unique: bool,
    stats: dict | None = None,
) -> str:
    primary = factions[0]
    also = factions[1:]
    slug = f"{primary}-{slugify(name)}"
    if sub_title:
        slug += f"-{slugify(sub_title)}"
    # Pull through stats from an existing catalog entry where available.
    stats = stats or {}
    unit_type = stats.get("type", "trooper")
    miniatures = stats.get("miniatures", 1)
    wounds = stats.get("wounds", 1)
    defense = stats.get("defense", "white")
    has_def_surge = stats.get("has_defense_surge", False)
    courage = stats.get("courage")
    speed = stats.get("speed")
    resilience = stats.get("resilience")
    attack_surge = stats.get("attack_surge")
    force_alignment = stats.get("force_alignment")
    upgrades = stats.get("upgrades")

    lines = ["  {"]
    lines.append(f'    id: "{slug}",')
    lines.append(f'    name: "{name}",')
    if sub_title:
        lines.append(f'    sub_title: "{sub_title}",')
    lines.append(f"    is_unique: {'true' if is_unique else 'false'},")
    lines.append(f'    faction: "{primary}",')
    if also:
        also_str = ", ".join(f'"{f}"' for f in also)
        lines.append(f"    also_factions: [{also_str}],")
    lines.append(f'    type: "{unit_type}",')
    lines.append(f"    points: {points},")
    lines.append(f'    rank: "{rank}",')
    lines.append(f"    miniatures: {miniatures},")
    lines.append(f"    wounds: {wounds},")
    if resilience is not None:
        lines.append(f"    resilience: {resilience},")
    if courage is not None:
        lines.append(f"    courage: {courage},")
    if speed is not None:
        lines.append(f"    speed: {speed},")
    lines.append(f'    defense: "{defense}",')
    lines.append(f"    has_defense_surge: {'true' if has_def_surge else 'false'},")
    if attack_surge:
        lines.append(f'    attack_surge: "{attack_surge}",')
    if force_alignment:
        lines.append(f'    force_alignment: "{force_alignment}",')
    if upgrades:
        # render upgrade slots compactly
        parts = []
        for k, v in upgrades.items():
            key = f'"{k}"' if "-" in k else k
            parts.append(f"{key}: {v}")
        lines.append(f"    upgrades: {{ {', '.join(parts)} }},")
    lines.append("  },")
    return "\n".join(lines)


# Hand-set points for major characters where the wiki page doesn't carry
# them and we've verified from the card art. Keyed by (name, sub_title).
KNOWN_POINTS: dict[tuple[str, str], int] = {
    ("Obi-Wan Kenobi", "Civilized Warrior"): 150,
    ("Anakin Skywalker", "Hero Without Fear"): 155,
    ("Padmé Amidala", "Spirited Senator"): 60,
    ("Yoda", "Grand Master of the Jedi Order"): 170,
    ("Count Dooku", "Darth Tyranus"): 165,
    ("General Grievous", "Sinister Cyborg"): 130,
    ("Asajj Ventress", "Sith Assassin"): 130,
    ("Maul", "A Rival"): 130,
    ("Boba Fett", "Daimyo of Mos Espa"): 120,
    ("Boba Fett", "Infamous Bounty Hunter"): 130,
    ("Darth Vader", "Dark Lord of the Sith"): 170,
    ("Clone Captain Rex", ""): 95,
    ("Wicket", "Hero of Bright Tree"): 70,
    ("Logray", "Superstitious Shaman"): 50,
    ("Ewok Skirmishers", ""): 40,
    ("Ewok Slingers", ""): 40,
    # Shadow Collective (Mercenary) — printed costs per the user-supplied
    # current Shadow Collective unit list:
    ("Black Sun Vigo", ""): 50,
    ("Gar Saxon", "Militant Commando"): 90,
    ("Pyke Syndicate Capo", ""): 42,
    ("Black Sun Enforcers", ""): 50,
    ("Pyke Syndicate Foot Soldiers", ""): 42,
    ("Weequay Pirates", ""): 40,
    ("Mandalorian Super Commandos", ""): 66,
    ("Swoop Bike Riders", ""): 70,
    ("A-A5 Speeder Truck", ""): 75,
    ("WLO-5 Speeder Tank", ""): 100,
    ("Bossk", "Trandoshan Terror"): 105,
    ("Cad Bane", "Needs No Introduction"): 105,
    ("IG-11", "Nurse Droid"): 105,
    ("IG-88", "Assassin Droid"): 110,
    ("Din Djarin", "The Mandalorian"): 95,
    ("The Bad Batch", ""): 90,
    ("Han Solo", ""): 100,
    ("Leia Organa", ""): 75,
    ("Scout Troopers", ""): 48,
    ("E-Web Heavy Blaster Team", ""): 60,
}

DEFAULT_POINTS = 50  # placeholder when no info available


def main() -> int:
    existing = load_existing_points()
    print("// AUTO-GENERATED by scripts/build_wiki_seed.py.")
    print("// Source: https://starwarslegion.fandom.com/wiki/Unit_List")
    print("// Wiki gives faction/rank truth; points come from card art")
    print("// where verified (KNOWN_POINTS) or the prior catalog where")
    print("// available, otherwise default to 50 pts as a placeholder.")
    print("export const SEED_UNITS: Unit[] = [")
    emitted = 0
    skipped_removed = 0
    placeholder = 0
    for name, sub_title, rank, factions, removed in WIKI_UNITS:
        if removed:
            skipped_removed += 1
            continue
        existing_entry = find_existing(name, sub_title, existing) or {}
        # Look up cost.
        pts = KNOWN_POINTS.get((name, sub_title))
        if pts is None:
            if existing_entry:
                pts = int(existing_entry.get("points") or DEFAULT_POINTS)
            else:
                pts = DEFAULT_POINTS
                placeholder += 1
        # Heuristic unique flag: commanders/operatives are generally unique;
        # corps/support/etc are usually not. Refined by checking for sub_title.
        rank_unique = rank in ("commander", "operative") or bool(sub_title)
        squad_words = {"Troopers", "Droids", "Riders", "Veterans", "Slingers", "Commandos", "Pirates", "Soldiers", "Skirmishers", "Forces", "Squad", "Team", "Marksmen", "Warriors"}
        if any(w in name for w in squad_words):
            rank_unique = False
        # Override unique from existing entry if it has one.
        if "is_unique" in existing_entry:
            rank_unique = bool(existing_entry["is_unique"])
        print(render_entry(name, sub_title, rank, factions, pts, rank_unique, existing_entry))
        emitted += 1
    print("];")
    print(f"// Emitted {emitted} units (skipped {skipped_removed} removed; "
          f"{placeholder} placeholders).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
