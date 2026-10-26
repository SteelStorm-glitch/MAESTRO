#!/usr/bin/env python3
"""Draws the MAESTRO app icon (rounded dark tile + violet M) and writes a multi-size .ico."""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "desktop", "build", "icon.ico")
SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 4  # supersampling factor

BG = (17, 17, 20, 255)
ACCENT = (139, 139, 245, 255)


def in_rounded_rect(x, y, w, h, r):
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


M_POINTS = [
    (58, 198), (58, 58), (94, 58), (128, 116), (162, 58),
    (198, 58), (198, 198), (170, 198), (170, 104), (128, 180),
    (86, 104), (86, 198),
]


def in_polygon(x, y, points):
    inside = False
    n = len(points)
    j = n - 1
    for i in range(n):
        xi, yi = points[i]
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def render(size):
    w = h = size
    hi = size * SS
    scale = hi / 256.0
    buf = bytearray(w * h * 4)
    acc = [[0.0] * 4 for _ in range(w * h)]
    radius = 56 * scale

    for py in range(hi):
        for px in range(hi):
            x = px + 0.5
            y = py + 0.5
            if not in_rounded_rect(x, y, hi, hi, radius):
                continue
            color = ACCENT if in_polygon(x / scale, y / scale, M_POINTS) else BG
            # subtle vertical gradient in the tile
            if color == BG:
                t = (y / hi)
                color = (
                    int(14 + 10 * t),
                    int(14 + 8 * t),
                    int(18 + 14 * t),
                    255,
                )
            idx = (py // SS) * w + (px // SS)
            for c in range(4):
                acc[idx][c] += color[c]

    samples = SS * SS
    for i in range(w * h):
        a = acc[i][3] / samples
        if a <= 0:
            continue
        buf[i * 4 + 0] = min(255, int(acc[i][0] / samples))
        buf[i * 4 + 1] = min(255, int(acc[i][1] / samples))
        buf[i * 4 + 2] = min(255, int(acc[i][2] / samples))
        buf[i * 4 + 3] = min(255, int(a))
    return w, h, bytes(buf)


def png_bytes(w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def main():
    images = []
    for size in SIZES:
        w, h, rgba = render(size)
        images.append((size, w, h, png_bytes(w, h, rgba)))

    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = bytearray()
    blobs = bytearray()
    for size, w, h, data in images:
        entries.extend(struct.pack("<BBBBHHII", 0 if size >= 256 else size, 0 if size >= 256 else size,
                                   0, 0, 1, 32, len(data), offset))
        offset += len(data)
        blobs.extend(data)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(header + entries + blobs)
    print(f"icon written: {os.path.abspath(OUT)} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
