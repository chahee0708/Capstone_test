/**
 * labelParser.js
 *
 * 역할: CLOVA OCR(General) 응답의 글자 조각(fields)을 식품 라벨 정보로 바꾼다.
 *       제품명, 식품유형, 기준량, 영양성분 9개, 100g당 환산값, 원재료, 함유 알레르기, 혼입 가능 성분
 *
 * 왜 글자 순서가 아니라 좌표를 쓰나:
 *   General OCR 은 글자를 사진 순서대로 주지 않는다.
 *   예) "식품유형 유통기한 후면표기일까지 캔디류" → "식품유형" 다음 글자는 값이 아니다.
 *   그래서 CLOVA 의 줄 단위(lineBreak)로 묶은 뒤, 라벨 오른쪽 값은 boundingPoly 좌표로 찾는다.
 *
 * 값 규칙:
 *   - 못 찾은 값은 0 이 아니라 null (0 으로 넣으면 판정이 틀어짐)
 *   - warnings 는 OCR 이 못 읽은 값 안내용으로만 쓴다
 *   - 영양성분은 단위까지 있어야 인정한다 → 오른쪽 % 숫자는 값으로 잡히지 않는다
 *   - 100g당 환산은 data_pipeline/clean_foods.py 의 to_per_100 과 같다 (값 × 100 ÷ 기준량, 사사오입)
 *   - ml 는 1ml = 1g 으로 계산한다 (팀 규칙)
 *
 * 줄이 나뉜 문구 (위아래 줄은 글자 순서가 아니라 좌표로 판단):
 *   - "우유, 밀," + "대두 함유" : 윗줄이 쉼표로 끝나면 이어서 하나의 함유 문구로 본다 (원재료에서는 제외)
 *   - "혼입" + "가능", "제조시" + "설에서" : 윗줄과 이어서 mayContain 문구를 찾는다
 *
 * mayContain: "혼입 가능" + "같은 제조시설에서 제조" 문구의 이름을 합쳐 중복 없이 넣는다
 *
 * 알레르기 이름 확인:
 *   allergenText, mayContain 의 이름이 프로젝트 알레르기 목록에 없으면 warnings 에 적는다.
 *   잘린 글자("돼지고" + "기 함유" → "기")를 놓치지 않기 위해서이며, 이름은 결과에서 빼지 않는다.
 *
 * 이번 변경: 새 파일
 *
 * 호출: backend/routes/ocr.js (POST /ocr/label)
 */

// 영양성분 정의. 키 이름은 foodService.getFoodNutrition 과 같다
const NUTRIENTS = [
  { key: "calories", name: "열량", unit: "kcal" },
  { key: "sodium", name: "나트륨", unit: "mg" },
  { key: "carbohydrate", name: "탄수화물", unit: "g" },
  { key: "sugar", name: "당류", unit: "g" },
  { key: "fat", name: "지방", unit: "g" },
  { key: "transFat", name: "트랜스지방", unit: "g" },
  { key: "saturatedFat", name: "포화지방", unit: "g" },
  { key: "cholesterol", name: "콜레스테롤", unit: "mg" },
  { key: "protein", name: "단백질", unit: "g" },
];

const NUMBER = "(\\d[\\d,]*(?:\\.\\d+)?)";

// 글자 사이 띄어쓰기를 허용하는 패턴 ("제 품 명", "트랜스 지방")
const spaced = (word) => [...word].join("\\s*");

// 영양성분 이름 + 숫자 + 단위 패턴
function nutrientPattern({ name, unit }) {
  // "지방" 은 "트랜스지방", "트랜스 지방", "포화지방", "포화 지방" 을 잡지 않게 앞을 막는다
  const guard =
    name === "지방" ? "(?<!트랜스\\s*)(?<!포화\\s*)(?<![가-힣])" : "(?<![가-힣])";
  return new RegExp(
    `${guard}${spaced(name)}\\s*[:：]?\\s*${NUMBER}\\s*${unit}(?![a-zA-Z])`,
    "i",
  );
}

// 원재료 영역이 끝나는 다음 항목들
const NEXT_LABEL =
  /^(포장재질|품목보고번호|유통기한|소비기한|업소명|제조원|판매원|보관방법|내용량|식품유형|제품명|반품|주의사항|영양정보)/;
