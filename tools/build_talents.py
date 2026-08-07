# -*- coding: utf-8 -*-
"""특성 표와 아이콘을 만든다 — 게임 데이터의 talentId 로 «정확히» 맞춘다.

    js/data_talents.js   내부명(talentId) -> {ko: 한국어명, lv: 티어, ic: talents/<ic>.webp}
    talents/             특성 아이콘 (44px WebP)

리플레이의 TalentChosen 이 적어 주는 이름은 게임 데이터의 talentId 와 «같다».
예전 판은 특성 이름을 짐작해 맞췄는데(내부명 정규화·접두어 제거·접미 일치),
리플레이 40판의 특성 1108종 중 400종(36%)을 놓쳤다. 놓친 것은 화면에서
금색 빈 네모로 나온다. talentId 로 맞추면 1108종 전부 붙는다 (실측).

    python tools/build_talents.py
"""
import json, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(r"D:\03-Fun\01_Game\03_claude\image")
DATA = SRC / "data" / "herodata_97650_kokr.json"
ICONS = SRC / "images" / "abilitytalents"
OUT = ROOT / "talents"
ICON_PX, ICON_Q = 44, 82


def main():
    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    table, want = {}, set()
    for hero in items.values():
        for lv, arr in (hero.get("talents") or {}).items():
            tier = int(lv.replace("Level", ""))
            for a in arr:
                tid, icon = a.get("talentId"), a.get("icon")
                if not tid:
                    continue
                stem = Path(icon).stem if icon and (ICONS / icon).is_file() else ""
                table[tid] = {"ko": a.get("name") or tid, "lv": tier, "ic": stem}
                if stem:
                    want.add(icon)

    OUT.mkdir(exist_ok=True)
    for f in sorted(OUT.glob("*.webp")):
        f.unlink()
    for f in sorted(want):
        im = Image.open(ICONS / f).convert("RGBA")
        if max(im.size) > ICON_PX:
            im = im.resize((ICON_PX, ICON_PX), Image.LANCZOS)
        im.save(OUT / (Path(f).stem + ".webp"), "WEBP", quality=ICON_Q, method=4)

    js = ("// 자동 생성 — tools/build_talents.py. 직접 고치지 말 것.\n"
          "// 리플레이의 TalentChosen 이름(= 게임 데이터의 talentId) -> 한국어명·티어·아이콘.\n"
          "// 짐작이 아니라 게임 데이터의 id 로 맞춘 것이라 빠지는 특성이 없다.\n"
          "const TALENT_DB = " + json.dumps(table, ensure_ascii=False, separators=(",", ":")) + ";\n")
    (ROOT / "js" / "data_talents.js").write_text(js, encoding="utf-8", newline="\n")

    mb = sum(f.stat().st_size for f in OUT.iterdir()) / 1e6
    print(f"특성 {len(table)}개 · 아이콘 {len(want)}개 ({mb:.1f}MB) · "
          f"js/data_talents.js {len(js)/1024:.0f} KB")
    no = [k for k, v in table.items() if not v["ic"]]
    if no:
        print(f"아이콘이 없는 특성 {len(no)}개: {no[:6]}")


if __name__ == "__main__":
    main()
