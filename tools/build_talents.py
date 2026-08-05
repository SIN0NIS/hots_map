# -*- coding: utf-8 -*-
"""특성 표(js/data_talents.js)와 특성 아이콘(talents/)을 만든다 — 저장소 관리자용.

리플레이의 TalentChosen 이벤트는 특성을 «FenixMobileOffense» 같은 내부 이름으로
남긴다. 화면에 한국어 이름과 아이콘으로 보여주려면 게임 데이터의 특성 표가 필요하다.

    python tools/build_talents.py

원본은 이 저장소 밖의 파이프라인 산출물이라 경로를 여기서 찾는다. 없으면 알려주고 멈춘다.
아이콘은 표시 크기(약 22px)에 맞춰 44px WebP 로 줄여 담는다 — 21MB -> 약 1MB.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(ROOT)                     # ...\03_claude

HERODATA = os.path.join(BASE, "hots_github_date260725", "06_auto_encyclopedia",
                        "work", "herodata_97650_kokr.json")
ICON_DIRS = [os.path.join(BASE, "image", "images", "abilitytalents"),
             os.path.join(BASE, "hots_date260725", "02_auto_herodata",
                          "images", "abilitytalents")]
OUT_ICONS = os.path.join(ROOT, "talents")
ICON_PX = 44
ICON_Q = 80


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower()).replace("talent", "")


def collect_replay_names():
    """예제 리플레이와 데모에 실제로 나오는 특성 내부명을 모은다."""
    names = set()
    demo = os.path.join(ROOT, "js", "demo_replay.js")
    if os.path.isfile(demo):
        text = open(demo, encoding="utf-8").read()
        raw = json.loads(text[text.index("{"):text.rindex("}") + 1])
        names |= {e["PurchaseName"] for e in raw.get("timeline", [])
                  if e.get("e") == "TalentChosen" and e.get("PurchaseName")}
    sdir = os.path.join(ROOT, "samples")
    if os.path.isdir(sdir):
        sys.path.insert(0, os.path.join(ROOT, "py"))
        try:
            import browser_extract
        except Exception:
            return names
        for f in sorted(os.listdir(sdir)):
            if not f.lower().endswith(".stormreplay"):
                continue
            try:
                raw = json.loads(browser_extract.extract(os.path.join(sdir, f)))
            except Exception:
                continue
            names |= {e["PurchaseName"] for e in raw.get("timeline", [])
                      if e.get("e") == "TalentChosen" and e.get("PurchaseName")}
    return names


def shrink_icons(wanted):
    """쓰이는 아이콘만 작은 WebP 로 굽는다. 파일명은 확장자만 .webp 로 바꾼다."""
    from PIL import Image
    os.makedirs(OUT_ICONS, exist_ok=True)
    src = {}
    for d in ICON_DIRS:
        if os.path.isdir(d):
            for f in os.listdir(d):
                src.setdefault(f, os.path.join(d, f))
    made, missing, total = 0, [], 0
    for name in sorted(wanted):
        path = src.get(name)
        if not path:
            missing.append(name)
            continue
        out = os.path.join(OUT_ICONS, os.path.splitext(name)[0] + ".webp")
        im = Image.open(path).convert("RGBA")
        if im.size[0] > ICON_PX:
            im = im.resize((ICON_PX, ICON_PX), Image.LANCZOS)
        im.save(out, "WEBP", quality=ICON_Q, method=4)
        made += 1
        total += os.path.getsize(out)
    print(f"  talents/  아이콘 {made}개  {total/1048576:.1f} MB"
          + (f"  (원본 못 찾음 {len(missing)}개)" if missing else ""))
    return made


def main():
    if not os.path.isfile(HERODATA):
        raise SystemExit(f"영웅 데이터가 없다: {HERODATA}")
    data = json.load(open(HERODATA, encoding="utf-8"))

    # 리플레이의 PurchaseName 은 게임 데이터의 id 와 조금씩 다르다.
    #   KaelthasManaAddict             <-> KaelthasManaAddictTalent  (Talent 접미사)
    #   KaelthasHeroicAbilityPyroblast <-> KaelthasPyroblast         (HeroicAbility 삽입)
    #   ButcherMasteryRuthlessOnslaughtUnrelentingPursuit            (Mastery + 원능력명)
    # 그래서 정규화해 넣고, 못 찾으면 꼬리 일치까지 본다.
    lookup_tab, talents, icons = {}, {}, set()
    for hero in data.values():
        for level, arr in (hero.get("talents") or {}).items():
            lv = int(level.replace("level", ""))
            for t in arr:
                icon = t.get("icon") or ""
                if icon:
                    icons.add(icon)
                entry = {"ko": t.get("name", ""), "lv": lv,
                         "ic": os.path.splitext(icon)[0] if icon else ""}
                for k in ("nameId", "buttonId"):
                    if t.get(k):
                        talents.setdefault(t[k], entry)
                        lookup_tab.setdefault(norm(t[k]), entry)
                for a in (t.get("abilityTalentLinkIds") or []):
                    if a and ":" not in a:
                        lookup_tab.setdefault(norm(a) + norm(t.get("name", "")), entry)

    def lookup(name):
        n = norm(name)
        for cand in (n, n.replace("heroicability", ""), n.replace("mastery", "")):
            if cand in lookup_tab:
                return lookup_tab[cand]
        for k, v in lookup_tab.items():
            if len(k) > 8 and (n.endswith(k) or k.endswith(n)):
                return v
        return None

    # 리플레이에 실제로 나온 변형 이름도 미리 풀어 둔다
    extra = collect_replay_names()
    solved = 0
    for name in sorted(extra):
        if name in talents:
            solved += 1
            continue
        hit = lookup(name)
        if hit:
            talents[name] = hit
            solved += 1
    if extra:
        print(f"  예제 리플레이 특성 {len(extra)}종 중 {solved}종 해석 "
              f"({solved/len(extra)*100:.0f}%)")

    shrink_icons(icons)

    out = os.path.join(ROOT, "js", "data_talents.js")
    with open(out, "w", encoding="utf-8", newline="\n") as fp:
        fp.write("// 자동 생성 — tools/build_talents.py.\n"
                 "// 특성 내부명 -> {ko: 한국어명, lv: 티어 레벨, ic: talents/<ic>.webp}\n"
                 "// 리플레이의 TalentChosen.PurchaseName 이 이 표의 키다.\n"
                 "const TALENT_DB = "
                 + json.dumps(talents, ensure_ascii=False, separators=(",", ":"))
                 + ";\n")
    print(f"  js/data_talents.js  특성 {len(talents)}개  "
          f"{os.path.getsize(out)/1024:.0f} KB")


if __name__ == "__main__":
    main()
