"""bitmap_ops — raw bytes-level bitmap utilities for stats_report.

Bitmaps are stored as `bytes` (or `bytearray`). Bit position `i` is set iff
`item_ids.id == i`. Bit 0 is unused (item ids start at 1).
"""

from typing import Iterable, Tuple


def bitmap_size_bytes(max_id: int) -> int:
    """Return number of bytes needed to hold ids 0..max_id."""
    return (max_id + 1 + 7) // 8


def empty_bitmap(max_id: int) -> bytearray:
    return bytearray(bitmap_size_bytes(max_id))


def set_bit(bm: bytearray, idx: int) -> None:
    if 0 <= idx < len(bm) * 8:
        bm[idx // 8] |= 1 << (idx % 8)


def get_bit(bm: bytes, idx: int) -> bool:
    if idx < 0 or idx >= len(bm) * 8:
        return False
    return bool(bm[idx // 8] & (1 << (idx % 8)))


def iter_set_bits(bm: bytes) -> Iterable[int]:
    for byte_idx, byte in enumerate(bm):
        if byte == 0:
            continue
        for bit in range(8):
            if byte & (1 << bit):
                yield byte_idx * 8 + bit


def popcount(bm: bytes) -> int:
    return sum(bin(b).count("1") for b in bm)


def is_zero(bm: bytes) -> bool:
    return all(b == 0 for b in bm)


def _align(a: bytes, b: bytes) -> Tuple[bytes, bytes]:
    if len(a) == len(b):
        return a, b
    if len(a) < len(b):
        return a + b"\x00" * (len(b) - len(a)), b
    return a, b + b"\x00" * (len(a) - len(b))


def bitmap_and(a: bytes, b: bytes) -> bytes:
    a, b = _align(a, b)
    return bytes(x & y for x, y in zip(a, b))


def bitmap_or(a: bytes, b: bytes) -> bytes:
    a, b = _align(a, b)
    return bytes(x | y for x, y in zip(a, b))


def bitmap_xor(a: bytes, b: bytes) -> bytes:
    a, b = _align(a, b)
    return bytes(x ^ y for x, y in zip(a, b))


def bitmap_diff(curr: bytes, stored: bytes) -> Tuple[bytes, bytes]:
    """Return (added, removed) bitmaps.
    added = bits set in curr but not stored
    removed = bits set in stored but not curr
    """
    curr, stored = _align(curr, stored)
    added = bytes(c & ~s & 0xFF for c, s in zip(curr, stored))
    removed = bytes(s & ~c & 0xFF for c, s in zip(curr, stored))
    return added, removed


def bitmap_and_is_nonzero(a: bytes, b: bytes) -> bool:
    a, b = _align(a, b)
    return any((x & y) for x, y in zip(a, b))
