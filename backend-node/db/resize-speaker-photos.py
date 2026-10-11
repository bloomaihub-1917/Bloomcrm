# -*- coding: utf-8 -*-
"""resize-speaker-photos.py — 연사 사진 원본을 CRM용 사본으로 줄인다.

import-speaker-photos.js가 원본 경로 목록(JSON)을 넘기면, 긴 변 800px JPEG로
줄여 base64로 돌려준다. 화면(js/api.js shrinkImage)이 손으로 올릴 때 하는 것과
같은 크기·품질이다.

    python db/resize-speaker-photos.py <목록.json>

목록: ["원본 경로", ...]
결과는 표준출력에 JSON 한 줄: [{"src", "data", "kb"} | {"src", "error"}, ...]
"""
import base64
import io
import json
import sys

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None   # 우리 OneDrive 원본이다 — 1억 화소짜리도 믿는다

MAX = 800


def shrink(src):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)   # 휴대폰 사진은 회전이 EXIF에만 적혀 있다
        if im.mode != 'RGB':
            bg = Image.new('RGB', im.size, (255, 255, 255))   # 투명 PNG가 검게 뜨지 않게
            im = im.convert('RGBA')
            bg.paste(im, mask=im.split()[-1])
            im = bg
        im.thumbnail((MAX, MAX), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=85, optimize=True)
        return buf.getvalue()


def main():
    with open(sys.argv[1], encoding='utf-8') as f:
        srcs = json.load(f)
    out = []
    for src in srcs:
        try:
            b = shrink(src)
            out.append({'src': src, 'data': base64.b64encode(b).decode('ascii'), 'kb': round(len(b) / 1024)})
        except Exception as e:  # 한 장이 깨져도 나머지는 만든다
            out.append({'src': src, 'error': str(e)})
    sys.stdout.write(json.dumps(out))


if __name__ == '__main__':
    main()
