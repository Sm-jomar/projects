import { useState } from "react";
import manifestRaw from "../data/rulebook-manifest.json";

type Book = {
  slug: string;
  title: string;
  source: string;
  pages: string[];
  pageCount: number;
};

const BOOKS = manifestRaw as Book[];
const BASE = import.meta.env.BASE_URL;

export function RulebookViewer() {
  const [active, setActive] = useState<Book | null>(null);
  const [page, setPage] = useState(0);

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

  return (
    <ul className="rb-list">
      {BOOKS.map((b) => (
        <li key={b.slug} className="rb-row">
          <div className="rb-row-main">
            <div className="rb-row-title">{b.title}</div>
            <div className="rb-row-meta muted small">{b.pageCount} pages</div>
          </div>
          <button onClick={() => open(b)}>Open</button>
        </li>
      ))}
    </ul>
  );
}
