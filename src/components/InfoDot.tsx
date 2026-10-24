import { useState } from "react";

/** Small "i" dot that shows rules text on hover, focus, or tap. */
export function InfoDot({ title, text, url, source = "Legion Helper" }: {
  title: string; text: string; url: string;
  /** Site name for the "Full rules on ..." link. */
  source?: string;
}) {
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
           onMouseDown={(e) => e.preventDefault()}>Full rules on {source} ↗</a>
      </span>
    </span>
  );
}
