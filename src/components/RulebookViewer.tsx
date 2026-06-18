import { useMemo, useState } from "react";
import manifestRaw from "../data/rulebook-manifest.json";

type Book = {
  slug: string;
  title: string;
  source: string;
  pages: string[];
  pageCount?: number;
  archived?: boolean;
  archivedAt?: string;
};

const BOOKS = manifestRaw as Book[];
const BASE = import.meta.env.BASE_URL;

export function RulebookViewer() {
  const [active, setActive] = useState<Book | null>(null);
  const [page, setPage] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  // Split the manifest by archive status so the list can hide old
  // versions by default while still letting the user opt-in to see them.
  const { activeBooks, archivedBooks } = useMemo(() => {
    const a: Book[] = [];
    const z: Book[] = [];
    for (const b of BOOKS) (b.archived ? z : a).push(b);
    return { activeBooks: a, archivedBooks: z };
  }, []);

  function open(b: Book) {
    setActive(b);
    setPage(0);
  }

  if (active) {
    const total = active.pages.length;
    return (
      <div className="rulebook-viewer">
        <div className="rb-bar">
          <button onClick={() => setActive(null)}>← Books</button>
          <strong>{active.title}</strong>
          <div className="rb-pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              ‹ Prev
            </button>
            <span className="muted small">
              {page + 1} / {total}
            </span>
            <button
              disabled={page >= total - 1}
              onClick={() => setPage(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
        <div className="rb-page">
          <img src={BASE + active.pages[page]} alt={`page ${page + 1}`} />
        </div>
      </div>
    );
  }

  const listed = showArchived ? archivedBooks : activeBooks;

  return (
    <>
      <ul className="rb-list">
        {listed.map((b) => (
          <li key={b.slug} className={"rb-row" + (b.archived ? " rb-row-archived" : "")}>
            <div className="rb-row-main">
              <div className="rb-row-title">
                {b.title}
                {b.archived && <span className="muted small"> · archived {b.archivedAt ?? ""}</span>}
              </div>
              <div className="rb-row-meta muted small">{b.pageCount ?? b.pages.length} pages</div>
            </div>
            <button onClick={() => open(b)}>Open</button>
          </li>
        ))}
        {listed.length === 0 && (
          <li className="rb-row muted empty">No {showArchived ? "archived " : ""}rulebooks.</li>
        )}
      </ul>
      {archivedBooks.length > 0 && (
        <div className="rb-archive-toggle">
          <button className="ghost-btn" onClick={() => setShowArchived((v) => !v)}>
            {showArchived
              ? `← Active rulebooks (${activeBooks.length})`
              : `Show archived versions (${archivedBooks.length}) →`}
          </button>
        </div>
      )}
    </>
  );
}
