# -*- coding: utf-8 -*-
"""홀드아웃 검증 — 위치 재구성이 얼마나 맞는지 «숫자로» 잰다.

왜 필요한가
  제약을 더할 때마다 「좋아진 것 같다」로 판단하면 반드시 틀린다.
  숫자가 줄면 채택, 늘면 폐기. 그 판단 장치를 먼저 만든다.

어떻게 정답을 얻는가
  게임 엔진이 계산한 진짜 좌표에는 접근할 수 없다. 하지만 리플레이 안에는
  엔진이 기록해 둔 참값이 이미 들어 있다 — 사망·부활 좌표는 오차 0 이다.
  그 일부를 «가리고» 맞히게 하면 외부 정답셋 없이 자체 완결된다. 비용 0.

무엇을 가리나
  «사망» 앵커만 가린다. 사망 좌표는 엔진이 남긴 참값이고 24건이 전부 다른 자리다.

  부활은 가리지 않는다. 부활 좌표 24건이 서로 다른 값 8개(양 팀 부활 지점)뿐이라
  «어디서 되살아나는지» 는 이미 아는 상수이고, 그 순간이동은 어떤 이동 모델도
  맞힐 수 없다. 가려 보니 오차가 100타일(맵 절반)로 나와 모델 비교가 무의미했다.

  15초 주기 위치 스냅샷(c)도 남긴다. 그것까지 가리면 30초 공백이 생겨 실제
  운영 조건(15초)보다 어려운 문제를 푸는 셈이라 오차가 과대평가된다.

  표본을 늘리려고 «하나씩 빼기»(leave-one-out)를 쓴다. 하나를 가리고 나머지
  전부로 재구성하기를 앵커 개수만큼 되풀이한다.

가리는 대상 두 가지 (--target)
  d  사망 앵커. 오차 0 인 참값이라 «절대 수치» 가 정직하다.
     다만 사망은 «전투가 끝나는 순간» 이라 표본이 한쪽으로 쏠린다.
     실제로 도달가능성 제약은 궤적을 바꾸는데도 사망 163건 중 0건에만 닿아
     «효과 없음» 처럼 보였다.
  c  15초 주기 위치 스냅샷. 경기 전체에 고르게 깔려 있어 «모델 비교» 에 낫다.
     대신 하나를 가리면 그 자리에 30초 공백이 생겨 실제 운영 조건(15초)보다
     어려운 문제를 푸는 셈이라 절대 오차는 과대평가된다.
     모든 모델이 똑같이 불리하므로 «어느 쪽이 나은가» 는 그대로 읽을 수 있다.

  python tools/evaluate.py                        # 사망 앵커 기준
  python tools/evaluate.py --target c --stride 3   # 스냅샷 기준 (3개마다 하나)
  python tools/evaluate.py --models linear --replay sky_temple
"""
import argparse, glob, math, statistics, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import recon_data                                          # noqa: E402
import recon_models                                        # noqa: E402


# 가릴 앵커 종류. 부활(r)은 절대 가리지 않는다 — 좌표가 양 팀 부활 지점 8개뿐이라
# 어떤 이동 모델도 맞힐 수 없는 순간이동이다 (가려 봤더니 오차 100타일).


# ── 계층 나누기 ─────────────────────────────────────────────────────
def gap_bucket(gap):
    """앞뒤 남은 앵커 사이의 공백 (초). 길수록 어려운 문제다."""
    if gap <= 8:   return "공백 짧음(≤8초)"
    if gap <= 20:  return "공백 중간(8~20초)"
    return "공백 긺(>20초)"


def phase_bucket(t, dur):
    if t < dur * 0.25:  return "초반"
    if t < dur * 0.65:  return "중반"
    return "후반"


def fight_bucket(t, deaths, window=12.0):
    """그 시각 ±window 안의 사망 수. 난전일수록 앵커가 촘촘해 쉬운 구간이다."""
    n = sum(1 for dt in deaths if abs(dt - t) <= window)
    return "한타(사망 3+)" if n >= 3 else ("교전(1~2)" if n >= 1 else "이동·라인전")