// 영양성분 표 줄 (표가 원재료 바로 아래에 오는 라벨 대비)
const NUTRIENT_LINE = /^(나트륨|탄수화물|당류|지방|트랜스지방|포화지방|콜레스테롤|단백질|열량)\d/;

/** 글자 조각 → CLOVA lineBreak 기준 줄 목록 (줄마다 글자·좌표 포함) */
function toLines(fields) {
  const lines = [];
  let current = [];

  const flush = () => {
    if (current.length === 0) return;
    const points = current.flatMap((f) => f.boundingPoly?.vertices ?? []);
    const xs = points.map((p) => p.x ?? 0);
    const ys = points.map((p) => p.y ?? 0);
    const text = current.map((f) => f.inferText).join(" ");
    lines.push({
      text,
      compact: text.replace(/\s+/g, ""),
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    });
    current = [];
  };

  for (const field of fields) {
    current.push(field);
    if (field.lineBreak) flush();
  }
  flush();
  return lines;
}

const height = (line) => line.y1 - line.y0;
const centerY = (line) => (line.y0 + line.y1) / 2;
const labelPrefix = (label) => new RegExp(`^${spaced(label)}\\s*[:：]?\\s*`);

/** 라벨로 시작하는 줄 찾기 */
const findLabel = (lines, label) => lines.find((l) => l.compact.startsWith(label));

/** 라벨 바로 오른쪽, 같은 높이에 있는 줄 찾기 */
function rightNeighbor(lines, label) {
  const h = height(label);
  return lines
    .filter((l) => {
      if (l === label || NEXT_LABEL.test(l.compact)) return false;
      const gap = l.x0 - label.x1;
      const overlap = Math.min(l.y1, label.y1) - Math.max(l.y0, label.y0);
      return gap >= -5 && gap <= h * 3 && overlap >= Math.min(h, height(l)) * 0.5;
    })
    .sort((a, b) => a.x0 - b.x0)[0];
}

/** 라벨의 값: 같은 줄에 붙어 있으면 그 글자, 아니면 오른쪽 줄. 없으면 null */
function labelValue(lines, labelName) {
  const label = findLabel(lines, labelName);
  if (!label) return null;
  const inline = label.text.replace(labelPrefix(labelName), "").trim();
  if (inline) return inline;
  return rightNeighbor(lines, label)?.text.trim() ?? null;
}

const xOverlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);

/** 좌표상 바로 아랫줄 (가로로 겹치는 폭이 가장 큰 줄) */
function lineBelow(lines, line) {
  const h = height(line);
  return lines
    .filter((l) => {
      const gap = l.y0 - line.y1;
      return l !== line && l.y0 > line.y0 && gap >= -h * 0.4 && gap <= h * 0.6 && xOverlap(l, line) > 0;
    })
    .sort((a, b) => xOverlap(b, line) - xOverlap(a, line))[0];
}

/** 좌표상 바로 윗줄 (가로로 겹치는 폭이 가장 큰 줄) */
function lineAbove(lines, line) {
  const h = height(line);
  return lines
    .filter((l) => {
      const gap = line.y0 - l.y1;
      return l !== line && l.y0 < line.y0 && gap >= -h * 0.4 && gap <= h * 0.6 && xOverlap(l, line) > 0;
    })
    .sort((a, b) => xOverlap(b, line) - xOverlap(a, line))[0];
}

