# -*- coding: utf-8 -*-
"""js/data_pathing.js 를 만든다 — 전장별 «걸을 수 있는 칸» 격자.

출처는 3D 파이프라인이 구운 MAP3D.edge 텍스처다. 그 g 채널이 «통행 불가 영역
안쪽»이라 0.5 를 넘으면 못 가는 자리다 (뷰어의 «통행 불가» 레이어가 쓰는 그것).

좌표 규약(실측으로 확정): 텍스처 v 축이 게임 y 와 반대다. 즉
    텍스처 행 = (H - 1 - 게임y) / H * 텍스처높이
검증 방법: 영웅이 «실제로 서 있던 자리»(스폰·전투 스냅샷·부활 좌표)가
통행 가능으로 나와야 한다. 저주받은 골짜기 99.1%, 잃어버린 동굴 100%.

    python tools/build_pathing.py
"""
import base64
import io
import json
import os
import re
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(ROOT)
P3D = os.path.join(BASE, "hots_minimap_view", "output", "3d")
THR = 0.5              # g 채널 문턱 — 이 값을 넘으면 통행 불가
MARGIN = 1             # 벽 쪽으로 한 칸 더 막는다 (영웅 반지름 대신)


def walk_grid(slug, W, H):
    """(H x W) 불리언. True = 걸을 수 있음. 3D 데이터가 없으면 None."""
    path = os.path.join(P3D, slug + ".js")
    if not os.path.isfile(path):
        return None
    text = open(path, encoding="utf-8", errors="replace").read()
    d = json.loads(text[text.index("{"):].rstrip().rstrip(";"))
    if "edge" not in d:
        return None
    g = np.asarray(Image.open(io.BytesIO(
        base64.b64decode(d["edge"].split(",", 1)[1])))) [:, :, 1] / 255.0
    ty, tx = g.shape
    rows = (((H - 1 - np.arange(H)) + 0.5) / H * ty).astype(int).clip(0, ty - 1)
    cols = ((np.arange(W) + 0.5) / W * tx).astype(int).clip(0, tx - 1)
    grid = g[np.ix_(rows, cols)] < THR
    if MARGIN:
        # 벽에 붙은 칸도 막아 «벽을 스치며 지나가는» 경로를 줄인다.
        blocked = ~grid
        pad = np.pad(blocked, MARGIN, constant_values=True)
        near = np.zeros_like(blocked)
        for dy in range(-MARGIN, MARGIN + 1):
            for dx in range(-MARGIN, MARGIN + 1):
                near |= pad[MARGIN + dy:MARGIN + dy + blocked.shape[0],
                            MARGIN + dx:MARGIN + dx + blocked.shape[1]]
        grid = grid & ~near
    return grid


def pack(grid):
    """행 우선으로 1비트씩 담아 base64 로. True(통행 가능) = 1."""
    return base64.b64encode(np.packbits(grid.reshape(-1))).decode()


def main():
    maps_js = open(os.path.join(ROOT, "js", "data_maps.js"), encoding="utf-8").read()
    db = json.loads("[" + ",".join(
        re.findall(r"^\s*(\{.*\}),?$", maps_js, re.M)) + "]")
    rows, total = [], 0
    for m in db:
        grid = walk_grid(m["slug"], m["W"], m["H"])
        if grid is None:
            print(f"  {m['slug']:26} 3D 데이터 없음 — 건너뜀")
            continue
        b = pack(grid)
        total += len(b)
        rows.append(f'  "{m["slug"]}":"{b}"')
        print(f"  {m['slug']:26} {m['W']}x{m['H']}  "
              f"통행 {grid.mean()*100:4.1f}%  {len(b)/1024:5.1f} KB")
    out = os.path.join(ROOT, "js", "data_pathing.js")
    with open(out, "w", encoding="utf-8", newline="\n") as fp:
        fp.write("// 자동 생성 — tools/build_pathing.py. 전장별 «걸을 수 있는 칸».\n"
                 "// 행 우선 1비트/칸 (1=통행 가능) 을 base64 로 담았다. 크기는 MAP_DB 의 W x H.\n"
                 "const PATH_BITS = {\n" + ",\n".join(rows) + "\n};\n")
    print(f"\n  js/data_pathing.js  {os.path.getsize(out)/1024:.0f} KB "
          f"({len(rows)}개 전장)")


if __name__ == "__main__":
    main()
