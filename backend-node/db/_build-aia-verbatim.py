# -*- coding: utf-8 -*-
"""CV 원문을 절 단위로 그대로 잘라 JSON으로 만든다.

   앞서 내가 옮겨 적으면서 줄을 합치고 순서를 바꾸고, Chang의 강연 목록은
   13개 중 4개만 넣었다. 받은 자료를 우리가 고쳐 넣으면 무엇이 원문이었는지
   알 수 없게 되고, 프로그램북에 나갈 때 연사가 보낸 글과 달라진다.

   그래서 사람 손으로 옮기지 않는다. PDF에서 뽑은 텍스트를 절 머리글로
   잘라 그대로 쓴다. 줄 끝 공백만 떼고(PDF 추출이 남기는 것이라 원문이
   아니다) 나머지는 손대지 않는다.
"""
import io, json, os, re

SC = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..')
BASE = r'C:\Users\cdaky\AppData\Local\Temp\claude\C--Users-cdaky-MICE-Proposal-BloomCrm-v2\dab7d32d-3a6e-4501-b3d1-3ec17d329222\scratchpad'

def load(name):
    return io.open(os.path.join(BASE, name), encoding='utf-8').read().split('\n')

def section(lines, start, end):
    """start행(머리글) 다음부터 end행(다음 머리글) 앞까지."""
    body = [l.rstrip() for l in lines[start:end - 1]]
    while body and not body[0].strip():
        body.pop(0)
    while body and not body[-1].strip():
        body.pop()
    return '\n'.join(body)

chen = load('pdf1.txt')
chang = load('pdf4.txt')

CHEN = {
    'bio_profile_en':     section(chen, 20, 34),    # PROFESSIONAL PROFILE
    'bio_pro_en':         section(chen, 34, 93),    # PROFESSIONAL EXPERIENCE
    'bio_edu_en':         section(chen, 93, 100),   # EDUCATION
    'bio_credentials_en': section(chen, 100, 105),  # LICENSES & CREDENTIALS
    'bio_teaching_en':    section(chen, 105, 115),  # ACADEMIC & TEACHING
    'bio_affil_en':       section(chen, 115, 122),  # AFFILIATIONS & PUBLIC SERVICE
    'bio_pubs_en':        section(chen, 122, 163),  # PRESS & PUBLICATIONS
    'bio_awards_en':      section(chen, 163, 175),  # AWARDS & RECOGNITIONS
    'languages':          section(chen, 175, len(chen) + 1),
}
# 머리글 없이 맨 위에 있는 것 — 이름·연락처(1~9)와 핵심 역량(10~19)
CHEN_HEAD = section(chen, 1, 10)
CHEN_CORE = section(chen, 10, 20)

CHANG = {
    'bio_pro_en':         section(chang, 50, 58),   # EXPERIENCE
    'bio_teaching_en':    section(chang, 58, 65),   # TEACHING
    'bio_affil_en':       section(chang, 132, 137), # COMPETITION (심사위원)
    'bio_awards_en':      section(chang, 137, 143), # AWARD
}
# 여러 절을 한 칸에 담을 때는 원문 머리글을 그대로 남긴다 —
# 우리가 새로 지은 말로 묶으면 그것도 고쳐 적은 것이 된다.
CHANG['bio_pubs_en'] = '\n\n'.join([
    'LECTURE\n' + section(chang, 143, 161),
    'EXHIBITION\n' + section(chang, 161, 167),
    'MAGAZINE\n' + section(chang, 167, len(chang) + 1),
])
# 우리 칸에 자리가 없는 절 — 지우지 않고 메모에 원문 그대로
# 소속 기관(PEI) 소개 — 5~16행. 사람 프로필이 아니라 기관 소개라 경력 칸에
# 둘 수 없다. 원문 머리글이 없는 문단이라 어디서 온 글인지 우리가 적어 준다.
CHANG_PEI = 'Predesign Energy Innovation (CV 1쪽, 소속 기관 소개)\n' + section(chang, 4, 17)
CHANG_HEAD = section(chang, 1, 50)      # 이름·소속기관 소개·본인 프로필
CHANG_EXTRA = '\n\n'.join([
    'BUILT WORK\n' + section(chang, 65, 94),
    'PROJECT\n' + section(chang, 94, 132),
])

out = {
    'chen': CHEN, 'chen_head': CHEN_HEAD, 'chen_core': CHEN_CORE,
    'chang': CHANG, 'chang_head': CHANG_HEAD, 'chang_extra': CHANG_EXTRA,
    'chang_pei_note': CHANG_PEI,
}
io.open(os.path.join(os.path.dirname(__file__), '_aia-verbatim.json'), 'w', encoding='utf-8').write(
    json.dumps(out, ensure_ascii=False, indent=1))

for who, d in (('Chen', CHEN), ('Chang', CHANG)):
    print(f'\n══ {who}')
    for k, v in d.items():
        first = v.split('\n')[0][:52]
        print(f'  {k:20} {len(v):5}자 · {len(v.splitlines()):3}줄 · {first}')
print(f'\nchen_core {len(CHEN_CORE)}자 · chang_extra {len(CHANG_EXTRA)}자')
