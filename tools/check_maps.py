# -*- coding: utf-8 -*-
"""전장별 «리플레이가 제대로 붙는가» 점검.

리플레이가 적어 주는 전장 이름(m_title)이 내장 전장 목록과 맞아떨어지는지,
그리고 영웅 좌표가 그 전장의 격자 안에 들어오는지 확인한다.
이름은 맞았는데 좌표가 범위를 벗어나면 정렬값(cal)이나 격자 크기가 틀린 것이다.

    python tools/check_maps.py [리플레이_폴더]
"""
import glob, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import recon_data                                            # noqa: E402


def norm(s):
    s = unicodedata.normalize("NFC", str(s or "")).lower()
    return re.sub(r"[^a-z0-9가-힣]", "", s)


def match_map(name):
    """js/maps.js 의 matchMap 과 같은 규칙 — 그대로 / 괄호 뗀 것 / 부분 일치."""
    raw = str(name or "")
    maps = recon_data._maps()
    for c in (raw, re.sub(r"[([{（【].*$", "", raw)):
        n = norm(c)
        if not n:
            continue
        for m in maps:
            if n in (norm(m["ko"]), norm(m["en"]), norm(m["slug"])):
                return m
    n = norm(raw)
    for m in maps:
        if n and (norm(m["ko"]) in n or norm(m["en"]) in n):
            return m
    return None


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "sample_replay")
    files = sorted(glob.glob(str(Path(folder) / "*.StormReplay")))
    if not files:
        print(f"리플레이가 없습니다: {folder}"); return

    # 전장 이름별로 한 판씩만 (같은 전장을 248번 열 필요는 없다)
    picked, seen = [], set()
    for f in files:
        key = norm(re.sub(r"^[\d.\- ]+", "", Path(f).stem))
        if key in seen:
            continue
        seen.add(key); picked.append(f)
    print(f"리플레이 {len(files)}개 중 서로 다른 이름 {len(picked)}개를 연다\n")

    rows, by_map = [], defaultdict(int)
    for f in picked:
        try:
            rep = recon_data.load_replay(f)
        except Exception as e:
            rows.append((Path(f).stem[:34], "?", "✘ 열기 실패", str(e)[:40])); continue
        title = rep.get("map") or ""
        m = match_map(title)
        by_map[m["slug"] if m else "(못 찾음)"] += 1
        if not m:
            rows.append((title[:24], "-", "✘ 전장 못 찾음", "배경 없이 좌표만 그린다")); continue

        # 좌표가 그 전장 격자 안에 들어오나
        pts = [p for v in rep["hero_position_tracks"].values() for p in v]
        if not pts:
            rows.append((title[:24], m["slug"], "△ 위치 없음", "")); continue
        xs = [p[1] for p in pts]; ys = [p[2] for p in pts]
        W, H = m["W"], m["H"]
        out = sum(1 for p in pts if not (0 <= p[1] < W and 0 <= p[2] < H))
        note = f"x {min(xs):.0f}~{max(xs):.0f} / y {min(ys):.0f}~{max(ys):.0f}  격자 {W}x{H}"
        mark = "✔" if out == 0 else f"✘ 범위 밖 {out}/{len(pts)}"
        rows.append((title[:24], m["slug"], mark, note))

    w = max(len(r[0]) for r in rows) + 2
    print(f"{'리플레이가 말하는 전장':<{w}}{'붙은 전장':<22}{'판정':<16}비고")
    print("─" * (w + 74))
    for a, b, c, d in sorted(rows):
        print(f"{a:<{w}}{b:<22}{c:<16}{d}")

    maps = recon_data._maps()
    covered = {s for s in by_map if s != "(못 찾음)"}
    missing = [m for m in maps if m["slug"] not in covered]
    ok = sum(1 for r in rows if r[2] == "✔")
    print(f"\n검사 {len(rows)}개 · 정상 {ok}개 · 문제 {len(rows)-ok}개")
    if missing:
        print(f"\n리플레이가 없어 확인 못 한 전장 {len(missing)}개:")
        for m in missing:
            print(f"   {m['ko']} ({m['slug']})")


if __name__ == "__main__":
    main()