# ── 평가 ────────────────────────────────────────────────────────────
def evaluate_replay(path, model_names, target="d", stride=1):
    rep = recon_data.load_replay(path)
    walk = recon_data.walk_for(rep)
    tracks = rep["hero_position_tracks"]
    dur = max((max(p[0] for p in v) for v in tracks.values() if v), default=0)
    deaths = [p[0] for v in tracks.values() for p in v if len(p) > 3 and p[3] == "d"]

    rows = []
    for lab, pts in tracks.items():
        pts = sorted(pts, key=lambda p: p[0])
        cand = [i for i, p in enumerate(pts) if len(p) > 3 and p[3] == target]
        cand = cand[::stride]
        if not cand:
            continue
        for i in cand:                       # 하나씩 빼기
            kept = [p for j, p in enumerate(pts) if j != i]
            if len(kept) < 2:
                continue
            th, tx, ty = pts[i][0], pts[i][1], pts[i][2]
            before = max((p[0] for p in kept if p[0] <= th), default=None)
            after = min((p[0] for p in kept if p[0] >= th), default=None)
            gap = (after - before) if (before is not None and after is not None) else 999
            for name in model_names:
                traj = recon_models.MODELS[name](kept, rep, lab, walk, dur)
                px, py = traj(th)
                if px is None:
                    continue
                rows.append({
                    "model": name, "replay": Path(path).stem, "hero": lab, "t": th,
                    "err": math.hypot(px - tx, py - ty),
                    "gap": gap_bucket(gap), "phase": phase_bucket(th, dur),
                    "fight": fight_bucket(th, deaths),
                })
    return rows


def stats(errs):
    errs = sorted(errs)
    n = len(errs)
    if not n:
        return None
    return {
        "n": n,
        "평균": statistics.fmean(errs),
        "중앙": statistics.median(errs),
        "p95": errs[min(n - 1, int(round(n * 0.95)) - 1)],
    }


def table(rows, key, models, title):
    print(f"\n── {title} " + "─" * max(0, 58 - len(title)))
    groups = sorted({r[key] for r in rows})
    w = max(len(g) for g in groups) + 2
    print(" " * w + "".join(f"{m:>26}" for m in models))
    print(" " * w + "".join(f"{'표본  평균  중앙   p95':>26}" for _ in models))
    for g in groups:
        line = f"{g:<{w}}"
        for m in models:
            s = stats([r["err"] for r in rows if r[key] == g and r["model"] == m])
            line += (f"{s['n']:>6}{s['평균']:>6.2f}{s['중앙']:>6.2f}{s['p95']:>8.2f}"
                     if s else f"{'-':>26}")
        print(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", default="")
    ap.add_argument("--models", default=",".join(recon_models.MODELS))
    ap.add_argument("--target", default="d", choices=["d", "c"])
    ap.add_argument("--stride", type=int, default=1)
    a = ap.parse_args()

    files = sorted(glob.glob(str(ROOT / "samples" / "*.StormReplay")))
    if a.replay:
        files = [f for f in files if a.replay in f]
    models = [m.strip() for m in a.models.split(",") if m.strip() in recon_models.MODELS]

    rows = []
    for f in files:
        print(f"  … {Path(f).stem}", flush=True)
        rows += evaluate_replay(f, models, a.target, a.stride)

    if not rows:
        print("표본이 없습니다."); return

    what = "사망" if a.target == "d" else "위치 스냅샷"
    note = "" if a.target == "d" else "  ※ 스냅샷을 가리면 30초 공백이 생겨 절대 수치는 과대평가다 — 모델 «비교» 용"
    print(f"\n{'='*72}\n홀드아웃 검증 — 리플레이 {len(files)}판 · 가린 {what} 앵커 "
          f"{len(rows)//len(models)}개 (하나씩 빼기) · 단위 = 게임 타일{note}\n{'='*72}")
    print(f"\n{'모델':<22}{'표본':>7}{'평균':>8}{'중앙':>8}{'p95':>8}")
    for m in models:
        s = stats([r["err"] for r in rows if r["model"] == m])
        if s:
            print(f"{m:<22}{s['n']:>7}{s['평균']:>8.2f}{s['중앙']:>8.2f}{s['p95']:>8.2f}")

    table(rows, "gap", models, "앵커 공백별")
    table(rows, "fight", models, "상황별")
    table(rows, "phase", models, "경기 구간별")
    table(rows, "replay", models, "리플레이별")
    print("\np95 를 반드시 봐라 — 평균이 낮아도 p95 가 크면 «가끔 크게 틀린다»는 뜻이고,")
    print("재생기에서는 그 «가끔» 이 눈에 확 띈다.")


if __name__ == "__main__":
    main()
