import type { Token } from "../lib/tabletop";
import { statusChips } from "../lib/statusTokens";

// Status tokens on the Legion tabletop canvas: a row of chips under each
// unit's base, drawn above every token so neighbours don't hide them. A
// squad shares its tokens, so they show once, under the whole squad.

type Props = { tokens: Token[]; u: number; scale: number };

export function StatusChips({ tokens, u, scale }: Props) {
  return (
    <g pointerEvents="none">
      {tokens.map((tk) => {
        const chips = statusChips(tk);
        if (!chips.length) return null;
        // Sized like a real token beside the mini (about 0.4"), but never
        // smaller than a readable dot when zoomed out.
        const r = Math.max(0.2 * u, 5 / scale);
        const step = 2 * r + Math.max(0.04 * u, 1.5 / scale);
        const font = r * 1.4;
        // A squad's row sits under the whole squad so members don't cover it.
        const unit = tk.squadId ? tokens.filter((t) => t.squadId === tk.squadId) : [tk];
        const left = Math.min(...unit.map((t) => t.x)), right = Math.max(...unit.map((t) => t.x + t.size));
        const cx = ((left + right) / 2) * u;
        const y = Math.max(...unit.map((t) => t.y + t.size)) * u + r * 1.25;
        const x0 = cx - ((chips.length - 1) * step) / 2;
        return (
          <g key={tk.id} data-status-chips={chips.map((c) => c.id).join(" ")}>
            {chips.map((c, i) => (
              <g key={c.id}>
                {c.icon ? (
                  <image href={c.icon} x={x0 + i * step - r * 1.15} y={y - r * 1.15} width={r * 2.3} height={r * 2.3} />
                ) : (
                  <>
                    <circle cx={x0 + i * step} cy={y} r={r} fill="#0e0f12" stroke={c.color} strokeWidth={r * 0.22} />
                    <text x={x0 + i * step} y={y + font * 0.38} textAnchor="middle" fontSize={font}
                          fill={c.color} fontWeight={700}>{c.glyph}</text>
                  </>
                )}
                {c.count > 1 && (
                  <text x={x0 + i * step + r * 0.9} y={y - r * 0.45} textAnchor="middle" fontSize={font * 0.85}
                        fill="#fff" fontWeight={700} paintOrder="stroke" stroke="#0e0f12" strokeWidth={r * 0.35}>{c.count}</text>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}
