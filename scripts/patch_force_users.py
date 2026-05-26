"""Patch known Force-using units in catalog.seed.ts to include a force
upgrade slot and force_alignment metadata."""
from __future__ import annotations
import re
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "src" / "data" / "catalog.seed.ts"

FORCE_USERS: dict[tuple[str, str], tuple[str, int]] = {
    ("Anakin Skywalker", "Hero Without Fear"): ("light", 3),
    ("Obi-Wan Kenobi", "Civilized Warrior"): ("light", 3),
    ("Yoda", "Grand Master of the Jedi Order"): ("light", 3),
    ("Ahsoka Tano", "Padawan Commander"): ("light", 2),
    ("Ahsoka Tano", "Fulcrum"): ("light", 2),
    ("Jedi Knight", ""): ("light", 2),
    ("Jedi Knight General", ""): ("light", 3),
    ("Darth Vader", "Dark Lord of the Sith"): ("dark", 3),
    ("Darth Vader", "The Emperor's Apprentice"): ("dark", 2),
    ("Fifth Brother", ""): ("dark", 2),
    ("Seventh Sister", ""): ("dark", 2),
    ("Count Dooku", "Darth Tyranus"): ("dark", 3),
    ("General Grievous", "Sinister Cyborg"): ("dark", 2),
    ("Asajj Ventress", "Sith Assassin"): ("dark", 2),
    ("Luke Skywalker", "Hero of the Rebellion"): ("light", 2),
    ("Luke Skywalker", "Jedi Knight"): ("light", 2),
    ("Maul", "A Rival"): ("dark", 2),
}


def main() -> int:
    text = SEED.read_text()
    pattern = re.compile(r"(  \{)(\n(?:    [^\n]*\n)+)(  \},)")
    patched = 0

    def handle(m: re.Match) -> str:
        nonlocal patched
        open_brace, body, close_brace = m.group(1), m.group(2), m.group(3)
        m_name = re.search(r'name:\s*"([^"]+)"', body)
        m_sub = re.search(r'sub_title:\s*"([^"]+)"', body)
        if not m_name:
            return m.group(0)
        key = (m_name.group(1), m_sub.group(1) if m_sub else "")
        if key not in FORCE_USERS:
            return m.group(0)
        alignment, force_slots = FORCE_USERS[key]
        new_body = body
        if "force_alignment:" not in new_body:
            insertion = f'    force_alignment: "{alignment}",\n'
            new_body = re.sub(
                r"(    has_defense_surge:[^\n]*\n)",
                r"\1" + insertion,
                new_body,
                count=1,
            )
        m_up = re.search(r"(    upgrades:\s*\{)([^}]*)(\},)", new_body)
        if m_up:
            inside = m_up.group(2)
            if "force:" not in inside:
                new_inside = inside.rstrip(" ,") + f", force: {force_slots} "
                new_body = (
                    new_body[: m_up.start()]
                    + m_up.group(1)
                    + new_inside
                    + m_up.group(3)
                    + new_body[m_up.end() :]
                )
        else:
            insertion = (
                f'    upgrades: {{ force: {force_slots}, command: 1, training: 1, gear: 1 }},\n'
            )
            new_body = new_body.rstrip("\n") + "\n" + insertion
        patched += 1
        return open_brace + new_body + close_brace

    new_text = pattern.sub(handle, text)
    SEED.write_text(new_text)
    print(f"Patched {patched} Force-user entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
