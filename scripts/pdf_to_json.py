"""Convert a (large) PDF into a small, commit-friendly JSON + compressed images.

Run this LOCALLY on a PDF you've downloaded from Google Drive (the raw PDF
is too big for GitHub's 25 MB limit, but the extracted text JSON is tiny and
the images are recompressed down to web size). Commit the output folder;
the raw PDF stays on your machine.

If a page has no embedded text layer (i.e. the PDF is scanned or rendered
as flat images), the script falls back to OCR via Tesseract so the page's
actual text still ends up in content.json/content.txt. Install Tesseract
from https://github.com/UB-Mannheim/tesseract/wiki on Windows or
`apt install tesseract-ocr` on Linux; if it's missing, the script keeps
working but reports which pages it couldn't OCR.

Usage:
    # Double-click convert_pdfs.bat (Windows) for a no-typing file picker, or:
    python3 scripts/pdf_to_json.py                       # opens a file picker
    python3 scripts/pdf_to_json.py path/to/file.pdf      # one or more paths
    python3 scripts/pdf_to_json.py a.pdf b.pdf c.pdf
    python3 scripts/pdf_to_json.py file.pdf --out data/my-doc \
        --max-dim 1400 --quality 80
    python3 scripts/pdf_to_json.py file.pdf --no-images   # text only
    python3 scripts/pdf_to_json.py file.pdf --no-text-file # skip the .txt
    python3 scripts/pdf_to_json.py file.pdf --text-only   # just the .txt
    python3 scripts/pdf_to_json.py file.pdf --ocr         # force OCR every page
    python3 scripts/pdf_to_json.py file.pdf --no-ocr      # disable OCR fallback

Output (default out dir = data/<pdf-stem>/):
    <out>/content.json        page-by-page text + image filenames + metadata
    <out>/content.txt         plain text, page-separated (skip with --no-text-file)
    <out>/images/pNNN_iM.jpg  embedded images, recompressed

Requires: pymupdf, Pillow   (pip install pymupdf Pillow)
Optional: tesseract CLI for OCR fallback on image-only PDFs.

To serve the images in the app, move <out>/images into
public/extracted/<name>/ and reference them by that path; otherwise they
just live in data/ for reference/parsing.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import fitz  # pymupdf
except ImportError:
    sys.exit("Missing dependency: pip install pymupdf")
try:
    from PIL import Image
except ImportError:
    sys.exit("Missing dependency: pip install Pillow")


# Pages whose text-layer extract is shorter than this are treated as
# "effectively empty" and trigger the OCR fallback. 10 catches truly
# blank pages and lone page-number footers, but lets a real text layer
# (even just a chapter heading) be trusted. Use --ocr to force OCR.
OCR_MIN_TEXT_CHARS = 10


def has_tesseract() -> bool:
    return shutil.which("tesseract") is not None


def ocr_page(page, dpi: int) -> str:
    """Render the page as a PNG and run Tesseract over it. Returns the
    recognized text, or "" if Tesseract is missing or fails."""
    if not has_tesseract():
        return ""
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    png = pix.tobytes("png")
    try:
        r = subprocess.run(
            ["tesseract", "stdin", "stdout", "--psm", "6", "--oem", "1"],
            input=png,
            capture_output=True,
            check=False,
            timeout=60,
        )
        return r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def compress(data: bytes, max_dim: int, quality: int) -> bytes | None:
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None
    long_side = max(img.size)
    if long_side > max_dim:
        scale = max_dim / long_side
        img = img.resize((int(img.size[0] * scale), int(img.size[1] * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def pick_pdfs() -> list[Path]:
    """Open a native file picker for one or more PDFs (no-arg / double-click)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return []
    root = tk.Tk()
    root.withdraw()
    selected = filedialog.askopenfilenames(
        title="Select PDF file(s) to convert",
        filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
    )
    root.destroy()
    return [Path(p) for p in selected]


