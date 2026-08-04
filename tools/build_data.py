# -*- coding: utf-8 -*-
"""데이터 파일 생성기 — 저장소 관리자용 (일반 사용자는 실행할 필요 없음).

만드는 것:
  js/py_bundle.js    py/*.py 를 base64 로 묶은 것 (브라우저 내 리플레이 파서)
  js/data_maps.js    맵 목록 + 월드 좌표 정렬값(캘리브레이션)
  js/data_samples.js samples/ 폴더의 예제 리플레이 목록

한 번만 하는 추출(--extract-legacy):
  기존 단일 파일 replay_tactics_viewer.html 에서 PY_FILES -> py/*.py,
  EMBEDDED -> js/demo_replay.js 를 꺼낸다.

캘리브레이션 원리:
  maps/*.svg 는 3D 뷰어(viewer3d.html)의 «미니맵 구도» 저장물이다.
  직교 투영 + 맵 중앙 + 여백 1.04배 규칙이라, 그림이 덮는 월드 범위는
    halfH = 1.04 * max(H/2, W/(2*aspect)),  halfW = halfH * aspect
    (aspect = 그림 가로/세로, W/H = 맵 격자 크기)
  로 정확히 역산된다. 뷰어는 이 L/R/B/T 로 배경을 좌표에 맞춰 깐다.
"""
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 맵 격자 크기 (게임 월드 단위) — 추출 파이프라인 02_parsed/index.json 과 같다.
MAPS = [
    # slug, 한국어명, 영어명, W, H, 난투 여부
    ("alterac_pass",             "알터랙 고개",      "Alterac Pass",             256, 216, False),
    ("battlefield_of_eternity",  "영원의 전쟁터",    "Battlefield of Eternity",  248, 208, False),
    ("blackheart_s_bay",         "블랙하트 항만",    "Blackheart's Bay",         256, 232, False),
    ("braxis_holdout",           "브락시스 항전",    "Braxis Holdout",           256, 216, False),
    ("cursed_hollow",            "저주받은 골짜기",  "Cursed Hollow",            256, 216, False),
    ("dragon_shire",             "용의 둥지",        "Dragon Shire",             248, 208, False),
    ("garden_of_terror",         "공포의 정원",      "Garden of Terror",         256, 216, False),
    ("hanamura_temple",          "하나무라 사원",    "Hanamura Temple",          256, 256, False),
    ("haunted_mines",            "유령 광산",        "Haunted Mines",            256, 256, False),
    ("infernal_shrines",         "불지옥 신단",      "Infernal Shrines",         248, 208, False),
    ("sky_temple",               "하늘 사원",        "Sky Temple",               248, 216, False),
    ("tomb_of_the_spider_queen", "거미 여왕의 무덤", "Tomb of the Spider Queen", 248, 216, False),
    ("towers_of_doom",           "파멸의 탑",        "Towers of Doom",           256, 216, False),
    ("volskaya_foundry",         "볼스카야 공장",    "Volskaya Foundry",         248, 208, False),
    ("warhead_junction",         "핵탄두 격전지",    "Warhead Junction",         256, 248, False),
    ("braxis_outpost",           "브락시스 전초기지","Braxis Outpost",           248, 216, True),
    ("industrial_district",      "공업 지구",        "Industrial District",      216, 248, True),
    ("lost_cavern",              "잃어버린 동굴",    "Lost Cavern",              248, 216, True),
    ("silver_city",              "은빛 도시",        "Silver City",              248, 216, True),
]
MARGIN = 1.04   # viewer3d batchCompose 의 여백 배수

# 개별 저장된 맵은 저장 당시 확대·이동이 걸려 있어 공식이 안 맞는다.
# 리플레이 구조물(코어·요새) 좌표를 그림에서 실측해 역산한 값으로 덮어쓴다.
CAL_OVERRIDE = {
    "braxis_outpost":      {"L": -3.6,  "R": 251.6, "B": 36.0, "T": 180.0},
    "lost_cavern":         {"L": -2.0,  "R": 250.0, "B": 35.8, "T": 177.8},
    "silver_city":         {"L": -32.8, "R": 281.9, "B": 17.5, "T": 194.9},
    "industrial_district": {"L": -23.5, "R": 238.0, "B": 49.2, "T": 196.5},
}


