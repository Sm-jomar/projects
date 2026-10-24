import { useState } from "react";
import type { TabletopState, Token } from "../lib/tabletop";
import type { Rank } from "../lib/types";
import {
  STATUS_GROUPS, STATUS_TOKENS, ORDER_ICON, ORDER_INFO, ORDER_URL, RANK_LABEL,
  setOrdered, setStatus, statusCount, type StatusDef,
} from "../lib/statusTokens";

// Status token section of the Legion token inspector. Counts belong to the
// unit, so a squad member edits the whole squad's tokens.

/** Small "i" dot that shows rules text on hover, focus, or tap. */
export function InfoDot({ title, text, url }: { title: string; text: string; url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={"tt-info" + (open ? " open" : "")}>
      <button type="button" className="tt-info-dot" aria-label={`About ${title}`}
              aria-expanded={open}
              onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
              onBlur={() => setOpen(false)}>i</button>
      <span className="tt-info-tip" role="tooltip">
        <b>{title}</b>
        {text}
        <a href={url} target="_blank" rel="noreferrer"
           onMouseDown={(e) => e.preventDefault()}>Full rules on Legion Helper ↗</a>
      </span>
    </span>
  );
}

/** The token's art, or a coloured glyph when there is none. */
export function TokenIcon({ def }: { def: Pick<StatusDef, "icon" | "glyph" | "color" | "label"> }) {
  return def.icon
    ? <img className="tt-tok-icon" src={def.icon} alt="" />
    : <span className="tt-tok-chip" style={{ color: def.color, borderColor: def.color }}>{def.glyph}</span>;
}

export function StatusTokenPanel({ state, token, rank, readOnly, onCommit }: {
  state: TabletopState;
  token: Token;
  rank?: Rank;
  readOnly?: boolean;
  onCommit: (s: TabletopState) => void;
}) {
  const squadSize = token.squadId ? state.tokens.filter((t) => t.squadId === token.squadId).length : 1;
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="tt-tok">
      <div className="tt-tok-head">
        <span className="tt-counter-label">Tokens</span>
        {squadSize > 1 && <span className="tt-tok-shared">Shared by the squad ({squadSize})</span>}
      </div>

      <label className="tt-check tt-tok-order">
        <input type="checkbox" checked={!!token.ordered} disabled={readOnly}
               onChange={(e) => onCommit(setOrdered(state, token.id, e.target.checked))} />
        <img className="tt-tok-icon" src={ORDER_ICON} alt="" />
        <span className="tt-tok-name">
          Order token{rank ? ` (${RANK_LABEL[rank]})` : ""}
        </span>
        <InfoDot title={`Order token${rank ? ` · ${RANK_LABEL[rank]}` : ""}`} text={ORDER_INFO} url={ORDER_URL} />
      </label>

      {STATUS_GROUPS.map((g) => {
        // Green tokens and suppression are always listed; the rarer ones
        // appear once held, or on "More tokens".
        const defs = STATUS_TOKENS.filter((d) => d.group === g.id &&
          (showAll || d.group === "green" || d.id === "suppression" || statusCount(token, d.id) > 0));
        if (!defs.length) return null;
        return (
          <div key={g.id} className="tt-tok-group">
            <div className="tt-tok-group-label">{g.label}</div>
            {defs.map((d) => {
              const n = statusCount(token, d.id);
              const max = d.max ?? Infinity;
              return (
                <div key={d.id} className={"tt-tok-row" + (n > 0 ? " on" : "")} data-status={d.id}>
                  <TokenIcon def={d} />
                  <span className="tt-tok-name">{d.label}</span>
                  <InfoDot title={`${d.label} token`} text={d.info} url={d.url} />
                  <div className="tt-counter-controls">
                    {max === 1 ? (
                      <input type="checkbox" checked={n > 0} disabled={readOnly} aria-label={d.label}
                             onChange={(e) => onCommit(setStatus(state, token.id, d.id, e.target.checked ? 1 : 0))} />
                    ) : (
                      <>
                        <button disabled={readOnly || n === 0} aria-label={`Remove ${d.label}`}
                                onClick={() => onCommit(setStatus(state, token.id, d.id, n - 1))}>−</button>
                        <b>{n}</b>
                        <button disabled={readOnly || n >= max} aria-label={`Add ${d.label}`}
                                onClick={() => onCommit(setStatus(state, token.id, d.id, n + 1))}>+</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <button type="button" className="ghost-btn tt-tok-more" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Show fewer tokens" : "More tokens (ion, poison, shield, vehicle…)"}
      </button>
    </div>
  );
}
