import type { Token } from "../lib/tabletop";
import { listSquads, touching, unlockedIds } from "../lib/squads";

// Squad visuals for the Legion tabletop canvas, drawn on top of the tokens
// in SVG units (`u` per inch).

type Props = { tokens: Token[]; u: number; scale: number };

const center = (t: Token, u: number) => ({ x: (t.x + t.size / 2) * u, y: (t.y + t.size / 2) * u });

/** Leader star, a dot where squad members touch, and a red dashed ring on
 * members out of base contact. */
export function SquadMarkers({ tokens, u, scale }: Props) {
  const loose = unlockedIds(tokens);
  const contacts: { key: string; x: number; y: number }[] = [];
  for (const sq of listSquads(tokens)) {
    sq.members.forEach((a, i) => {
      for (const b of sq.members.slice(i + 1)) {
        if (!touching(a, b)) continue;
        const p = center(a, u), q = center(b, u);
        const k = a.size / (a.size + b.size);
        contacts.push({ key: `${a.id}-${b.id}`, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      }
    });
  }
  return (
    <g pointerEvents="none">
      {tokens.filter((t) => t.squadId).map((t) => {
        const c = center(t, u);
        const r = (t.size * u) / 2;
        return (
          <g key={t.id} data-squad-member={t.squadLead ? "leader" : "member"}>
            {loose.has(t.id) && (
              <circle cx={c.x} cy={c.y} r={r + 3 / scale} fill="none" stroke="#ff5a5a"
                      strokeWidth={2 / scale} strokeDasharray={`${3 / scale} ${2 / scale}`} />
            )}
            {t.squadLead && (
              <text x={c.x} y={c.y - r - 2 / scale} textAnchor="middle" fontSize={11 / scale}
                    fill="#7fd6ff" fontWeight={700}
                    paintOrder="stroke" stroke="#0e0f12" strokeWidth={2.5 / scale}>★</text>
            )}
          </g>
        );
      })}
      {contacts.map((c) => (
        <circle key={c.key} cx={c.x} cy={c.y} r={2.5 / scale} fill="#7fd6ff" stroke="#0e0f12" strokeWidth={1 / scale} />
      ))}
    </g>
  );
}
