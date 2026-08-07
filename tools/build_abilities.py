# -*- coding: utf-8 -*-
"""영웅별 스킬·초상화 표와 아이콘을 만든다 (관전 UI 식 상단바용).

만드는 것
  js/data_abilities.js   영웅 -> 초상화 파일 · 스킬 [칸, 이름, 아이콘, 쿨타임초]
  portraits/             큰 초상화 (관전 UI 왼쪽 큰 그림)
  abilities/             스킬 아이콘

원본은 D:\\03-Fun\\01_Game\\03_claude\\image (게임에서 뽑은 herodata + 아이콘).
특성 아이콘은 이미 talents/ 에 있으므로 건드리지 않는다.

    python tools/build_abilities.py
"""
import json, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(r"D:\03-Fun\01_Game\03_claude\image")
DATA = SRC / "data" / "herodata_97650_kokr.json"
ICONS = SRC / "images" / "abilitytalents"
PORTS = SRC / "images" / "heroportraits"

OUT_AB = ROOT / "abilities"
OUT_PT = ROOT / "portraits"

SLOT_ORDER = ["Q", "W", "E", "R", "Trait", "Active"]


def cd_sec(text):
    """«재사용 대기시간: 6초» -> 6.0 · 없으면 None (지속효과 등)"""
    m = re.search(r"([\d.]+)\s*초", str(text or ""))
    return float(m.group(1)) if m else None


def pick_portrait(hero):
    """관전 UI 왼쪽에 쓸 큰 초상화. 없으면 None."""
    for key in ("target", "draftScreen", "hero", "minimap"):
        f = (hero.get("portraits") or {}).get(key)
        if f and (PORTS / f).is_file():
            return f
    return None


def main():
    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    # 뷰어가 아는 영웅 이름만 (js/data_heroes.js)
    src = (ROOT / "js" / "data_heroes.js").read_text(encoding="utf-8")
    body = src[src.index("HERO_DB"):]
    body = body[body.index("["): body.index("];") + 1]
    body = re.sub(r"(\w+):", r'"\1":', body)
    body = re.sub(r",\s*([\]}])", r"\1", body)
    known = {h["ko"] for h in json.loads(body)}

    OUT_AB.mkdir(exist_ok=True); OUT_PT.mkdir(exist_ok=True)
    out, want_ic, want_pt, missing = {}, set(), set(), []

    for h in items.values():
        ko = h.get("name")
        if ko not in known:
            continue
        skills = []
        for grp, slot in (("Basic", None), ("Heroic", "R"), ("Trait", "Trait"),
                          ("Activable", "Active")):
            for a in (h.get("abilities") or {}).get(grp) or []:
                ic = a.get("icon")
                if not ic or not (ICONS / ic).is_file():
                    continue
                skills.append({
                    "s": a.get("abilityType") or slot or "?",
                    "n": a.get("name") or "",
                    "i": Path(ic).stem,
                    "cd": cd_sec(a.get("cooldownText")),
                })
                want_ic.add(ic)
        if not skills:
            missing.append(ko); continue
        skills.sort(key=lambda x: (SLOT_ORDER.index(x["s"]) if x["s"] in SLOT_ORDER else 9, x["n"]))
        pt = pick_portrait(h)
        if pt: want_pt.add(pt)
        out[ko] = {"p": Path(pt).stem if pt else None, "sk": skills}

    # 원본 PNG 는 합쳐서 14MB 가 넘는다. 화면에 뜨는 크기(스킬 44px · 초상화 96px)로
    # 줄여 WebP 로 굽는다 — 특성 아이콘과 같은 방식이다.
    def bake(src_dir, out_dir, names, px):
        for f in sorted(names):
            im = Image.open(src_dir / f).convert("RGBA")
            if max(im.size) > px:
                im = im.resize((px, px), Image.LANCZOS)
            im.save(out_dir / (Path(f).stem + ".webp"), "WEBP", quality=82, method=4)
    bake(ICONS, OUT_AB, want_ic, 44)
    bake(PORTS, OUT_PT, want_pt, 96)

    js = ("// 자동 생성 — tools/build_abilities.py. 직접 고치지 말 것.\n"
          "// 영웅 -> { p: portraits/<p>.webp, sk: [{s:칸(Q/W/E/R/Trait), n:이름, i:abilities/<i>.webp, cd:쿨타임초}] }\n"
          "// 쿨타임은 게임 데이터의 «기본값» 이다. 특성으로 줄어드는 것은 반영되지 않고,\n"
          "// 리플레이만으로는 «지금 몇 초 남았나» 를 알 수 없다 (아래 설명 참고).\n"
          "const ABIL_DB = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    (ROOT / "js" / "data_abilities.js").write_text(js, encoding="utf-8", newline="\n")

    mb = lambda p: sum(f.stat().st_size for f in p.iterdir()) / 1e6
    print(f"영웅 {len(out)}명 · 스킬 아이콘 {len(want_ic)}개 ({mb(OUT_AB):.1f}MB)"
          f" · 초상화 {len(want_pt)}개 ({mb(OUT_PT):.1f}MB)")
    print(f"js/data_abilities.js  {len(js)/1024:.0f} KB")
    if missing:
        print(f"스킬을 못 찾은 영웅 {len(missing)}명: {missing}")


if __name__ == "__main__":
    main()
