# -*- coding: utf-8 -*-
"""maps/*.svg 의 «가벼운 판»을 maps_lite/ 에 만든다 — 저장소 관리자용.

전장 SVG 한 장이 10MB 다. 안에 13920x7848 짜리 WebP 가 통째로 박혀 있어서인데,
평소 보기에는 과하다 (휴대폰에서 맵 하나 볼 때마다 10MB 를 받는다).
여기서는 그 그림만 줄여 다시 넣는다. 골격·viewBox·글씨는 원본 그대로라
좌표 규약과 정렬값(cal)이 원본과 완전히 같다 — 뷰어가 둘을 바꿔 껴도 안 어긋난다.

    python tools/make_lite_maps.py [가로폭]      기본 3480 (SVG 선언 크기와 같음)
"""
import base64
import io
import os
import re
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "maps")
DST = os.path.join(ROOT, "maps_lite")
QUALITY = 82

RASTER = re.compile(r'href="data:image/(webp|png|jpeg);base64,([^"]+)"')


def shrink(b64, target_w):
    im = Image.open(io.BytesIO(base64.b64decode(b64)))
    w, h = im.size
    if w <= target_w:
        return None, (w, h), (w, h)
    # 곧장 resize 하면 1억 화소를 한 번에 훑어 느리다. 정수배로 먼저 줄이고 맞춘다.
    step = max(1, w // target_w)
    if step > 1:
        im = im.reduce(step)
    th = max(1, round(target_w * h / w))
    im = im.convert("RGB").resize((target_w, th), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=4)
    return base64.b64encode(buf.getvalue()).decode(), (w, h), (target_w, th)


def main():
    target_w = int(sys.argv[1]) if len(sys.argv) > 1 else 3480
    os.makedirs(DST, exist_ok=True)
    tot_src = tot_dst = 0
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".svg"):
            continue
        path = os.path.join(SRC, name)
        text = open(path, encoding="utf-8", errors="replace").read()
        m = RASTER.search(text)
        if not m:
            print(f"  {name}: 그림이 없어 건너뜀")
            continue
        b64, before, after = shrink(m.group(2), target_w)
        if b64 is None:
            print(f"  {name}: 이미 {before[0]}px 이라 그대로 복사")
            out = text
        else:
            out = text[:m.start()] + f'href="data:image/webp;base64,{b64}"' + text[m.end():]
        dst = os.path.join(DST, name)
        with open(dst, "w", encoding="utf-8", newline="\n") as fp:
            fp.write(out)
        s, d = os.path.getsize(path), os.path.getsize(dst)
        tot_src += s
        tot_dst += d
        print(f"  {name:34} {before[0]}x{before[1]} -> {after[0]}x{after[1]}   "
              f"{s/1048576:6.1f}MB -> {d/1048576:5.2f}MB")
    print(f"\n합계 {tot_src/1048576:.0f}MB -> {tot_dst/1048576:.0f}MB "
          f"({tot_src/max(1,tot_dst):.0f}배 감소)")


if __name__ == "__main__":
    main()
