"""
Rename public assets that use .png but contain JPEG magic bytes, then fix /brand/... references.
Run from repo root: python scripts/fix-jpeg-misnamed-as-png.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


def is_jpeg_bytes(path: Path) -> bool:
    return path.read_bytes()[:2] == b"\xff\xd8"


def main() -> None:
    pairs: list[tuple[str, str]] = []
    for p in sorted(PUBLIC.rglob("*.png")):
        if not is_jpeg_bytes(p):
            continue
        dest = p.with_suffix(".jpg")
        if dest.exists():
            print(f"skip (target exists): {dest}", file=sys.stderr)
            continue
        p.rename(dest)
        pairs.append((p.name, dest.name))
        print(f"renamed {p.relative_to(ROOT)} -> {dest.relative_to(ROOT)}")

    exts = {".tsx", ".ts", ".css", ".md", ".jsx", ".js", ".html", ".json"}
    for base in (ROOT / "src", ROOT / "public"):
        if not base.is_dir():
            continue
        for f in base.rglob("*"):
            if f.suffix.lower() not in exts:
                continue
            text = f.read_text(encoding="utf-8")
            new = text
            for old_name, new_name in pairs:
                new = new.replace(f"/brand/{old_name}", f"/brand/{new_name}")
            if new != text:
                f.write_text(new, encoding="utf-8")
                print(f"updated refs: {f.relative_to(ROOT)}")

    print(f"done; {len(pairs)} file(s) renamed.")


if __name__ == "__main__":
    main()
