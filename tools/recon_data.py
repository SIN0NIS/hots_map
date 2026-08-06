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


    # ── 길찾기 (js/pathing.js 의 이식) ────────────────────────────
    def nearest_walkable(self, x, y, max_r):
        """그 자리가 벽이면 가장 가까운 통행 칸으로 옮긴다."""
        if self.walkable(x, y):
            return x, y
        for r in range(1, int(max_r) + 1):
            best, bd = None, 1e18
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    nx, ny = int(x) + dx, int(y) + dy
                    if self.walkable(nx + 0.5, ny + 0.5):
                        d = dx * dx + dy * dy
                        if d < bd:
                            bd, best = d, (nx + 0.5, ny + 0.5)
            if best:
                return best
        return None

    def find_path(self, sx, sy, tx, ty, cap=9000):
        """8방향 A*. 옥타일 거리 휴리스틱. 뷰어와 같은 상한(9000칸)을 쓴다."""
        import heapq
        if self.grid is None:
            return None
        W, H = self.W, self.H
        s = self.nearest_walkable(sx, sy, 6)
        t = self.nearest_walkable(tx, ty, 14)
        if not s or not t:
            return None
        si = int(s[1]) * W + int(s[0])
        ti = int(t[1]) * W + int(t[0])
        if si == ti:
            return None
        tX, tY = ti % W, ti // W
        SQ2 = 2 ** 0.5
        DIRS = ((1,0,1.0),(-1,0,1.0),(0,1,1.0),(0,-1,1.0),
                (1,1,SQ2),(1,-1,SQ2),(-1,1,SQ2),(-1,-1,SQ2))
        g = {si: 0.0}
        prev = {}
        seen = set()
        def h(i):
            dx, dy = abs(i % W - tX), abs(i // W - tY)
            return (dx + dy) + (SQ2 - 2) * min(dx, dy)
        hq = [(h(si), si)]
        found = False
        steps = 0
        gw = self.grid
        while hq and steps < cap:
            steps += 1
            _, cur = heapq.heappop(hq)
            if cur == ti:
                found = True; break
            if cur in seen:
                continue
            seen.add(cur)
            cx, cy = cur % W, cur // W
            for dx, dy, w in DIRS:
                nx, ny = cx + dx, cy + dy
                if nx < 0 or ny < 0 or nx >= W or ny >= H:
                    continue
                ni = ny * W + nx
                if ni in seen or gw[ni] != 1:
                    continue
                # 대각선은 양옆이 다 뚫려 있을 때만 (벽 모서리를 뚫지 않게)
                if dx and dy and (gw[cy * W + cx + dx] != 1 or gw[(cy + dy) * W + cx] != 1):
                    continue
                ng = g[cur] + w
                if ng < g.get(ni, 1e18):
                    g[ni] = ng; prev[ni] = cur
                    heapq.heappush(hq, (ng + h(ni), ni))
        if not found:
            return None
        out = []
        i = ti
        while i != si:
            out.append((i % W + 0.5, i // W + 0.5))
            i = prev.get(i, si)
            if len(out) > W * H:
                return None
        out.reverse()
        return self._simplify(out)

    def _simplify(self, pts, look=24):
        """직선으로 갈 수 있는 구간은 뭉갠다 (칸 단위 지그재그 제거)."""
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        i = 0
        while i < len(pts) - 1:
            j = min(len(pts) - 1, i + look)
            while j > i + 1 and not self.clear_line(pts[i][0], pts[i][1], pts[j][0], pts[j][1]):
                j -= 1
            out.append(pts[j]); i = j
        return out


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