/** "1봉지(55 g)당", "100 g당", "총 내용량 165 g당" 같은 기준량 문구 찾기 */
function findBasis(lines, warnings) {
  const pattern = /((?:총\s*내용량\s*)?(?:\S*\()?(\d+(?:\.\d+)?)\s*(g|ml)\)?\s*당)/i;
  const found = lines
    .map((l) => l.text.match(pattern))
    .filter((m) => m && parseFloat(m[2]) > 0);

  if (found.length === 0) {
    // [추가] "총 내용량당" 처럼 숫자 없이 쓰인 기준량: 다른 줄의 "총 내용량 150g" / "중량 150 g" 에서 양을 가져온다
    //        예) 연세우유 솔티카라멜생크림빵: 표 머리 "총 내용량 150g", 열 제목 "총 내용량당"
    if (lines.some((l) => /총\s*내\s*용\s*량\s*당/.test(l.text))) {
      const total =
        lines.map((l) => l.text.match(/총\s*내\s*용\s*량\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|ml)/i)).find(Boolean) ||
        lines.map((l) => l.text.match(/(?:^|\s)(?:내\s*용\s*량|중\s*량)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|ml)/i)).find(Boolean);
      if (total && parseFloat(total[1]) > 0) {
        const amount = parseFloat(total[1]);
        const unit = total[2].toLowerCase();
        return { amount, unit, text: `총 내용량(${amount} ${unit})당` };
      }
    }
    warnings.push("기준량(예: 1봉지(55 g)당)을 찾지 못해 100g당 환산을 하지 못했습니다.");
    return null;
  }
  if (found.length > 1) {
    warnings.push(`기준량 문구가 여러 개라 첫 번째("${found[0][1]}")를 사용했습니다.`);
  }
  return {
    amount: parseFloat(found[0][2]),
    unit: found[0][3].toLowerCase(),
    text: found[0][1],
  };
}

/** 열량: "열량 184 kcal" 우선, 없으면 "당184kcal" 처럼 표 위 문구에서. 안내문 "2,000 kcal 기준" 은 제외 */
function findCalories(lines, pattern) {
  for (const line of lines) {
    const match = line.text.match(pattern);
    if (match) return match[1];
  }
  for (const line of lines) {
    if (/기준|비율/.test(line.text)) continue;
    const match = line.text.match(new RegExp(`${NUMBER}\\s*kcal`, "i"));
    if (match) return match[1];
  }
  return null;
}

/**
 * [추가] 표 모양 라벨에서 이름 칸과 값 칸이 다른 줄로 나뉜 경우의 값
 *   예) "나트륨"(x 341~382) 과 "310 mg"(x 426~482) 이 같은 높이에 따로 있음
 *   이름이 딱 그 영양성분인 줄을 찾고, 같은 높이(세로로 절반 이상 겹침) 오른쪽 줄 중
 *   "숫자 + 단위" 만 있는 가장 가까운 칸을 값으로 쓴다. 오른쪽 "16%" 칸은 단위가 달라 잡히지 않는다
 */
function rowValue(lines, { name, unit }) {
  const valueOnly = new RegExp(`^${NUMBER}\\s*${unit}$`, "i");
  for (const nameLine of lines.filter((l) => l.compact === name)) {
    const h = height(nameLine);
    const cell = lines
      .filter((l) => {
        if (l === nameLine || l.x0 < nameLine.x1 - 2) return false;
        const overlap = Math.min(l.y1, nameLine.y1) - Math.max(l.y0, nameLine.y0);
        return overlap >= Math.min(h, height(l)) * 0.5 && valueOnly.test(l.text.trim());
      })
      .sort((a, b) => a.x0 - b.x0)[0];
    if (cell) return cell.text.trim().match(valueOnly)[1];
  }
  return null;
}

/** 영양성분 9개 원본값. 못 찾으면 null + warnings */
function findNutrition(lines, warnings) {
  const nutrition = {};
  for (const nutrient of NUTRIENTS) {
    const pattern = nutrientPattern(nutrient);
    let raw;
    if (nutrient.key === "calories") {
      raw = findCalories(lines, pattern);
    } else {
      raw =
        lines.map((l) => l.text.match(pattern)).find(Boolean)?.[1] ??
        // [추가] 표 칸이 나뉘어 이름과 값이 다른 줄일 때: 같은 높이 오른쪽 칸에서 "숫자 + 단위"
        rowValue(lines, nutrient);
    }
    nutrition[nutrient.key] = raw === null ? null : parseFloat(raw.replace(/,/g, ""));
    if (raw === null) warnings.push(`${nutrient.name} 값을 찾지 못했습니다.`);
  }
  return nutrition;
}

/** 값 × 100 ÷ 기준량, 소수 둘째 자리 사사오입. 소수 오차가 없도록 정수로 계산한다 */
function toPer100(value, amount) {
  if (value === null || value === undefined) return null;
  const scaledValue = BigInt(Math.round(value * 1000));
  const scaledAmount = BigInt(Math.round(amount * 1000));
  const numerator = scaledValue * 100n * 100n;
  const rounded = (2n * numerator + scaledAmount) / (2n * scaledAmount);
  return Number(rounded) / 100;
}

