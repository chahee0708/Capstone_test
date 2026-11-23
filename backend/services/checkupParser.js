/**
 * checkupParser.js
 *
 * 역할: CLOVA OCR(General) 글자 조각(fields) → 건강검진표 값 (이름, 나이·성별, 키·몸무게, 혈압, 혈당, 지질, 신장 수치)
 *
 * 쓰이는 곳: backend/routes/ocr.js (POST /ocr)
 *
 * 읽는 방법 (두 가지를 같이 쓴다)
 *   1. 좌표: 검사 이름 칸(예: "중성지방")과 같은 높이, 오른쪽에 있는 첫 숫자를 값으로 본다
 *      표 안의 글자는 OCR 이 읽는 순서가 뒤섞이기 때문 (예: "235 38 ... 중성지방 총콜레스테롤 ... 180 160")
 *      참고치("150미만", "100 - 125", "60 이상")는 값으로 잡지 않는다
 *   2. 글자 순서(예전 정규식): 좌표로 못 찾은 값만 채운다
 *
 * 양식 (테스트: backend/test/checkupParser.test.js)
 *   - 일반건강검진 결과통보서: "수검자 성명", "키(cm) 및 몸무게(kg) 170.2 / 68.5", "고혈압 (수축기/이완기) 142 / 92",
 *     공복혈당, 고밀도·저밀도 콜레스테롤, 중성지방, 신사구체여과율(e-GFR)
 *   - 건강검진 결과통보서 (Word 양식): "성 명", 신장 / 체중 따로, "혈압 (최고/최저) 142/92",
 *     식전혈당, HDL-콜레스테롤, 트리글리세라이드, (LDL-콜레스테롤), 혈청크레아티닌 (e-GFR 칸 없음)
 *
 * e-GFR 이 없고 크레아티닌·나이·성별이 있으면 CKD-EPI 2021 식으로 계산한다 (gfrEstimated: true)
 *
 * 값 범위를 벗어난 숫자는 버린다 (예: 키 100~230cm). 못 찾은 값은 null
 *
 * 변경:
 *   - [변경] 질환 추천: 검진표에 "제1형 당뇨병" 이 적혀 있으면 "2형 당뇨" 대신 "1형 당뇨" (2026-11-24)
 *       예전에는 식전혈당 126 이상이면 무조건 2형으로 추천해 1형 시연 계정도 2형이 됐다
 */

// [추가] Word 편집 기호(¶ 문단 표시)를 켠 채 찍으면 OCR 이 "←", "€", "↵" 로 읽는다
//        예) "신장←", "체중←" → 이름 칸으로 인식되지 않았다
const FORMAT_MARKS = /[←→↵↲¶€]/g;

// [추가] 1형 당뇨 진단명: "제1형 당뇨병", "1형당뇨", OCR 오인식 "제 l형 당 뇨" 등 ("2형" 은 걸리지 않는다)
const TYPE1_DIABETES = /[1lI|１]\s*형\s*당\s*뇨/;