def svg_size(path):
    """SVG 선언 크기(width/height 속성)를 읽는다."""
    with open(path, "rb") as fp:
        head = fp.read(500).decode("utf-8", "replace")
    m = re.search(r'width="([\d.]+)" height="([\d.]+)"', head)
    if not m:
        raise SystemExit(f"SVG 크기를 못 읽음: {path}")
    return float(m.group(1)), float(m.group(2))


def build_maps():
    rows = []
    for slug, ko, en, W, H, brawl in MAPS:
        path = os.path.join(ROOT, "maps", f"{slug}.svg")
        if not os.path.isfile(path):
            print(f"  경고: maps/{slug}.svg 없음 — 건너뜀")
            continue
        iw, ih = svg_size(path)
        aspect = iw / ih
        half_h = MARGIN * max(H / 2, W / (2 * aspect))
        half_w = half_h * aspect
        cal = CAL_OVERRIDE.get(slug) or {
            "L": round(W / 2 - half_w, 2), "R": round(W / 2 + half_w, 2),
            "B": round(H / 2 - half_h, 2), "T": round(H / 2 + half_h, 2)}
        rows.append({
            "slug": slug, "ko": ko, "en": en, "brawl": brawl,
            "file": f"maps/{slug}.svg", "W": W, "H": H, "cal": cal,
        })
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    out = ("// 자동 생성 — tools/build_data.py. 직접 고치지 말 것.\n"
           "// cal = 배경 그림이 덮는 게임 월드 범위 [L..R] x [B..T]\n"
           "const MAP_DB = [\n" + body + "\n];\n")
    write(os.path.join(ROOT, "js", "data_maps.js"), out)


def build_py_bundle():
    files = {}
    py_dir = os.path.join(ROOT, "py")
    for name in sorted(os.listdir(py_dir)):
        if name.endswith(".py"):
            with open(os.path.join(py_dir, name), "rb") as fp:
                files[name] = base64.b64encode(fp.read()).decode()
    out = ("// 자동 생성 — tools/build_data.py 가 py/*.py 를 묶은 것. 직접 고치지 말 것.\n"
           "const PY_FILES = " + json.dumps(files) + ";\n")
    write(os.path.join(ROOT, "js", "py_bundle.js"), out)


def build_samples():
    rows = []
    slug2 = {m[0]: m for m in MAPS}
    d = os.path.join(ROOT, "samples")
    for name in sorted(os.listdir(d)):
        if not name.lower().endswith(".stormreplay"):
            continue
        slug = os.path.splitext(name)[0]
        m = slug2.get(slug)
        kb = os.path.getsize(os.path.join(d, name)) // 1024
        rows.append({"file": f"samples/{name}",
                     "ko": m[1] if m else slug, "kb": kb})
    out = ("// 자동 생성 — tools/build_data.py. 직접 고치지 말 것.\n"
           "const SAMPLE_DB = " + json.dumps(rows, ensure_ascii=False, indent=1) + ";\n")
    write(os.path.join(ROOT, "js", "data_samples.js"), out)


def extract_legacy():
    """기존 단일 파일에서 py 소스와 데모 리플레이를 꺼낸다 (한 번만)."""
    legacy = os.path.join(ROOT, "replay_tactics_viewer.html")
    text = open(legacy, encoding="utf-8").read()

    m = re.search(r"^const PY_FILES = (\{.*?\});$", text, re.M)
    files = json.loads(m.group(1))
    os.makedirs(os.path.join(ROOT, "py"), exist_ok=True)
    for name, b64 in files.items():
        with open(os.path.join(ROOT, "py", name), "wb") as fp:
            fp.write(base64.b64decode(b64))
        print(f"  py/{name}")

    m = re.search(r"^const EMBEDDED = (\{.*?\});$", text, re.M)
    raw = json.loads(m.group(1))
    out = ("// 첫 화면용 데모 리플레이 (저주받은 골짜기).\n"
           "// tools/build_data.py --extract-legacy 로 기존 단일 파일에서 추출했다.\n"
           "const DEMO_REPLAY = " + json.dumps(raw, ensure_ascii=False) + ";\n")
    write(os.path.join(ROOT, "js", "demo_replay.js"), out)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(text)
    print(f"  {os.path.relpath(path, ROOT)}  {os.path.getsize(path)/1024:.0f} KB")


if __name__ == "__main__":
    if "--extract-legacy" in sys.argv:
        extract_legacy()
    build_py_bundle()
    build_maps()
    build_samples()
