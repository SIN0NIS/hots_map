# -*- coding: utf-8 -*-
"""재구성 실험용 자료 읽기 — 리플레이 앵커와 전장 통행 격자.

뷰어(js/)와 같은 자료를 파이썬에서 그대로 쓰기 위한 얇은 층이다.
자료를 두 벌 만들면 반드시 어긋나므로, 원본은 하나로 둔다:
  앵커     py/browser_extract.py        (뷰어와 완전히 같은 추출기)
  통행격자 js/data_pathing.js           (tools/build_pathing.py 가 만든 것)
  전장크기 js/data_maps.js
"""
import base64, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "py"))

import browser_extract                                    # noqa: E402


# ── 리플레이 ────────────────────────────────────────────────────────
def load_replay(path):
    """.StormReplay 하나를 뷰어와 똑같이 읽는다."""
    return json.loads(browser_extract.extract(str(path)))


# ── 전장 ────────────────────────────────────────────────────────────
_MAPS = None
_BITS = None

def _maps():
    global _MAPS
    if _MAPS is None:
        src = (ROOT / "js" / "data_maps.js").read_text(encoding="utf-8")
        # 머리말 주석에도 대괄호가 있다 ("[L..R] x [B..T]"). 선언에서 잘라야 한다.
        body = src[src.index("MAP_DB"):]
        body = body[body.index("["): body.rindex("]") + 1]   # 이미 키가 따옴표인 JSON
        _MAPS = json.loads(re.sub(r",\s*([\]}])", r"\1", body))
    return _MAPS


def _bits():
    global _BITS
    if _BITS is None:
        src = (ROOT / "js" / "data_pathing.js").read_text(encoding="utf-8")
        body = src[src.index("PATH_BITS"):]
        body = body[body.index("{"): body.rindex("}") + 1]
        _BITS = json.loads(body)
    return _BITS


def match_map(title):
    """리플레이의 전장 이름(한국어)으로 전장 항목을 찾는다."""
    t = re.sub(r"\s", "", str(title or ""))
    for m in _maps():
        if re.sub(r"\s", "", m.get("ko", "")) == t or m.get("slug") == title:
            return m
    return None


class Walk:
    """전장 통행 격자. walkable(x, y) 는 뷰어 js/pathing.js 와 같은 판정을 준다."""

    def __init__(self, slug, W, H):
        self.W, self.H, self.grid = W, H, None
        b64 = _bits().get(slug)
        if not b64:
            return
        raw = base64.b64decode(b64)
        bits = bytearray()
        for byte in raw:
            for k in range(7, -1, -1):
                bits.append((byte >> k) & 1)
        need = W * H
        if len(bits) >= need:
            self.grid = bits[:need]

    def __bool__(self):
        return self.grid is not None

    def walkable(self, x, y):
        if self.grid is None:
            return True
        i, j = int(x), int(y)
        if i < 0 or j < 0 or i >= self.W or j >= self.H:
            return False
        return self.grid[j * self.W + i] == 1

    def clear_line(self, x0, y0, x1, y1, step=0.1):
        """두 점 사이가 통행 가능한 칸으로만 이어지나 (뷰어의 clearLine 과 같은 표본 간격)."""
        if self.grid is None:
            return True
        dx, dy = x1 - x0, y1 - y0
        d = (dx * dx + dy * dy) ** 0.5
        if d < 1e-9:
            return self.walkable(x0, y0)
        n = max(1, int(d / step))
        for k in range(n + 1):
            u = k / n
            if not self.walkable(x0 + dx * u, y0 + dy * u):
                return False
        return True


def walk_for(replay):
    m = match_map(replay.get("map"))
    if not m:
        return Walk("", 0, 0)
    return Walk(m["slug"], m["W"], m["H"])


if __name__ == "__main__":
    import glob
    for f in sorted(glob.glob(str(ROOT / "samples" / "*.StormReplay"))):
        r = load_replay(f)
        w = walk_for(r)
        ok = sum(w.grid) / len(w.grid) * 100 if w else 0
        print(f"{Path(f).stem:<22} {r['map']:<14} 격자 {w.W}x{w.H} 통행 {ok:5.1f}%"
              f"  영웅 {len(r['hero_position_tracks'])}명  빌드 {r['build']}")