// ── 글자 조각 좌표 ──────────────────────────────────────────
function toBoxes(fields) {
  return (fields ?? []).map((f) => {
    const v = f.boundingPoly?.vertices ?? [];
    const xs = v.map((p) => p.x ?? 0);
    const ys = v.map((p) => p.y ?? 0);
    const text = String(f.inferText ?? "");
    return {
      text,
      compact: text.replace(FORMAT_MARKS, "").replace(/\s+/g, ""),
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  });
}

// 값 칸: "170.2", "142/92", "118mg/dL" 처럼 숫자(+단위)만 있는 조각
const VALUE = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?(?:cm|kg|mmHg|mg\/dL|g\/dL|IU\/L|U\/L)?$/i;
// 숫자 바로 뒤에 오면 참고치 ("100 미만", "100 - 125", "60 이상")
const REFERENCE_NEXT = /^(미만|이상|이하|초과|[-~–])/;

/**
 * 이름 칸과 같은 줄, 오른쪽에 있는 숫자들 (왼쪽부터). "142/92" 는 숫자 두 개로 센다
 * 같은 줄: 세로 중심 차이가 이름 칸 높이의 0.75배 이내 (최소 12px)
 */
function numbersRightOf(boxes, label) {
  const tol = Math.max((label.y1 - label.y0) * 0.75, 12);
  const row = boxes
    .filter((b) => b !== label && b.x0 >= label.x1 - 2 && Math.abs(b.cy - label.cy) <= tol)
    .sort((a, b) => a.x0 - b.x0);
  const numbers = [];
  row.forEach((b, i) => {
    const m = b.compact.match(VALUE);
    if (!m) return;
    const next = row[i + 1];
    if (next && REFERENCE_NEXT.test(next.compact)) return; // 참고치
    numbers.push(Number(m[1]));
    if (m[2] !== undefined) numbers.push(Number(m[2]));
  });
  return numbers;
}

/** 이름 패턴에 맞는 칸들(위에서부터) 중 처음으로 숫자가 나오는 칸의 숫자들 */
function rowNumbers(boxes, pattern) {
  const labels = boxes.filter((b) => pattern.test(b.compact)).sort((a, b) => a.y0 - b.y0);
  for (const label of labels) {
    const numbers = numbersRightOf(boxes, label);
    if (numbers.length > 0) return { label, numbers };
  }
  return null;
}

const inRange = (v, min, max) => (typeof v === "number" && v >= min && v <= max ? v : null);

/** 좌표로 찾은 값들 (못 찾으면 null) */
function readByPosition(boxes) {
  const out = {};

  // 키·몸무게: 한 칸("키(cm) 및 몸무게(kg) 170.2 / 68.5") 또는 두 줄("신장 170.2 cm" / "체중 68.5 kg")
  const hw = rowNumbers(boxes, /^(키|신장)(\(cm\))?e?$/);
  if (hw) {
    out.height = inRange(hw.numbers[0], 100, 230);
    const sameRowWeight = boxes.some(
      (b) => /^(몸무게|체중)/.test(b.compact) && Math.abs(b.cy - hw.label.cy) <= (hw.label.y1 - hw.label.y0),
    );
    if (sameRowWeight) out.weight = inRange(hw.numbers[1], 20, 250);
  }
  if (out.weight == null) {
    const w = rowNumbers(boxes, /^(체중|몸무게)(\(kg\))?e?$/);
    out.weight = inRange(w?.numbers[0], 20, 250);
  }

  // 혈압: 수축기 / 이완기 두 숫자 (가운데 "/" 는 OCR 이 빠뜨리기도 한다)
  const bp = rowNumbers(boxes, /^(고혈압|혈압)(\(.*\))?e?$/);
  if (bp && bp.numbers.length >= 2) {
    const [s, d] = bp.numbers;
    if (inRange(s, 70, 260) && inRange(d, 40, 160) && s > d) {
      out.sbp = s;
      out.dbp = d;
    }
  }

  const one = (pattern, min, max) => inRange(rowNumbers(boxes, pattern)?.numbers[0], min, max);
  out.fastingGlucose = one(/^(공복|식전)혈당(?!장애)/, 40, 600);
  out.hdl = one(/^(고밀도|HDL)/i, 10, 150);
  out.ldl = one(/^\(?(저밀도|LDL)/i, 20, 400);
  out.tg = one(/^(중성지방|트리글리세라이드)/, 20, 3000);
  out.creatinine = one(/크레아티닌/, 0.2, 20);
  out.gfr = one(/^\(?(신사구체|e-?GFR)/i, 3, 200);
  return out;
}

// ── 글자 순서로 찾기 (예전 /ocr 코드. 좌표로 못 찾은 값만 쓴다) ──────────
function readByText(fullText) {
  const out = {};

  // 혈압: "142 / 92" (빗금 없이 "142 92 mmHg" 도)
  const bpMatch =
    fullText.match(/(?:고혈압|고위압|혈압)[^\d]{0,25}([0-9]{2,3})\s*[/]\s*([0-9]{2,3})/i) ||
    fullText.match(/([0-9]{2,3})\s*[/]?\s*([0-9]{2,3})\s*(?:mmHg|anHg)/i);
  if (bpMatch) {
    out.sbp = parseFloat(bpMatch[1]);
    out.dbp = parseFloat(bpMatch[2]);
  }

  const hwMatch = fullText.match(/(?:키.*?몸무게|신장.*?체중)[\s\S]{0,40}?([0-9]{2,3}(?:\.[0-9])?)\s*[/]\s*([0-9]{2,3}(?:\.[0-9])?)/i);
  if (hwMatch) {
    out.height = parseFloat(hwMatch[1]);
    out.weight = parseFloat(hwMatch[2]);
  } else {
    const hOnly = fullText.match(/(?:신장|키)\s*\(?cm\)?\s*[:：]?\s*(1[4-9][0-9](?:\.[0-9])?|20[0-9](?:\.[0-9])?)/i);
    if (hOnly) out.height = parseFloat(hOnly[1]);
    const wOnly = fullText.match(/(?<!저)(?:체중|몸무게)\s*\(?kg\)?\s*[:：]?\s*([3-9][0-9](?:\.[0-9])?|1[0-9]{2}(?:\.[0-9])?)(?!\s*미만)/i);
    if (wOnly) out.weight = parseFloat(wOnly[1]);
  }

  if (!fullText.includes("비해당 비해당 비해당 비해당")) {
    const preLipidHdl = fullText.match(/의심\s+(?:[0-9]{2,3})\s+([3-9][0-9])\s+이상지질혈증/);
    if (preLipidHdl) out.hdl = parseFloat(preLipidHdl[1]);

    const postLipidPair = fullText.match(/(?:유질환자|이상\s*의심)\s+([0-9]{2,3})\s+([0-9]{2,3})\s+(?:혈액검사|혈청|신장)/);
    if (postLipidPair) {
      out.tg = parseFloat(postLipidPair[1]);
      out.ldl = parseFloat(postLipidPair[2]);
    } else {
      const ldlMatch = fullText.match(/(?:저밀도|LDL)[^\d]{0,25}([0-9]{2,3})(?!\s*미만)/i);
      if (ldlMatch) out.ldl = parseFloat(ldlMatch[1]);
      const tgMatch = fullText.match(/(?:중성지방|트리글리세라이드)[^\d]{0,40}?([0-9]{2,4})(?!\s*미만)/i);
      if (tgMatch) out.tg = parseFloat(tgMatch[1]);
      if (out.hdl == null) {
        const hdlMatch = fullText.match(/(?:고밀도|HDL|HI\.)[^\d]{0,25}([0-9]{2,3})(?!\s*이상)/i);
        if (hdlMatch) out.hdl = parseFloat(hdlMatch[1]);
      }
    }
  }

  const gfrMatch =
    fullText.match(/(?:e-?GFR|신사구체여과[을율])[\s\S]{0,100}?([0-9]{2,3})(?!\.[0-9])(?:\s*$|\s+[가-힣A-Z])/i) ||
    fullText.match(/신장기능\s*이상\s*의심\s*([0-9]{2,3})/i);
  if (gfrMatch) out.gfr = parseFloat(gfrMatch[1]);

  const glucoseMatch = fullText.match(/(?:공복|식전)혈당[^\d]{0,15}([0-9]{2,3})/);
  if (glucoseMatch) out.fastingGlucose = parseFloat(glucoseMatch[1]);
  return out;
}

/**
 * CKD-EPI 2021 (인종 계수 없는 식). 크레아티닌 mg/dL, 나이, "male"|"female" → mL/min/1.73㎡ (정수)
 *   Inker LA et al. N Engl J Med 2021;385:1737-49
 */
function estimateGfr(creatinine, age, gender) {
  if (!creatinine || !age || !gender) return null;
  const female = gender === "female";
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const r = creatinine / k;
  const gfr = 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
  return Math.round(gfr);
}

/**
 * @param {Array} fields - CLOVA 응답 images[0].fields
 * @param {Date} [now]   - 나이 계산 기준 (테스트용)
 * @returns POST /ocr 응답의 extractedData
 */
function parseCheckup(fields, now = new Date()) {
  // 편집 기호는 빈칸으로 (예전 정규식이 "신장← 170.2" 를 못 읽었다)
  const fullText = (fields ?? []).map((f) => f.inferText).join(" ").replace(FORMAT_MARKS, " ");
  const boxes = toBoxes(fields);

  // 이름: "수검자 성명 김민준" / "성 명 김민준" (예전에는 "수검자" 뒤의 "성명" 을 이름으로 잡았다)
  let name = null;
  const nameMatch =
    fullText.match(/^([가-힣]{2,4})\s+[0-9]{6}/) ||
    fullText.match(/^([가-힣]{2,4})\s+[0-9]{4}년/) ||
    fullText.match(/(?:수검자\s*)?(?:성\s*명|수검자명)\s*[:：]?\s*([가-힣]{2,4})/) ||
    fullText.match(/수검자\s*[:：]?\s*([가-힣]{2,4})/);
  if (nameMatch && !/^(성명|주민)/.test(nameMatch[1])) name = nameMatch[1].trim();

  // 주민번호 → 나이, 성별
  let age = null;
  let gender = null;
  const rrnMatch = fullText.match(/([0-9]{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])\s*[-－]\s*([1-4])/);
  if (rrnMatch) {
    const birthYear = (rrnMatch[2] === "1" || rrnMatch[2] === "2" ? 1900 : 2000) + parseInt(rrnMatch[1], 10);
    age = now.getFullYear() - birthYear;
    gender = rrnMatch[2] === "1" || rrnMatch[2] === "3" ? "male" : "female";
  }

  const pos = readByPosition(boxes);
  const txt = readByText(fullText);
  const pick = (key) => pos[key] ?? txt[key] ?? null;

  const height = pick("height");
  const weight = pick("weight");
  // 혈압은 두 값을 같은 방법에서 같이 가져온다 (섞이지 않게)
  const sbp = pos.sbp ?? txt.sbp ?? null;
  const dbp = pos.sbp != null ? pos.dbp : txt.dbp ?? null;
  const fastingGlucose = pick("fastingGlucose");
  const ldl = pick("ldl");
  const hdl = pick("hdl");
  const tg = pick("tg");
  const creatinine = pos.creatinine ?? null;
  let gfr = pick("gfr");
  let gfrEstimated = false;
  if (gfr == null) {
    gfr = estimateGfr(creatinine, age, gender);
    gfrEstimated = gfr != null;
  }

  // ── 질환 추천 (예전 규칙 그대로) ──
  const suggestedDiseases = [];
  let hypertensionStage = 1;
  if ((sbp && sbp >= 140) || (dbp && dbp >= 90)) {
    suggestedDiseases.push("고혈압");
    hypertensionStage = sbp >= 160 || dbp >= 100 ? 2 : 1;
  }
  // [변경] 진단명에 "제1형 당뇨(병)" / "1형 당뇨" 가 있으면 2형 대신 1형 (진단여부 칸·소견)
  //        혈당 수치만으로는 1형·2형을 가릴 수 없어, 예전에는 1형 환자 검진표도 "2형 당뇨" 로 추천했다
  //        OCR 이 1 을 l·I·| 로 읽거나 띄어 읽어도 ("제 l형 당 뇨") 잡는다. "인슐린 치료" 만으로는 정하지 않는다 (2형도 쓴다)
  if (TYPE1_DIABETES.test(fullText)) {
    suggestedDiseases.push("1형 당뇨");
  } else if ((fastingGlucose && fastingGlucose >= 126) || fullText.includes("■ 당뇨병 의심")) {
    suggestedDiseases.push("2형 당뇨");
  }
  const isLipidAbnormal = (tg && tg >= 150) || (ldl && ldl >= 130) || (hdl && hdl < 40);
  const hasLipidChecked =
    fullText.includes("■ 고중성지방") || fullText.includes("■ 고콜레스테롤") || fullText.includes("■ 낮은 HDL");
  if (isLipidAbnormal || hasLipidChecked) suggestedDiseases.push("이상지질혈증");
  if (gfr && gfr < 60) suggestedDiseases.push("신장병");

  return {
    name,
    age,
    gender,
    height,
    weight,
    sbp,
    dbp,
    fastingGlucose,
    ldl,
    hdl,
    tg,
    gfr,
    gfrEstimated, // [추가] true 면 e-GFR 칸이 없어 크레아티닌으로 계산한 값
    creatinine, // [추가]
    hypertensionStage,
    suggestedDiseases,
  };
}

module.exports = { parseCheckup, estimateGfr };
