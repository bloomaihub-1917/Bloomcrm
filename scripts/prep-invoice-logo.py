"""인보이스 양식 1단계 — 로고를 미리 잘라 둔다.

받은 양식(2026 KIC Exhibition 인보이스(템플릿)_양식.xlsx)은 머리 로고를 엑셀의
자르기(srcRect)로 흰 여백을 감춰 두었다. 그런데 실행 시점에 쓰는 ExcelJS는
파일을 읽고 다시 쓸 때 이 자르기 정보를 버린다 — 그대로 두면 로고가 여백째로
같은 칸에 늘어나 찌그러진 채 인보이스가 나간다.

그래서 자르기를 파일에 굳혀 둔다. 이미지를 미리 잘라 넣고 srcRect를 지우면,
ExcelJS가 무엇을 버리든 로고는 처음 보이던 모습 그대로다.

    python scripts/prep-invoice-logo.py <원본.xlsx> <출력.xlsx>

이 결과를 scripts/build-invoice-template.js에 넣으면 Data/인보이스_양식.xlsx가 된다.
"""

import io
import re
import sys
import zipfile

from PIL import Image

LOGO = 'xl/media/image1.jpeg'
# srcRect은 10만분율이다. 원본 양식에 박혀 있던 값 그대로.
CROP = {'l': 13786, 't': 25000, 'r': 14397, 'b': 28358}


def main(src, dst):
    zin = zipfile.ZipFile(src)
    img = Image.open(io.BytesIO(zin.read(LOGO)))
    w, h = img.size
    box = (round(w * CROP['l'] / 100000), round(h * CROP['t'] / 100000),
           round(w * (100000 - CROP['r']) / 100000), round(h * (100000 - CROP['b']) / 100000))
    buf = io.BytesIO()
    img.crop(box).convert('RGB').save(buf, 'JPEG', quality=95)
    print(f'로고 {w}x{h} -> {img.crop(box).size}')

    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename == LOGO:
                data = buf.getvalue()
            elif it.filename.startswith('xl/drawings/drawing'):
                data = re.sub(rb'<a:srcRect[^/]*/>', b'', data)
            zout.writestr(it, data)
    print(f'wrote {dst}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
