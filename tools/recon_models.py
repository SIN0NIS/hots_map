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

# 무언가를 잡았을 때 «그 자리에서 이만큼 안에 있었다» 고 보는 거리 (타일).
# 자동공격 사거리보다 넉넉히 잡는다 — 스킬로도 막타를 치고, 장판·지속피해로
# 잡으면 이미 물러난 뒤일 수 있다. 좁게 잡으면 틀린 곳으로 끌어당긴다.
# 값은 짐작이 아니라 실측이다 — 막타 시각이 실측 스냅샷과 겹치는 표본에서
# «영웅과 막타 지점의 실제 거리» 를 재어 뽑았다:
#     근접  중앙 3.2 · p90 5.1 · 최대 5.4   -> 5.0 이면 거의 다 담는다
#     원거리 중앙 5.0 · p90 25.7 · 최대 27.1 -> 꼬리가 너무 길어 쓸 값이 없다
# 원거리는 스킬·소환물·지속피해로도 막타가 잡혀 20타일 밖에서도 «잡았다» 가 된다.
KILL_R = {"minion": 5.0, "merc": 5.0, "struct": 6.0, "hero": 6.0}
MELEE_ROLES = {"전사", "투사", "근접 암살자"}
MELEE_ONLY = True   # 원거리는 제약이 못 되므로 근접에만 건다


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
import json, re, pathlib

_ROLE = None

def hero_role(rep, lab):
    """이 라벨("닉네임(영웅)")의 영웅 역할군. 근접/원거리로 사거리를 가르는 데 쓴다."""
    global _ROLE
    if _ROLE is None:
        src = (pathlib.Path(__file__).resolve().parent.parent
               / "js" / "data_heroes.js").read_text(encoding="utf-8")
        body = src[src.index("HERO_DB"):]
        body = body[body.index("["): body.index("];") + 1]   # 배열의 «끝» 에서 자른다
        body = re.sub(r"(\w+):", r'"\1":', body)             # {ko:"x"} -> {"ko":"x"}
        body = re.sub(r",\s*([\]}])", r"\1", body)
        _ROLE = {h["ko"]: h.get("role", "") for h in json.loads(body)}
    m = re.search(r"\(([^)]+)\)$", lab)
    return _ROLE.get(m.group(1), "") if m else ""


def _merge(anchors, rep, lab, use_kills=(), cmds=True, aims=True):
    """앵커에 이동 명령(m)·스킬 조준점(a)·잡은 것(k)을 시간순으로 섞는다."""
    pts = [{"t": p[0], "x": p[1], "y": p[2],
            "src": p[3] if len(p) > 3 else "c"} for p in anchors]
    if cmds:
        for t, x, y in (rep.get("movement_commands") or {}).get(lab, []):
            pts.append({"t": t, "x": x, "y": y, "src": "m"})
    if aims:
        for a in (rep.get("ability_aims") or {}).get(lab, []):
            pts.append({"t": a[0], "x": a[1], "y": a[2], "src": "a"})
    if use_kills:
        melee = hero_role(rep, lab) in MELEE_ROLES
        if melee or not MELEE_ONLY:
            for k in (rep.get("kill_anchors") or {}).get(lab, []):
                if k[3] not in use_kills:
                    continue
                pts.append({"t": k[0], "x": k[1], "y": k[2], "src": "k",
                            "r": KILL_R.get(k[3], 5.0)})
    pts.sort(key=lambda p: p["t"])
    return pts


PATH_MIN_DIST = 14.0   # 이보다 가까우면 길찾기를 하지 않는다 (뷰어와 같은 값)

def viewer(anchors, rep, lab, walk, dur, use_kills=(), cmds=True, aims=True,
           terrain=True, astar=True):
    """스냅샷 우선 + 이동 명령 + 지형 충돌 + A* 길찾기 (js/engine.js buildPath 이식)."""
    pts = _merge(anchors, rep, lab, use_kills, cmds, aims)
    if not terrain:
        walk = None
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
    route = None; ri = 0
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
                route = None; ri = 0
            elif s in ("a", "k"):
                # 조준점·막타 지점 — «그 자리에서 R 안» 이므로, 그보다 멀면 R 까지 당긴다.
                # 같은 시각에 실측 스냅샷이 있었으면 그쪽이 사실이므로 건드리지 않는다.
                R = AIM_R if s == "a" else p.get("r", 6.0)
                if has and not dead and p["t"] != last_fix:
                    dx, dy = p["x"] - cx, p["y"] - cy
                    d = math.hypot(dx, dy)
                    if d > R:
                        f = (d - R) / d
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
                # 목적지가 벽 건너편이면 한 번만 길을 찾아 두고 그 경로를 따라간다
                if (astar and walk and route is None
                        and math.hypot(tx - cx, ty - cy) >= PATH_MIN_DIST
                        and not walk.clear_line(cx, cy, tx, ty)):
                    route = walk.find_path(cx, cy, tx, ty) or False
                    ri = 0
                step = SPEED * PDT
                retry = 2
                while step > 1e-6:
                    wp = route[ri] if (route and ri < len(route)) else (tx, ty)
                    dx, dy = wp[0] - cx, wp[1] - cy
                    d = math.hypot(dx, dy)
                    if d <= step:
                        if can_go(cx, cy, wp[0], wp[1]):
                            cx, cy = wp[0], wp[1]
                        elif retry > 0 and astar and walk:
                            retry -= 1
                            route = walk.find_path(cx, cy, tx, ty) or False
                            ri = 0
                            if route:
                                continue
                            has_t = False; break
                        else:
                            has_t = False; route = None; break
                        step -= d
                        if route and ri < len(route):
                            ri += 1
                            if ri >= len(route):
                                route = None; has_t = False; break
                        else:
                            has_t = False; break
                    else:
                        nx, ny = cx + dx / d * step, cy + dy / d * step
                        if can_go(cx, cy, nx, ny):
                            cx, cy = nx, ny
                        elif retry > 0 and astar and walk:
                            retry -= 1
                            route = walk.find_path(cx, cy, tx, ty) or False
                            ri = 0
                            if route:
                                continue
                            has_t = False
                        else:
                            has_t = False; route = None
                        break
        xs[k], ys[k], fl[k] = cx, cy, (2 if dead else (1 if has else 0))

    def f(t):
        if t <= 0: k = 0
        elif t >= (n - 1) * PDT: k = n - 1
        else: k = int(t / PDT)
        if not fl[k]:
            return None, None
        return xs[k], ys[k]
    return f


def _variant(**kw):
    """어블레이션 — 제약을 하나씩 끄거나 켜서 각각의 기여도를 잰다."""
    def f(anchors, rep, lab, walk, dur):
        return viewer(anchors, rep, lab, walk, dur, **kw)
    return f


MODELS = {
    "hold": hold,
    "linear": linear,
    "viewer": viewer,                                   # 지금 뷰어 (막타 앵커 없음)
    "+kill(근접)": _variant(use_kills={"minion", "merc", "struct", "hero"}),
    "-이동명령": _variant(cmds=False),
    "-스킬조준": _variant(aims=False),
    "-지형": _variant(terrain=False),
    "-길찾기": _variant(astar=False),
    "-전부(앵커만)": _variant(cmds=False, aims=False, terrain=False),
}
