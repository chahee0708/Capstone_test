"""
ingredient_corrector.py
- 역할: OCR 이 한 글자씩 틀리게 읽은 원재료명을 어휘 사전으로 바로잡는다.
         예) "아세설칼륨"→"아세설팜칼륨"(탈락은 제외), "아세설팔칼륨"→"아세설팜칼륨", "데스트린"→"덱스트린"
- 사전: data/ingredient_vocab.json  (식품 DB 의 원재료명과 제품 수, 약 8.7천 개)
- 원칙: 오탐(멀쩡한 단어를 다른 단어로 바꾸는 일)을 피하도록 아주 보수적으로 고친다.
    1) 사전에 이미 있는 단어는 건드리지 않는다.
    2) 글자 하나가 다른 "치환"만 고친다. (삽입/삭제는 "마늘분말"→"건마늘분말" 같은 오탐이 많아 제외)
    3) 바뀌는 글자는 자소(초성/중성/종성) 중 하나만 다른 경우로 제한한다. OCR 오독은 모양이 비슷한 글자로
       나타나므로("팔"↔"팜", "름"↔"륨") "말"→"홍" 같은 엉뚱한 치환을 걸러낸다.
    4) 후보는 충분히 흔한 단어(제품 수 MIN_COUNT 이상)이고 2등 후보보다 뚜렷하게 흔해야 한다.
    5) 4글자 미만, 숫자/영문이 섞인 토큰은 건드리지 않는다.
"""

from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Optional, Tuple

_VOCAB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "ingredient_vocab.json")

MIN_LEN = 4          # 이보다 짧은 토큰은 오탐 위험이 커서 고치지 않는다
MIN_COUNT = 12       # 후보 단어의 최소 출현 제품 수 (이보다 드문 단어는 "알려진 단어"로만 취급)
AMBIGUITY = 3.0      # 1등 후보가 2등보다 이 배수 이상 흔해야 한다
_HANGUL_RUN = re.compile(r"[가-힣]{%d,}" % MIN_LEN)

# 합성어를 만드는 흔한 앞/뒤 성분. 사전에는 "후추"만 있고 "후추분말"은 없는 경우처럼,
# "<사전 단어> + <성분>" 으로 이루어진 토큰은 정상 합성어로 보고 고치지 않는다.
_AFFIXES = {
    "분말", "가루", "분", "추출물", "추출액", "추출분말", "농축액", "농축분말", "농축", "엑기스", "시럽", "오일", "유",
    "즙", "과즙", "페이스트", "플레이크", "후레이크", "조각", "건조", "동결건조", "분태", "향", "향료", "염", "산",
    "탄산", "인산", "젖산", "구연산", "초산", "나트륨", "칼륨", "칼슘", "마그네슘", "철", "아연", "색소", "당", "전분",
    "단백", "단백질", "소스", "양념", "육수", "발효", "가공", "혼합", "정제", "건", "생", "볶은", "구운", "훈연",
}

_vocab: Optional[Dict[str, int]] = None
_index: Optional[Dict[str, List[str]]] = None


def _jamo(ch: str) -> Tuple[int, int, int]:
    code = ord(ch) - 0xAC00
    return code // 588, (code % 588) // 28, code % 28


def _similar_syllable(a: str, b: str) -> bool:
    """두 음절이 자소(초성/중성/종성) 하나만 다르다."""
    ja, jb = _jamo(a), _jamo(b)
    return sum(1 for x, y in zip(ja, jb) if x != y) == 1


def _load() -> None:
    global _vocab, _index
    if _vocab is not None:
        return
    try:
        with open(_VOCAB_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        raw = {}
    _vocab = {k: int(v) for k, v in raw.items() if re.fullmatch(r"[가-힣]+", k)}
    index: Dict[str, List[str]] = {}
    for w, c in _vocab.items():
        if c < MIN_COUNT or len(w) < MIN_LEN:
            continue
        for i in range(len(w)):
            index.setdefault(w[:i] + "?" + w[i + 1:], []).append(w)
    _index = index


def _is_compound(token: str) -> bool:
    """사전 단어(또는 흔한 성분) 두 개를 이어 붙인 정상 합성어인가. ("후추"+"분말", "탄산"+"칼륨")"""
    assert _vocab is not None
    for i in range(2, len(token) - 1):
        left, right = token[:i], token[i:]
        if (left in _vocab or left in _AFFIXES) and (right in _vocab or right in _AFFIXES):
            return True
    return False


def suggest(token: str) -> Optional[str]:
    """사전에 없는 한글 토큰에 대한 보정 후보 하나. 확신이 없으면 None."""
    _load()
    assert _vocab is not None and _index is not None
    if len(token) < MIN_LEN or token in _vocab or _is_compound(token):
        return None
    cands = set()
    for i, ch in enumerate(token):
        for w in _index.get(token[:i] + "?" + token[i + 1:], ()):
            if w[i] != ch and _similar_syllable(ch, w[i]):
                cands.add(w)
    if not cands:
        return None
    ranked = sorted(cands, key=lambda w: -_vocab[w])
    best = ranked[0]
    if len(ranked) > 1 and _vocab[best] < AMBIGUITY * _vocab[ranked[1]]:
        return None
    return best


def correct(text: str) -> Tuple[str, List[Dict[str, str]]]:
    """원재료명 문자열 → (보정된 문자열, [{"from","to"}…])"""
    if not text:
        return text, []
    _load()
    changes: List[Dict[str, str]] = []

    def repl(m: "re.Match[str]") -> str:
        tok = m.group(0)
        fixed = suggest(tok)
        if fixed and fixed != tok:
            changes.append({"from": tok, "to": fixed})
            return fixed
        return tok

    return _HANGUL_RUN.sub(repl, text), changes


# 원재료명 문단이 아닌 글(영양성분표, 제조/판매 정보, 고객센터 문구 …)에 흔한 단어
_NOISE = re.compile(
    r"나트륨|탄수화물|당류|열량|kcal|mg|고객|상담|소비자|반품|교환|전화|영양|기준치|제조|보관|유통|판매|포장|재질|품목|"
    r"신고|주소|공장|소비기한|유통기한|개인의|필요|다를\s*수"
)


def plausibility(text: str) -> float:
    """원재료명 문단다움 점수: 사전에 있는(또는 합성어인) 한글 단어의 글자 수에서 잡음 단어 벌점을 뺀다.

    같은 영역을 서로 다른 방법으로 읽은 후보들 중 어느 쪽이 원재료명인지 고를 때 쓴다.
    """
    _load()
    assert _vocab is not None
    known = 0
    for tok in re.findall(r"[가-힣]{2,}", text):
        if tok in _vocab or _is_compound(tok):
            known += len(tok)
    return known - 6.0 * len(_NOISE.findall(text))


def known_ratio(text: str) -> float:
    """텍스트의 한글 단어(2자 이상) 가운데 사전에 있는(또는 합성어인) 글자 수의 비율 (0~1)."""
    _load()
    assert _vocab is not None
    toks = re.findall(r"[가-힣]{2,}", text or "")
    total = sum(len(t) for t in toks)
    if not total:
        return 0.0
    known = sum(len(t) for t in toks if t in _vocab or _is_compound(t))
    return known / total

