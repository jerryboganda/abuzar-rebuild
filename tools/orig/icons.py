"""Toolbar pictures of the original: cut the 16x16 icons out of a screenshot of its toolbar (tools/orig/crawl.ps1) and find them among the
bitmap resources of PBVM125.dll, whose name table gives the PowerBuilder stock name (`Save!`, `VCRNext!` ...).
usage: python -I icons.py <PBVM125.dll> <screenshot.png> [out.json]
"""
import json
import struct
import sys
import zlib


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    p = 8
    idat = b''
    while p < len(d):
        n, t = struct.unpack_from('>I4s', d, p)
        body = d[p + 8:p + 8 + n]
        if t == b'IHDR':
            w, h, depth, ctype, _, _, il = struct.unpack('>IIBBBBB', body)
        elif t == b'IDAT':
            idat += body
        p += 12 + n
    assert depth == 8 and il == 0 and ctype in (2, 6), (depth, ctype, il)
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    q = 0
    for _ in range(h):
        f = raw[q]
        line = bytearray(raw[q + 1:q + 1 + stride])
        q += 1 + stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if pa <= pb and pa <= pc else b if pb <= pc else c
                line[i] = (line[i] + pr) & 255
        rows.append([(line[i], line[i + 1], line[i + 2]) for i in range(0, stride, bpp)])
        prev = line
    return w, h, rows


def write_png(path, w, h, rows, alpha=None):
    raw = b''
    for y in range(h):
        raw += b'\x00' + b''.join(bytes(rows[y][x]) + (bytes([alpha[y][x]]) if alpha else b'') for x in range(w))

    def chunk(t, b):
        c = struct.pack('>I', len(b)) + t + b
        return c + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if alpha else 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def dib_pixels(dib):
    hs, w, h, planes, bpp = struct.unpack_from('<IiiHH', dib, 0)
    clr = struct.unpack_from('<I', dib, 32)[0] or (1 << bpp if bpp <= 8 else 0)
    pal = [(dib[hs + i * 4 + 2], dib[hs + i * 4 + 1], dib[hs + i * 4]) for i in range(clr)] if bpp <= 8 else []
    off = hs + clr * 4
    h = abs(h)
    row = ((w * bpp + 31) // 32) * 4
    px = []
    for y in range(h):
        base = off + (h - 1 - y) * row
        line = []
        for x in range(w):
            if bpp == 8:
                line.append(pal[dib[base + x]])
            elif bpp == 4:
                v = dib[base + x // 2]
                line.append(pal[(v >> 4) if x % 2 == 0 else (v & 15)])
            elif bpp == 24:
                b, g, r = dib[base + x * 3:base + x * 3 + 3]
                line.append((r, g, b))
            else:
                line.append((0, 0, 0))
        px.append(line)
    return w, h, px


def resources(path):
    sys.path.insert(0, r'C:\Users\Admin\AppData\Local\Temp\claude\C--Projects-Abuzar\a2ecef90-b6d2-4e2f-92d3-6c2ff880f87e\scratchpad')
    import pe_res
    res = pe_res.load(path)
    out = {}
    for (t, n), v in res.items():
        if t == 2 and len(v) > 40:
            w, h, px = dib_pixels(v)
            if (w, h) == (16, 16):
                out[n] = px
    return out


def art(px, bg):
    """bounding box (x0, y0, x1, y1) of the pixels that are not the background, and the cropped grid"""
    pts = [(x, y) for y, row in enumerate(px) for x, c in enumerate(row) if c != bg]
    if not pts:
        return None
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    return (x0, y0, x1, y1), [[px[y][x] for x in range(x0, x1 + 1)] for y in range(y0, y1 + 1)]


def toolbar_icons(w, h, rows):
    """the picture of every toolbar button: the toolbar sits between two etched lines (#a0a0a0 over #ffffff) under the menu bar"""
    bg = (240, 240, 240)
    top = next(y for y in range(20, 120) if rows[y][300] == (160, 160, 160) and rows[y + 1][300] == (255, 255, 255)) + 2
    y0 = top + 4
    cols = [any(rows[y][x] != bg for y in range(y0, y0 + 16)) for x in range(w)]
    out = []
    x = 8
    while x < 1500:
        if cols[x]:
            e = x
            while e + 2 < w and (cols[e] or cols[e + 1] or cols[e + 2]):
                e += 1
            if e - x >= 8:  # wider than a separator (2 px) or the gripper
                out.append((x, e - 1))
            x = e
        x += 1
    icons = []
    for x0, x1 in out:
        grid = [[rows[y][x] for x in range(x0, x1 + 1)] for y in range(y0 - 1, y0 + 17)]
        icons.append((x0, art(grid, bg)))
    return y0, icons


def similarity(a, b):
    """a, b: cropped art grids of the same size; colours may differ a little (the resource is 8-bit)"""
    if len(a) != len(b) or len(a[0]) != len(b[0]):
        return 0
    n = same = 0
    for ra, rb in zip(a, b):
        for ca, cb in zip(ra, rb):
            n += 1
            if sum(abs(p - q) for p, q in zip(ca, cb)) < 120:
                same += 1
    return same / n


if __name__ == '__main__':
    dll, shot = sys.argv[1], sys.argv[2]
    res = resources(dll)
    # the art of every 16x16 resource (background = its corner pixel)
    arts = {}
    for n, px in res.items():
        r = art(px, px[0][0])
        if r:
            arts[n] = r[1]
    w, h, rows = read_png(shot)
    y0, icons = toolbar_icons(w, h, rows)
    print('toolbar icons at y', y0, ':', len(icons))
    result = []
    for x0, a in icons:
        if a is None:
            continue
        bbox, grid = a
        scores = sorted(((similarity(grid, g), str(n)) for n, g in arts.items()), reverse=True)[:3]
        print(x0, 'size', len(grid[0]), 'x', len(grid), [(round(s, 2), n) for s, n in scores])
        result.append({'x': x0, 'best': scores[0][1], 'score': round(scores[0][0], 3)})
    if len(sys.argv) > 3:
        json.dump(result, open(sys.argv[3], 'w'))
