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

# 인쇄용 원본은 1억 화소를 넘기도 한다. Pillow는 그걸 공격으로 의심해 경고를
# 띄우는데, 우리 OneDrive에서 가져온 파일이라 믿을 수 있다.
Image.MAX_IMAGE_PIXELS = None

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


def open_vector(src):
    """ai·eps·pdf를 그림으로 펼친다.

    브라우저는 ai도 eps도 못 읽는데, 래스터를 아예 안 보낸 기업이 있다(Certara는
    'Certara logo.ai' 한 장뿐이었다). 일러스트레이터가 PDF 호환으로 저장한 ai는
    PDF 리더가 그대로 열 수 있어, 그걸로 펼쳐 쓴다.

    아트보드가 로고보다 훨씬 클 때가 많아(1920×1080 안에 작은 로고) 넉넉한
    배율로 펼친 뒤 여백을 자른다 — 작게 펼치면 자르고 나서 흐려진다.
    """
    import fitz                                   # PyMuPDF — 벡터일 때만 쓴다
    doc = fitz.open(src)
    page = doc[0]
    zoom = max(2.0, (HEIGHT * 6) / max(1.0, page.rect.height))
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    return Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)


def is_vector(path):
    return path.lower().endswith(('.ai', '.eps', '.pdf'))


def load(path):
    return open_vector(path) if is_vector(path) else Image.open(path)


def convert(src, dst_base, alt=None):
    raw = load(src)

    # 래스터가 쓸 높이보다 작으면 늘려 쓰게 되어 흐려진다. 같은 폴더의 벡터로
    # 갈아타면 얼마든 선명하게 펼칠 수 있다(Ultragenic이 보낸 png가 160×33).
    #
    # 단, 가로세로 비율이 비슷할 때만 갈아탄다. 같은 폴더의 벡터가 같은 로고의
    # 다른 버전인 경우가 있다 — 분당서울대병원은 래스터가 가로형(432×152)인데
    # ai는 세로형(113×160)이어서, 갈아타면 기업이 보낸 것과 다른 모양이 올라간다.
    # 비율은 여백을 자른 뒤에 견준다. 벡터는 아트보드가 로고보다 훨씬 커서
    # (1920×1080 안에 납작한 로고) 자르기 전 비율로는 늘 달라 보인다.
    if alt and not is_vector(src) and raw.height < HEIGHT:
        try:
            cand = load(alt)
            a, b = trim(raw.convert('RGBA')), trim(cand.convert('RGBA'))
            ratio = (b.width / b.height) / max(0.01, a.width / a.height)
            if 0.8 <= ratio <= 1.25:
                raw, src = cand, alt
        except Exception:
            pass
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
            'kb': round(os.path.getsize(path) / 1024), 'alpha': alpha,
            'used': os.path.basename(src), 'vector': is_vector(src)}


def main():
    plan = json.load(io.open(sys.argv[1], encoding='utf-8'))
    out = []
    for item in plan:
        try:
            r = convert(item['src'], item['dst'], item.get('altSrc'))
        except Exception as e:                              # 한 장이 깨져도 나머지는 만든다
            r = {'error': '%s: %s' % (type(e).__name__, e)}
        r['order'] = item.get('order')
        out.append(r)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
