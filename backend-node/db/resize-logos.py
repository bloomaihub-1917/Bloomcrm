# -*- coding: utf-8 -*-
"""resize-logos.py — 로고 원본을 웹디렉토리용으로 내린다.

import-directory-logos.js가 만든 계획 파일(JSON)을 받아 그림만 처리한다.
DB 조회와 이름 대조는 그쪽이 하고, 여기서는 자르고 줄이고 저장만 한다 —
파이썬에 Postgres 드라이버가 없고, Node에는 이미지 라이브러리가 없어서
각자 할 수 있는 일만 맡는다.

    python db/resize-logos.py <계획파일.json>

계획 파일: [{"src": "원본 경로", "dst": "저장 경로(확장자 없음)"}, ...]
결과는 표준출력에 JSON 한 줄로 돌려준다.
"""
import io
import json
import os
import sys

from PIL import Image, ImageChops

# 화면에서는 24~34px로 쓴다. 고해상도 화면까지 고려해 160px로 두면 넉넉하다
# (원본은 인쇄용이라 17,870px짜리도 섞여 있다).
HEIGHT = 160


def trim(im):
    """빈 여백을 잘라낸다.

    원본마다 여백이 다르다. 그대로 두고 높이만 맞추면 여백이 넓은 로고가 작게
    보여, 같은 줄에 세웠을 때 크기가 들쭉날쭉하다.
    """
    if im.mode == 'RGBA':
        bbox = im.split()[3].getbbox()                      # 투명하지 않은 영역
    else:
        bg = Image.new(im.mode, im.size, im.getpixel((0, 0)))
        bbox = ImageChops.difference(im, bg).getbbox()      # 테두리와 다른 영역
    return im.crop(bbox) if bbox else im


def has_alpha(im):
    """실제로 투명한 화소가 있는지 본다.

    모드만 보면 안 된다 — RGBA로 저장했지만 전부 불투명한 파일이 흔하다.
    """
    if im.mode not in ('RGBA', 'LA', 'P'):
        return False
    return im.convert('RGBA').split()[3].getextrema()[0] < 250


def convert(src, dst_base):
    raw = Image.open(src)
    alpha = has_alpha(raw)
    im = trim(raw.convert('RGBA' if alpha else 'RGB'))
    if im.height > HEIGHT:
        im = im.resize((max(1, round(im.width * HEIGHT / im.height)), HEIGHT), Image.LANCZOS)

    # 투명한 로고는 PNG, 배경이 깔린 로고는 JPEG로 둔다. 투명도를 쓰지 않는
    # 그림을 PNG로 저장하면 한 장이 384KB까지 커진다(Thermo Fisher가 그랬다).
    if alpha:
        path, kw = dst_base + '.png', dict(format='PNG', optimize=True)
    else:
        path, kw = dst_base + '.jpg', dict(format='JPEG', quality=82, optimize=True, progressive=True)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, **kw)
    return {'path': path, 'w': im.width, 'h': im.height,
            'kb': round(os.path.getsize(path) / 1024), 'alpha': alpha}


def main():
    plan = json.load(io.open(sys.argv[1], encoding='utf-8'))
    out = []
    for item in plan:
        try:
            r = convert(item['src'], item['dst'])
        except Exception as e:                              # 한 장이 깨져도 나머지는 만든다
            r = {'error': '%s: %s' % (type(e).__name__, e)}
        r['order'] = item.get('order')
        out.append(r)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