function toNutritionPer100g(nutritionRaw, basis) {
  const result = {};
  for (const { key } of NUTRIENTS) {
    result[key] = basis ? toPer100(nutritionRaw[key], basis.amount) : null;
  }
  return result;
}

// [변경] 괄호는 ( ) 뿐 아니라 [ ] { } 도 본다 ("식물성크림[팜핵경화유(인도네시아산), 물엿]" 이 한 원재료)
const OPEN_BRACKETS = "([{";
const CLOSE_BRACKETS = ")]}";

/** 괄호 안의 쉼표는 나누지 않고 쉼표로 나눈다 */
function splitTopLevel(text) {
  const items = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (OPEN_BRACKETS.includes(ch)) depth += 1;
    if (CLOSE_BRACKETS.includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，" || ch === "、") && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** 원재료명: 라벨 칸 안의 줄만 모아 다음 항목 전까지. 함유 문구는 빼고 쉼표로 나눈다 */
function findIngredients(lines, warnings, allergenLines) {
  const label = findLabel(lines, "원재료명");
  if (!label) {
    warnings.push("원재료명을 찾지 못했습니다.");
    return [];
  }

  const prefix = /^원\s*재\s*료\s*명(?:\s*및\s*함\s*량)?\s*[:：]?\s*/;
  const inline = label.text.replace(prefix, "").trim();
  const first = inline ? label : rightNeighbor(lines, label);
  if (!first) {
    warnings.push("원재료명을 찾지 못했습니다.");
    return [];
  }

  // 같은 칸의 줄만 사용: 첫 값의 오른쪽 끝보다 오른쪽에서 시작하는 줄(영양성분 표)은 제외
  const h = height(label);
  const candidates = lines
    .filter(
      (l) =>
        l !== label &&
        l.y0 >= label.y0 - h / 2 &&
        l.x0 >= label.x0 - h &&
        l.x0 <= first.x1,
    )
    .sort((a, b) =>
      Math.abs(centerY(a) - centerY(b)) < h / 2 ? a.x0 - b.x0 : a.y0 - b.y0,
    );

  // 쉼표로 끝나지 않은 줄바꿈은 단어가 잘린 것이므로 띄어쓰기 없이 붙인다 ("합" + "성향료")
  let text = inline;
  for (const line of candidates) {
    if (NEXT_LABEL.test(line.compact) || NUTRIENT_LINE.test(line.compact)) break;
    if (line.compact.includes("혼입")) break;
    // 괄호 밖의 "OO 함유" 문구에 속한 줄은 원재료가 아니라 알레르기 문구
    if (allergenLines.has(line)) continue;
    text += line.text.trim();
  }

  const ingredients = splitTopLevel(text);
  if (ingredients.length === 0) warnings.push("원재료명을 찾지 못했습니다.");
  return ingredients;
}

// 알레르기 표기 목록. 출처: data_pipeline/clean_foods.py 의 ALLERGEN_MAP, ALLERGEN_PREFIX_MAP
// (Neo4j Allergy 노드도 여기서 만들어진다. 파이프라인에 표기를 추가하면 여기도 같이 추가할 것)
const KNOWN_ALLERGENS = new Set([
  "계란", "달걀", "알류", "난류",
  "쇠고기", "소고기", "돼지고기", "닭고기",
  "굴", "홍합", "이산화황", "아황산류",
  "잣", "산양유", "우유", "대두", "밀", "땅콩",
  "새우", "토마토", "오징어", "호두", "게",
  "복숭아", "메밀", "고등어", "헤이즐넛",
]);

/** 목록에 있는 이름인지 (띄어쓰기와 뒤 괄호 무시. "알류(달걀)" → 알류, "조개류(굴)" → 조개류) */
function isKnownAllergen(name) {
  const base = name.replace(/\s+/g, "").replace(/\(.*\)$/, "");
  return KNOWN_ALLERGENS.has(base) || base.startsWith("조개류");
}

/** 문구 목록에서 패턴을 찾아 쉼표로 나눈 이름 배열로 */
function collectNames(texts, pattern, isExcluded = () => false) {
  const names = [];
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      if (isExcluded(match[1])) continue;
      for (const name of splitTopLevel(match[1])) {
        const cleaned = name
          .replace(/^\s*(?:이|본)\s*제품은\s*/, "")
          .replace(/\s*등$/, "")
          .trim();
        if (cleaned) names.push(cleaned);
      }
    }
  }
  return names;
}

