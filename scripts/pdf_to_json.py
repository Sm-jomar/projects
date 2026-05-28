"""Convert a (large) PDF into a small, commit-friendly JSON + compressed images.

Run this LOCALLY on a PDF you've downloaded from Google Drive (the raw PDF
is too big for GitHub's 25 MB limit, but the extracted text JSON is tiny and
the images are recompressed down to web size). Commit the output folder;
the raw PDF stays on your machine.

Usage:
    python3 scripts/pdf_to_json.py path/to/file.pdf
    python3 scripts/pdf_to_json.py path/to/file.pdf --out data/my-doc \
        --max-dim 1400 --quality 80
    python3 scripts/pdf_to_json.py path/to/file.pdf --no-images   # text only

Output (default out dir = data/<pdf-stem>/):
    <out>/content.json        page-by-page text + image filenames + metadata
    <out>/images/pNNN_iM.jpg  embedded images, recompressed

Requires: pymupdf, Pillow   (pip install pymupdf Pillow)

To serve the images in the app, move <out>/images into
public/extracted/<name>/ and reference them by that path; otherwise they
just live in data/ for reference/parsing.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", type=Path, help="path to the source PDF")
    ap.add_argument("--out", type=Path, default=None, help="output directory")
    ap.add_argument("--max-dim", type=int, default=1400, help="cap image long side (px)")
    ap.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100")
    ap.add_argument("--min-image-px", type=int, default=200,
                    help="skip embedded images whose long side is under this")
    ap.add_argument("--no-images", action="store_true", help="extract text only")
    args = ap.parse_args()

    if not args.pdf.exists():
        sys.exit(f"No such file: {args.pdf}")

    out = args.out or Path("data") / args.pdf.stem.lower().replace(" ", "-")
    out.mkdir(parents=True, exist_ok=True)
    img_dir = out / "images"
    if not args.no_images:
        img_dir.mkdir(exist_ok=True)

    doc = fitz.open(args.pdf)
    seen_hashes: set[str] = set()
    pages_out = []
    total_images = 0
    for pi, page in enumerate(doc):
        text = page.get_text("text").strip()
        image_files: list[str] = []
        if not args.no_images:
            for ii, img_ref in enumerate(page.get_images(full=True)):
                info = doc.extract_image(img_ref[0])
                data = info["image"]
                w, h = info.get("width", 0), info.get("height", 0)
                if max(w, h) < args.min_image_px:
                    continue
                digest = hashlib.sha1(data).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                jpg = compress(data, args.max_dim, args.quality)
                if jpg is None:
                    continue
                fname = f"p{pi + 1:03d}_i{ii}.jpg"
                (img_dir / fname).write_bytes(jpg)
                image_files.append(f"images/{fname}")
                total_images += 1
        pages_out.append({
            "page": pi + 1,
            "text": text,
            "images": image_files,
        })
    doc.close()

    content = {
        "source": args.pdf.name,
        "pageCount": len(pages_out),
        "imageCount": total_images,
        "pages": pages_out,
    }
    (out / "content.json").write_text(json.dumps(content, indent=2))

    json_kb = (out / "content.json").stat().st_size / 1024
    print(f"Wrote {out / 'content.json'} ({json_kb:.0f} KB)")
    print(f"  {len(pages_out)} pages, {total_images} images -> {img_dir if not args.no_images else '(skipped)'}")
    print("\nCommit the output folder (NOT the raw PDF). To serve images in")
    print(f"the app, move {img_dir} into public/extracted/{out.name}/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
