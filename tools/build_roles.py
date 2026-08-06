# -*- coding: utf-8 -*-
"""js/data_heroes.js 에 영웅 역할군을 붙인다.

역할은 게임 데이터(herodata_*_kokr.json)의 expandedRole 을 그대로 쓴다.
   전사 · 투사 · 치유사 · 지원가 · 근접 암살자 · 원거리 암살자
(예전 4분류 roles 는 «암살자» 하나에 38명이 몰려 고르는 데 도움이 안 된다.)

    python tools/build_roles.py [herodata_*.json]
"""
import json, re, sys, unicodedata
from pathlib import Path

HERO_JSON = Path(sys.argv[1]) if len(sys.argv) > 1 else \
    Path(r"D:\03-Fun\01_Game\03_claude\Hots_talent_build\herodata_97039_kokr.json")
TARGET = Path(__file__).resolve().parent.parent / "js" / "data_heroes.js"

def norm(s):
    """이름 비교용 — 공백·기호를 빼고 NFC 로 맞춘다 («리 리», «정예 타우렌 족장» 등)."""
    s = unicodedata.normalize("NFC", str(s or ""))
    return re.sub(r"[\s'’·.\-]", "", s).lower()

def main():
    data = json.loads(HERO_JSON.read_text(encoding="utf-8"))
    by_name = {norm(v["name"]): v.get("expandedRole") or "" for v in data.values()}

    src = TARGET.read_text(encoding="utf-8")
    entries = re.findall(r'\{icon:"[^"]+",\s*ko:"([^"]+)"', src)
    if not entries:
        entries = re.findall(r'ko:"([^"]+)"', src)
    missing = [k for k in entries if norm(k) not in by_name]
    print(f"뷰어 영웅 {len(entries)}명 · 게임 데이터 {len(by_name)}명 · 못 찾음 {len(missing)}")
    if missing:
        print("  못 찾은 이름:", missing)

    # 각 항목 뒤에 role 을 끼워 넣는다 (이미 있으면 갈아 끼운다)
    def add_role(m):
        whole, ko = m.group(0), m.group(1)
        role = by_name.get(norm(ko), "")
        whole = re.sub(r',\s*role:"[^"]*"', "", whole)
        return whole[:-1] + f', role:"{role}"' + "}"

    out = re.sub(r'\{icon:"[^"]+",\s*ko:"([^"]+)"[^}]*\}', add_role, src)
    if 'const HERO_ROLES' not in out:
        out = out.replace("const HERO_DB = [",
            "/* 역할군 — 게임 데이터의 expandedRole. 고르는 차례대로 늘어놓는다. */\n"
            "const HERO_ROLES = ['전사','투사','치유사','지원가','근접 암살자','원거리 암살자'];\n"
            "const HERO_DB = [")
    TARGET.write_text(out, encoding="utf-8", newline="\n")

    got = re.findall(r'role:"([^"]*)"', out)
    from collections import Counter
    print("붙은 역할:", dict(Counter(got)))
    print("빈 역할:", sum(1 for g in got if not g))

if __name__ == "__main__":
    main()