/**
 * 함유 문구 모으기
 *   - "함" + "유" 처럼 잘린 줄은 띄어쓰기 없이 잇는다 ("포함" 은 제외)
 *   - 괄호 밖 문구는 윗줄이 쉼표로 끝나는 동안 위로 잇는다 ("우유, 밀," + "대두 함유")
 * @returns {{ texts: string[], memberLines: Set }} 문구 목록, 원재료에서 뺄 줄
 */
function findAllergenPhrases(lines) {
  const texts = [];
  const memberLines = new Set();

  for (const line of lines) {
    let text = line.text.trim();
    const members = [line];

    const below = lineBelow(lines, line);
    if (/(?<!포)함$/.test(text) && below?.compact.startsWith("유")) {
      text += below.text.trim();
      members.push(below);
    }
    if (!/(?<!포)함유/.test(text)) continue;

    // 괄호 안 문구("유크림(우유 함유)")는 원재료의 일부이므로 줄을 잇거나 빼지 않는다
    // 이름 뒤의 닫힌 괄호("조개류(굴) 함유")는 괄호 밖 문구로 본다
    if (/^(?:[^()]|\([^()]*\))*함유[.)]*$/.test(text.replace(/\s+/g, ""))) {
      let above = lineAbove(lines, line);
      while (
        above &&
        !members.includes(above) &&
        /[,，]$/.test(above.text.trim()) &&
        !NEXT_LABEL.test(above.compact) &&
        !above.compact.startsWith("원재료명")
      ) {
        text = `${above.text.trim()} ${text}`;
        members.push(above);
        above = lineAbove(lines, above);
      }
      members.forEach((m) => memberLines.add(m));
    }
    texts.push(text);
  }
  return { texts, memberLines };
}

/** "우유, 돼지고기 함유" → ["우유", "돼지고기"]. "무함유" 는 제외 */
function findAllergens(phrases, warnings) {
  const names = collectNames(
    phrases,
    /((?:[^()·•:：.]|\([^()]*\))*?)\s*(?<!포)함유(?![량된])/g,
    (text) => /무\s*$/.test(text),
  );
  if (names.length === 0) warnings.push("알레르기 '함유' 문구를 찾지 못했습니다.");
  return [...new Set(names)];
}

/** 위아래로 붙은 줄을 하나의 문단으로 잇는다. 마침표로 끝나거나 다음 항목이 나오면 끊는다 */
function toParagraphs(lines) {
  const used = new Set();
  const paragraphs = [];
  for (const line of [...lines].sort((a, b) => a.y0 - b.y0)) {
    if (used.has(line)) continue;
    used.add(line);
    const parts = [line.text.trim()];
    let current = line;
    while (!/[.。]$/.test(current.text.trim())) {
      const next = lineBelow(lines, current);
      if (!next || used.has(next) || NEXT_LABEL.test(next.compact)) break;
      used.add(next);
      parts.push(next.text.trim());
      current = next;
    }
    paragraphs.push(parts.join(" "));
  }
  return paragraphs;
}

const MAY_CONTAIN_PATTERNS = [
  // "복숭아 혼입 가능"
  /((?:[^()·•:：.]|\([^()]*\))*?)\s*혼\s*입\s*(?:가\s*능|될\s*수\s*있)/g,
  // "메밀, 땅콩을 사용한 제품과 같은 제조시설에서 제조"
  /((?:[^()·•:：.]|\([^()]*\))*?)\s*(?:을|를)?\s*(?:사\s*용\s*한\s*제\s*품[과을를]?\s*)?(?:같\s*은|동\s*일\s*한?)\s*제\s*조\s*시\s*설\s*에\s*서\s*제\s*조/g,
];

