#!/usr/bin/env python3
"""
Wrap every raw px/rem font-size in the app so it responds to the two runtime
CSS variables that back the Settings → UI → Misc text controls:

    --min-text    the minimum text size floor   (default 5px = app's smallest)
    --text-scale  a global multiplier            (default 1)

Every bare `font-size: <N>px|rem` (in CSS declarations AND in inline styles
inside JS templates) is rewritten to:

    font-size: max(var(--min-text, 5px), calc(<N>px * var(--text-scale, 1)))

and the --font-size-* design tokens in :root are wrapped the same way. `em`,
`%`, keyword, and `var(...)` font-sizes are left alone (em/% are parent- or
root-relative and ride along for free; tokens are handled here).

The transform is IDEMPOTENT: a wrapped declaration starts with `max(` (not a
digit), so re-running never double-wraps. Dynamic sizes (`font-size:${x}px`)
are left untouched.

Run from anywhere:  python3 util/scripts/scale_font_sizes.py [--check] [repo_root]

  --check   don't write; exit 1 if any file WOULD change (CI/pre-commit use).

tests/test_font_size_scaling.py enforces that this has been run, so an agent
who adds a raw font-size and forgets will be told by the failing test.
"""
import os
import re
import sys

# Files/dirs to process, relative to repo root.
CSS_GLOBS = ["ui/static/css"]
JS_GLOBS = ["ui/static/js"]
# Never rewrite these (test fixtures assert on literal strings; vendored libs).
EXCLUDE_DIRS = {"tests", "node_modules", "vendor", "lib"}

# A bare `font-size: <num><px|rem>` declaration NOT already wrapped.
#   (?<![\w-])  -> don't match inside --font-size-sm: etc.
#   (?!\s*\*)   -> the <num><unit> isn't the left operand of a calc() multiply
#                  (belt-and-suspenders; a wrapped value starts with `max(`
#                  anyway so the digit anchor already prevents re-matching).
BARE_RE = re.compile(r"(?<![\w-])font-size:\s*([0-9.]+)(px|rem)\b(?!\s*\*)")

# The --font-size-* design tokens (value is a bare px).
TOKEN_RE = re.compile(r"(--font-size-(?:sm|base|md|lg|xl)):\s*([0-9.]+px)\s*;")


def wrap(num_unit: str) -> str:
    return f"max(var(--min-text, 5px), calc({num_unit} * var(--text-scale, 1)))"


def transform_text(text: str, is_css: bool) -> tuple[str, int]:
    count = 0

    def _bare(m):
        nonlocal count
        count += 1
        return f"font-size: {wrap(m.group(1) + m.group(2))}"

    new = BARE_RE.sub(_bare, text)

    if is_css:
        def _token(m):
            nonlocal count
            count += 1
            return f"{m.group(1)}: {wrap(m.group(2))};"
        new = TOKEN_RE.sub(_token, new)

    return new, count


def iter_files(repo_root: str):
    for base in CSS_GLOBS:
        root = os.path.join(repo_root, base)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for fn in filenames:
                if fn.endswith(".css"):
                    yield os.path.join(dirpath, fn), True
    for base in JS_GLOBS:
        root = os.path.join(repo_root, base)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for fn in filenames:
                if fn.endswith(".js"):
                    yield os.path.join(dirpath, fn), False


def main():
    args = [a for a in sys.argv[1:]]
    check_only = "--check" in args
    args = [a for a in args if a != "--check"]
    repo_root = args[0] if args else os.getcwd()
    # Allow running from util/scripts/ or repo root.
    if not os.path.isdir(os.path.join(repo_root, "ui", "static")):
        guess = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        if os.path.isdir(os.path.join(guess, "ui", "static")):
            repo_root = guess

    changed_files = []
    total = 0
    for path, is_css in iter_files(repo_root):
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        new, count = transform_text(text, is_css)
        if new != text:
            changed_files.append((os.path.relpath(path, repo_root), count))
            total += count
            if not check_only:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new)

    if check_only:
        if changed_files:
            print("Unwrapped font-sizes found (run util/scripts/scale_font_sizes.py):")
            for rel, count in changed_files:
                print(f"  {rel}: {count}")
            sys.exit(1)
        print("OK: all font-sizes are scale-wrapped.")
        return

    if changed_files:
        print(f"Wrapped {total} font-size(s) across {len(changed_files)} file(s):")
        for rel, count in changed_files:
            print(f"  {rel}: {count}")
    else:
        print("No changes — everything already wrapped.")


if __name__ == "__main__":
    main()