def convert_pdf(pdf: Path, out: Path, max_dim: int, quality: int,
                min_image_px: int, no_images: bool,
                write_text_file: bool, write_json: bool,
                ocr_mode: str, ocr_dpi: int) -> None:
    """ocr_mode is one of: "auto" (OCR only pages with no text layer),
    "force" (OCR every page), "off" (never OCR)."""
    out.mkdir(parents=True, exist_ok=True)
    img_dir = out / "images"
    if not no_images:
        img_dir.mkdir(exist_ok=True)

    tesseract_ok = ocr_mode != "off" and has_tesseract()
    if ocr_mode != "off" and not tesseract_ok:
        print("  Tesseract not found on PATH — OCR fallback disabled. Install "
              "tesseract-ocr if your PDFs are image-based.")

    doc = fitz.open(pdf)
    seen_hashes: set[str] = set()
    pages_out = []
    total_images = 0
    ocred_pages: list[int] = []
    missed_ocr_pages: list[int] = []
    for pi, page in enumerate(doc):
        text = page.get_text("text").strip()
        text_source = "pdf"
        needs_ocr = (
            ocr_mode == "force"
            or (ocr_mode == "auto" and len(text) < OCR_MIN_TEXT_CHARS)
        )
        if needs_ocr:
            if tesseract_ok:
                ocr_text = ocr_page(page, ocr_dpi)
                if ocr_text:
                    text = ocr_text
                    text_source = "ocr"
                    ocred_pages.append(pi + 1)
            elif ocr_mode != "off" and not text:
                missed_ocr_pages.append(pi + 1)

        image_files: list[str] = []
        if not no_images:
            for ii, img_ref in enumerate(page.get_images(full=True)):
                info = doc.extract_image(img_ref[0])
                data = info["image"]
                w, h = info.get("width", 0), info.get("height", 0)
                if max(w, h) < min_image_px:
                    continue
                digest = hashlib.sha1(data).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                jpg = compress(data, max_dim, quality)
                if jpg is None:
                    continue
                fname = f"p{pi + 1:03d}_i{ii}.jpg"
                (img_dir / fname).write_bytes(jpg)
                image_files.append(f"images/{fname}")
                total_images += 1
        pages_out.append({
            "page": pi + 1,
            "text": text,
            "textSource": text_source,
            "images": image_files,
        })
    doc.close()

    if write_json:
        content = {
            "source": pdf.name,
            "pageCount": len(pages_out),
            "imageCount": total_images,
            "pages": pages_out,
        }
        (out / "content.json").write_text(json.dumps(content, indent=2))

    if write_text_file:
        # Human-readable plain text with a page header per page so search
        # results are still easy to locate. UTF-8 keeps en-dashes, smart
        # quotes, and Star Wars accented names intact. OCR'd pages get a
        # marker so you can tell scanned content from real text-layer text.
        lines: list[str] = [f"# {pdf.name}", ""]
        for p in pages_out:
            tag = " (OCR)" if p["textSource"] == "ocr" else ""
            lines.append(f"=== Page {p['page']}{tag} ===")
            if p["text"]:
                lines.append(p["text"])
            lines.append("")
        (out / "content.txt").write_text("\n".join(lines), encoding="utf-8")

    if write_json:
        json_kb = (out / "content.json").stat().st_size / 1024
        print(f"Wrote {(out / 'content.json').resolve()} ({json_kb:.0f} KB)")
    if write_text_file:
        txt_kb = (out / "content.txt").stat().st_size / 1024
        print(f"Wrote {(out / 'content.txt').resolve()} ({txt_kb:.0f} KB)")
    print(f"  {len(pages_out)} pages, {total_images} images -> "
          f"{img_dir.resolve() if not no_images else '(skipped)'}")
    if ocred_pages:
        print(f"  OCR'd {len(ocred_pages)} page{'s' if len(ocred_pages) != 1 else ''} "
              f"(no text layer): {_range_str(ocred_pages)}")
    if missed_ocr_pages:
        print(f"  WARNING: {len(missed_ocr_pages)} page(s) had no text and "
              f"Tesseract wasn't available: {_range_str(missed_ocr_pages)}")


def _range_str(nums: list[int]) -> str:
    """Compact "1-3, 7, 9-11" form for a list of page numbers."""
    if not nums:
        return ""
    nums = sorted(set(nums))
    out: list[str] = []
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        out.append(f"{start}" if start == prev else f"{start}-{prev}")
        start = prev = n
    out.append(f"{start}" if start == prev else f"{start}-{prev}")
    return ", ".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", nargs="*", type=Path,
                    help="path(s) to source PDF(s); omit to open a file picker")
    ap.add_argument("--out", type=Path, default=None,
                    help="output dir (single PDF) or parent dir (multiple PDFs)")
    ap.add_argument("--max-dim", type=int, default=1400, help="cap image long side (px)")
    ap.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100")
    ap.add_argument("--min-image-px", type=int, default=200,
                    help="skip embedded images whose long side is under this")
    ap.add_argument("--no-images", action="store_true", help="extract text only")
    ap.add_argument("--no-text-file", action="store_true",
                    help="skip the plain-text .txt output (JSON only)")
    ap.add_argument("--text-only", action="store_true",
                    help="only write content.txt (no JSON, no images)")
    ap.add_argument("--ocr", action="store_true",
                    help="force OCR on every page (slower, but works for "
                         "PDFs with garbage text layers)")
    ap.add_argument("--no-ocr", action="store_true",
                    help="disable the OCR fallback even on pages with no text")
    ap.add_argument("--ocr-dpi", type=int, default=200,
                    help="render DPI for OCR (default 200; raise for tiny fonts)")
    args = ap.parse_args()

    if args.ocr and args.no_ocr:
        sys.exit("--ocr and --no-ocr are mutually exclusive.")

    pdfs = list(args.pdf) or pick_pdfs()
    if not pdfs:
        sys.exit("No PDF selected. Pass path(s) as arguments or choose a file in the dialog.")

    write_json = not args.text_only
    write_text = not args.no_text_file
    no_images = args.no_images or args.text_only
    ocr_mode = "force" if args.ocr else ("off" if args.no_ocr else "auto")

    ok = 0
    for pdf in pdfs:
        if not pdf.exists():
            print(f"Skipping (no such file): {pdf}")
            continue
        if args.out and len(pdfs) == 1:
            out = args.out
        else:
            out = (args.out or Path("data")) / pdf.stem.lower().replace(" ", "-")
        print(f"\nConverting {pdf.name} ...")
        convert_pdf(pdf, out, args.max_dim, args.quality, args.min_image_px,
                    no_images, write_text, write_json, ocr_mode, args.ocr_dpi)
        ok += 1

    if ok:
        print("\nDone. Commit the output folder(s) (NOT the raw PDF). To serve")
        print("images in the app, move <out>/images into public/extracted/<name>/.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