/** 혼입 가능 + 같은 제조시설 문구의 이름을 합친다. 문구가 없는 제품도 많으므로 warnings 에 넣지 않는다 */
function findMayContain(lines) {
  // 함유 문구의 이름이 섞이지 않도록 "함유" 에서 문단을 끊는다
  const paragraphs = toParagraphs(lines).flatMap((p) => p.split(/(?<!포)함유/));
  const names = MAY_CONTAIN_PATTERNS.flatMap((pattern) => collectNames(paragraphs, pattern))
    // 문단을 이으면 앞줄 글자가 섞일 수 있어 문구 바로 앞 낱말만 쓴다 (괄호 안 띄어쓰기는 낱말을 나누지 않게 제거)
    .map((name) => {
      const words = name.replace(/\([^()]*\)/g, (m) => m.replace(/\s+/g, "")).split(/\s+/);
      const last = words.pop();
      // [추가] 줄 끝에서 잘린 이름 잇기: "토" + "마토" → 토마토, "메" + "밀" → 메밀
      //        앞 낱말과 이은 것이 알레르기 이름이면 이은 것을 쓴다 ("밀" 처럼 혼자도 이름인 경우보다 우선)
      const joined = words.length ? words[words.length - 1] + last : null;
      return joined && isKnownAllergen(joined) ? joined : last;
    })
    .filter((name) => !name.includes("제품"));
  return [...new Set(names)];
}

/**
 * CLOVA 글자 조각 → 라벨 분석 결과
 * @param {Array} fields - CLOVA 응답 images[0].fields
 * @returns {object} POST /ocr/label 응답 본문
 */
function parseLabel(fields) {
  const safeFields = fields ?? [];
  const lines = toLines(safeFields);
  const warnings = [];

  const productName = labelValue(lines, "제품명");
  if (!productName) warnings.push("제품명을 찾지 못했습니다.");

  const foodType = labelValue(lines, "식품유형");
  if (!foodType) warnings.push("식품유형을 찾지 못했습니다.");

  const basis = findBasis(lines, warnings);
  const nutritionRaw = findNutrition(lines, warnings);
  const allergenPhrases = findAllergenPhrases(lines);
  const ingredients = findIngredients(lines, warnings, allergenPhrases.memberLines);
  const allergenText = findAllergens(allergenPhrases.texts, warnings);
  const mayContain = findMayContain(lines);

  // 목록에 없는 이름은 결과에 그대로 두고 경고만 추가한다
  const unknownAllergens = [...new Set([...allergenText, ...mayContain])].filter(
    (name) => !isKnownAllergen(name),
  );
  if (unknownAllergens.length > 0) {
    warnings.push(`알레르기 문구 일부를 정확히 읽지 못함: ${unknownAllergens.join(", ")}`);
  }

  return {
    productName,
    foodType,
    basis,
    nutritionRaw,
    nutritionPer100g: toNutritionPer100g(nutritionRaw, basis),
    ingredients,
    allergenText,
    mayContain,
    warnings,
    rawText: safeFields.map((f) => f.inferText).join(" "),
  };
}

/**
 * [추가] 이미 잘못 나뉜 원재료 목록을 괄호가 닫힐 때까지 다시 합친다
 *   예전 버전은 [ ] 안의 쉼표에서도 나눴다 → 저장해 둔 사진 결과를 다시 분석할 때 고쳐서 쓴다
 *   ["식물성크림[팜핵경화유", "물엿]", "설탕"] → ["식물성크림[팜핵경화유, 물엿]", "설탕"]
 */
function mergeBrokenIngredients(items) {
  const result = [];
  let current = null;
  let depth = 0;
  for (const raw of items) {
    const item = String(raw).trim();
    if (!item) continue;
    current = current === null ? item : `${current}, ${item}`;
    for (const ch of item) {
      if (OPEN_BRACKETS.includes(ch)) depth += 1;
      if (CLOSE_BRACKETS.includes(ch)) depth = Math.max(0, depth - 1);
    }
    if (depth === 0) {
      result.push(current);
      current = null;
    }
  }
  if (current !== null) result.push(current); // 끝까지 안 닫혔으면 그대로
  return result;
}

module.exports = { parseLabel, toPer100, mergeBrokenIngredients };
