# -*- coding: utf-8 -*-
"""위치 재구성 모델들. 각 모델은 앵커를 받아 «시각 -> (x, y)» 함수를 돌려준다.

evaluate.py 가 앵커의 일부를 가리고 이 모델들에 넘겨, 가린 지점을 얼마나
맞히는지 잰다. 새 제약을 넣을 때마다 여기에 모델을 하나 더해 비교한다.

  anchor   [초, x, y, 출처]  출처: s=스폰 c=15초주기 d=사망 r=부활
  반환      f(t) -> (x, y) 또는 (None, None)
"""
import math

PDT = 0.1          # 시뮬레이션 간격 (초)
SPEED = 5.5        # 최대 이동속도 (타일/초)
SNAP_DIST = 10.0   # 이보다 멀면 부드럽게 끌지 않고 바로 옮긴다
CORR = 0.25        # 스냅샷 쪽으로 수렴하는 비율
AIM_R = 7.0        # 스킬 조준점에서 이 거리 안에 있었다고 본다


# ── 1. 선형 보간 (지시서 2번의 기준선) ───────────────────────────────
def linear(anchors, rep, lab, walk, dur):
    """아무 기교 없이 하드 앵커 사이를 직선으로 잇는다.

    이후 모든 개선은 이것보다 나아야 채택할 값어치가 있다.
    기준선 없이 개선하면 무엇이 도움이 됐는지 영영 모른다.
    """
    pts = sorted(anchors, key=lambda p: p[0])

    def f(t):
        if not pts:
            return None, None
        if t <= pts[0][0]:
            return pts[0][1], pts[0][2]
        if t >= pts[-1][0]:
            return pts[-1][1], pts[-1][2]
        lo, hi = 0, len(pts) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if pts[mid][0] <= t: lo = mid
            else: hi = mid
        a, b = pts[lo], pts[hi]
        span = b[0] - a[0]
        u = 0.0 if span <= 0 else (t - a[0]) / span
        return a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u
    return f


# ── 2. 마지막 앵커 유지 ─────────────────────────────────────────────
def hold(anchors, rep, lab, walk, dur):
    """직전 앵커 자리에 그대로 서 있었다고 본다. 가장 단순한 하한선."""
    pts = sorted(anchors, key=lambda p: p[0])

    def f(t):
        if not pts:
            return None, None
        best = pts[0]
        for p in pts:
            if p[0] <= t: best = p
            else: break
        return best[1], best[2]
    return f


# ── 3. 지금 뷰어가 쓰는 모델 (js/engine.js buildPath 의 이식) ────────
def _merge(anchors, rep, lab):
    """앵커에 이동 명령(m)과 스킬 조준점(a)을 시간순으로 섞는다."""
    pts = [{"t": p[0], "x": p[1], "y": p[2],
            "src": p[3] if len(p) > 3 else "c"} for p in anchors]
    for t, x, y in (rep.get("movement_commands") or {}).get(lab, []):
        pts.append({"t": t, "x": x, "y": y, "src": "m"})
    for a in (rep.get("ability_aims") or {}).get(lab, []):
        pts.append({"t": a[0], "x": a[1], "y": a[2], "src": "a"})
    pts.sort(key=lambda p: p["t"])
    return pts


def viewer(anchors, rep, lab, walk, dur):
    """스냅샷 우선 + 이동 명령 + 지형 충돌. 길찾기는 «직선이 막히면 포기» 로 단순화했다.

    뷰어의 A* 까지 그대로 옮기면 평가가 매우 느려진다. 여기서는 벽에 막히면
    그 명령을 버리는 것으로 대신하고, 길찾기의 기여도는 따로 재기로 한다.
    """
    pts = _merge(anchors, rep, lab)
    n = int((dur + PDT) / PDT) + 1
    xs = [0.0] * n; ys = [0.0] * n; fl = [0] * n

    def can_go(x0, y0, x1, y1):
        if not walk:
            return True
        if not walk.walkable(x0, y0):
            # 이미 벽 칸에 서 있다면 (격자 오차) 빠져나오는 것은 막지 않는다
            return walk.walkable(x1, y1) or (int(x1) == int(x0) and int(y1) == int(y0))
        return walk.clear_line(x0, y0, x1, y1)

    cx = cy = 0.0; has = False
    tx = ty = 0.0; has_t = False
    sx = sy = 0.0; has_s = False; s_age = 0
    dead = False; last_fix = -1.0; i = 0

    first = next((p for p in pts if p["src"] not in ("m", "a")), None)
    if first:
        cx, cy, has = first["x"], first["y"], True

    for k in range(n):
        t = k * PDT
        while i < len(pts) and pts[i]["t"] <= t:
            p = pts[i]; i += 1
            s = p["src"]
            if s == "m":
                tx, ty, has_t, has_s = p["x"], p["y"], True, False
            elif s == "a":
                if has and not dead and p["t"] != last_fix:
                    dx, dy = p["x"] - cx, p["y"] - cy
                    d = math.hypot(dx, dy)
                    if d > AIM_R:
                        f = (d - AIM_R) / d
                        nx, ny = cx + dx * f, cy + dy * f
                        if can_go(cx, cy, nx, ny):
                            cx, cy = nx, ny
            elif s in ("s", "r"):
                cx, cy, has, dead, has_t, has_s, last_fix = p["x"], p["y"], True, False, False, False, p["t"]
            elif s == "d":
                cx, cy, has, dead, has_t, has_s, last_fix = p["x"], p["y"], True, True, False, False, p["t"]
            elif s == "c":
                if not has:
                    cx, cy, has, has_s = p["x"], p["y"], True, False
                elif math.hypot(p["x"] - cx, p["y"] - cy) > SNAP_DIST:
                    cx, cy, has_s = p["x"], p["y"], False
                else:
                    sx, sy, has_s, s_age = p["x"], p["y"], True, 0
                dead = False

        if has and not dead:
            if has_s:
                cx += (sx - cx) * CORR; cy += (sy - cy) * CORR
                if math.hypot(sx - cx, sy - cy) < 0.05:
                    cx, cy, has_s = sx, sy, False
                else:
                    s_age += 1
                    if s_age >= 15:      # 당기는 힘과 미는 힘이 맞서 교착되는 것을 끊는다
                        has_s = False
            if has_t:
                step = SPEED * PDT
                dx, dy = tx - cx, ty - cy
                d = math.hypot(dx, dy)
                if d <= step:
                    if can_go(cx, cy, tx, ty):
                        cx, cy = tx, ty
                    has_t = False
                else:
                    nx, ny = cx + dx / d * step, cy + dy / d * step
                    if can_go(cx, cy, nx, ny):
                        cx, cy = nx, ny
                    else:
                        has_t = False        # 벽에 막히면 명령을 버린다
        xs[k], ys[k], fl[k] = cx, cy, (2 if dead else (1 if has else 0))

    def f(t):
        if t <= 0: k = 0
        elif t >= (n - 1) * PDT: k = n - 1
        else: k = int(t / PDT)
        if not fl[k]:
            return None, None
        return xs[k], ys[k]
    return f


MODELS = {"hold": hold, "linear": linear, "viewer": viewer}
