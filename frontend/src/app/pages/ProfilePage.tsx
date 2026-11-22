/**
 * ProfilePage.tsx
 *
 * 주요 기능:
 *   - profile state: hypertension_stage, ldl_value, tg_value, hdl_value, gfr_value 유지
 *   - 질병 선택 시 심각도 입력 폼 조건부 표시:
 *     - 고혈압 → Stage I / Stage II 라디오
 *     - 이상지질혈증 → LDL, 중성지방(TG), HDL 수치(mg/dL) 3가지 입력 필드
 *     - 신장병 → GFR 수치 숫자 입력
 *   - 건강검진표 사진 기반 OCR 자동 채우기 기능 연동 (credentials: "include" 적용)
 *
 * 이번 변경(seohee 브랜치 기능 이식):
 *   - [추가] "건강 정보" / "내 식품" 탭. 내 식품 = 관심 식품 + 최근 검색한 식품 (MyFoodsPanel)
 *       "사진으로 입력"(건강검진표 OCR) 버튼은 건강 정보 탭에서만 보인다
 *   - [변경] 기본 정보·지질 수치·GFR 숫자 칸: 밑줄 칸 + 떠오르는 이름표 (FloatingField, seohee 브랜치 형식), 단위는 칸 오른쪽 끝
 *   - [변경] 질환·알레르기: 직접 입력 없이 버튼으로 켜고 끄기 (ToggleChips). 알레르기는 판정이 아는 17개 묶음 전부
 *       예전에 직접 입력해 저장된 값도 버튼으로 보여서 끌 수 있다 (withSaved)
 *   - [변경] 건강검진표 사진은 보내기 전에 방향·크기 정리 (prepareImageForOcr)
 *   - [추가] e-GFR 칸이 없어 크레아티닌으로 계산한 경우 완료 알림에 안내 (백엔드 checkupParser 의 gfrEstimated)
 *   - [변경] 건강검진표를 읽는 동안 버튼 글자와 알림을 "건강검진표 입력중···" 으로
 */

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  User,
  Heart,
  AlertCircle,
  Save,
  Check,
  Activity,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { MyFoodsPanel } from "../../components/MyFoodsPanel";
import { prepareImageForOcr } from "../../components/prepareImageForOcr";
import checkupIcon from "../../assets/icons/document.png"; // [추가] 사진으로 입력 버튼 아이콘
import { FloatingField } from "../../components/FloatingField"; // [추가] 밑줄 입력칸 (seohee 브랜치 형식)

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// 질병 목록 (갑상선 제거, 만성콩팥병 → 신장병)
const COMMON_CONDITIONS = [
  "2형 당뇨",
  "1형 당뇨",
  "고혈압",
  "이상지질혈증",
  "신장병",
];
// [변경] 알레르기 버튼 17개: 식품 알레르기 판정이 아는 이름·묶음 전부
//        (data_pipeline/clean/allergen_groups.csv 의 group 열. 견과류 = 잣·호두·헤이즐넛, 갑각류 = 새우·게, 생선 = 고등어, 우유 = 우유·산양유)
const COMMON_ALLERGIES = [
  "우유",
  "계란",
  "땅콩",
  "견과류",
  "대두",
  "밀",
  "메밀",
  "갑각류",
  "생선",
  "조개류",
  "오징어",
  "쇠고기",
  "돼지고기",
  "닭고기",
  "복숭아",
  "토마토",
  "아황산류",
];

/** 버튼 목록 = 기본 목록 + 예전에 직접 입력해 저장된 값 (목록에 없어도 버튼으로 보여서 끌 수 있게) */
function withSaved(base: string[], saved: string[]) {
  return [...base, ...saved.filter((s) => !base.includes(s))];
}

/** [추가] 켜고 끄는 버튼 묶음 (seohee 브랜치 형식): 켜지면 테마색 바탕 + 체크 표시 */
function ToggleChips({
  options,
  selected,
  onToggle,
  label,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1 h-9 px-3.5 rounded-full border text-sm transition-colors ${
              on
                ? "bg-[#388E3C] border-[#388E3C] text-white font-medium"
                : "bg-white border-gray-300 text-gray-700 hover:border-[#388E3C] hover:text-[#1B5E20]"
            }`}
          >
            {on && <Check className="w-4 h-4" aria-hidden />}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function ProfilePage() {
  const { user, token } = useAuth();
  const USER_ID = user?.id ?? 1;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // [추가] 현재 탭: "health"(건강 정보) | "foods"(내 식품). 사진으로 입력 버튼은 건강 정보 탭에서만 보인다
  const [tab, setTab] = useState("health");

  const [profile, setProfile] = useState({
    name: "",
    age: 0,
    gender: "male",
    weight: 0,
    height: 0,
    diseases: [] as string[],
    allergens: [] as string[],

    // 질병 심각도 필드 (고혈압, 이상지질혈증 3종 수치, 신장병)
    hypertension_stage: 1,
    ldl_value: null as number | null,
    tg_value:  null as number | null,
    hdl_value: null as number | null,
    gfr_value: 35,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  // ── 백엔드에서 사용자 정보 불러오기 ──────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/users/${USER_ID}`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        setProfile({
          name: data.name || "",
          age: data.age || 0,
          gender: data.gender || "male",
          weight: data.weight || 0,
          height: data.height || 0,
          diseases: data.diseases || [],
          allergens: data.allergens || [],
          hypertension_stage: data.hypertension_stage ?? 1,
          ldl_value: data.ldl_value ?? null,
          tg_value:  data.tg_value  ?? null,
          hdl_value: data.hdl_value ?? null,
          gfr_value: data.gfr_value ?? 35,
        });
        setIsLoading(false);
      })
      .catch(() => {
        toast.error("프로필 불러오기 실패");
        setIsLoading(false);
      });
  }, [USER_ID, token]);

  // ── 건강검진표 OCR 자동 입력 처리 ─────────────────────────
  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsOcrProcessing(true);
    const toastId = toast.loading("건강검진표 입력중···");

    try {
      const formData = new FormData();
      // [변경] 휴대폰 사진 방향을 바로잡고 크기를 줄여서 보낸다
      formData.append("image", await prepareImageForOcr(file));

      const res = await fetch(`${API_URL}/ocr`, {
        method: "POST",
        credentials: "include", // 세션/인증 쿠키 전달 추가
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "OCR 판독에 실패했습니다.");

      const extracted = data.extractedData || {};

      setProfile((prev) => {
        const detectedDiseases = Array.isArray(extracted.suggestedDiseases)
          ? extracted.suggestedDiseases
          : [];

        const hasHypertension = detectedDiseases.includes("고혈압");
        const hasDyslipidemia = detectedDiseases.includes("이상지질혈증");
        const hasKidney = detectedDiseases.includes("신장병");

        return {
          ...prev,
          name: extracted.name || prev.name,
          age: (extracted.age && extracted.age > 0) ? extracted.age : prev.age,
          gender: extracted.gender || prev.gender,
          height: extracted.height ?? prev.height,
          weight: extracted.weight ?? prev.weight,
          diseases: detectedDiseases,
          hypertension_stage: hasHypertension ? (extracted.hypertensionStage ?? 1) : 1,
          ldl_value: hasDyslipidemia ? (extracted.ldl ?? prev.ldl_value) : null,
          tg_value:  hasDyslipidemia ? (extracted.tg  ?? prev.tg_value)  : null,
          hdl_value: hasDyslipidemia ? (extracted.hdl ?? prev.hdl_value) : null,
          gfr_value: hasKidney ? (extracted.gfr ?? 35) : 35,
        };
      });

      // [추가] 검진표에 e-GFR 칸이 없어 크레아티닌·나이·성별로 계산한 경우 알려 준다
      toast.success("건강검진표 분석이 완료되었습니다!", {
        id: toastId,
        description:
          extracted.gfrEstimated && extracted.gfr != null
            ? `e-GFR ${extracted.gfr}은 혈청 크레아티닌으로 계산한 값이에요.`
            : undefined,
      });
    } catch (err: any) {
      toast.error(`OCR 처리 실패: ${err.message}`, { id: toastId });
    } finally {
      setIsOcrProcessing(false);
      if (e.target) e.target.value = "";
    }
  };

  // ── 저장 ─────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    try {
      const res = await fetch(`${API_URL}/users/${USER_ID}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error();
      toast.success("프로필이 저장되었습니다", {
        description: "맞춤 분석에 반영됩니다",
      });
    } catch {
      toast.error("저장 실패. 서버를 확인해주세요.");
    }
  };

  // ── [변경] 질환/알레르기 버튼 켜기·끄기 ─────────────────────────
  const toggleInList = (key: "diseases" | "allergens", value: string) => {
    setProfile((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));
  };

  if (isLoading)
    return <div className="p-8 text-center text-gray-500">불러오는 중...</div>;

  const hasHypertension = profile.diseases.includes("고혈압");
  const hasDyslipidemia = profile.diseases.includes("이상지질혈증");
  const hasCKD = profile.diseases.includes("신장병");
  const hasDetailNeeded = hasHypertension || hasDyslipidemia || hasCKD;

  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold mb-2">건강 프로필</h1>
            <p className="text-gray-600">
              정확한 분석을 위해 건강 정보를 입력해주세요
            </p>
          </div>

          {/* ── 건강검진표 사진 OCR 자동 채우기 버튼 ([변경] 건강 정보 탭에서만) ── */}
          <div className={tab === "health" ? "" : "hidden"}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleOcrUpload}
              disabled={isOcrProcessing}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-1 border-[#388E3C] text-[#1B5E20] hover:bg-[#388E3C]/10 cursor-pointer shadow-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isOcrProcessing}
            >
              {/* [변경] seohee 브랜치 버튼 모양: 문서 그림(assets/icons/document.png)을 마스크로 써서 테마색으로 칠한다
                  읽는 중에는 깜빡인다 */}
              <span
                aria-hidden
                className={`relative -left-0.5 inline-block w-5 h-5 bg-[#388E3C] ${isOcrProcessing ? "animate-pulse" : ""}`}
                style={{
                  maskImage: `url(${checkupIcon})`,
                  WebkitMaskImage: `url(${checkupIcon})`,
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                }}
              />
              {isOcrProcessing ? "건강검진표 입력중···" : "사진으로 입력"}
            </Button>
          </div>
        </div>

        {/* [추가] 건강 정보 / 내 식품 탭 */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="health">건강 정보</TabsTrigger>
            <TabsTrigger value="foods">내 식품</TabsTrigger>
          </TabsList>

          <TabsContent value="foods">
            <MyFoodsPanel />
          </TabsContent>

          <TabsContent value="health">
        <div className="space-y-6">
          {/* ── 기본 정보 ── */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600" /> 기본 정보
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {(
                [
                  { id: "name", label: "이름", type: "text", key: "name", suffix: undefined },
                  { id: "age", label: "나이", type: "number", key: "age", suffix: "세" },
                  { id: "weight", label: "몸무게", type: "number", key: "weight", suffix: "kg" },
                  { id: "height", label: "키", type: "number", key: "height", suffix: "cm" },
                ] as const
              ).map((field) => (
                // [변경] 밑줄 칸 + 떠오르는 이름표 (FloatingField), 단위는 칸 오른쪽 끝. 숫자 0 은 빈 칸으로 보인다
                <FloatingField
                  key={field.id}
                  id={field.id}
                  label={field.label}
                  type={field.type}
                  inputMode={field.type === "number" ? "decimal" : undefined}
                  suffix={field.suffix}
                  value={(profile as any)[field.key] === 0 && field.type === "number" ? "" : (profile as any)[field.key]}
                  onChange={(v) =>
                    setProfile((prev) => ({
                      ...prev,
                      [field.key]: field.type === "number" ? parseFloat(v) || 0 : v,
                    }))
                  }
                />
              ))}
            </div>
            <div className="mt-4">
              <Label>성별</Label>
              <div className="flex gap-4 mt-2">
                {[
                  { value: "male", label: "남성" },
                  { value: "female", label: "여성" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="gender"
                      value={opt.value}
                      checked={profile.gender === opt.value}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          gender: e.target.value,
                        }))
                      }
                      className="w-4 h-4 text-emerald-600"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          {/* ── 질환 ── */}
          <Card className="p-6 gap-0">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-600" /> 건강 질환
            </h3>

            {/* [변경] 버튼으로 켜고 끄기 (직접 입력 없음, seohee 브랜치 형식) */}
            <p className="text-sm text-gray-500 mb-4">해당하는 질환을 모두 눌러 주세요.</p>
            <ToggleChips
              options={withSaved(COMMON_CONDITIONS, profile.diseases)}
              selected={profile.diseases}
              onToggle={(v) => toggleInList("diseases", v)}
              label="건강 질환"
            />
          </Card>

          {/* ── 질병 심각도 상세 입력 (조건부 표시) ── */}
          {hasDetailNeeded && (
            <Card className="p-6 border-2 border-amber-200 bg-amber-50">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-600" />
                질병 상세 정보
                <span className="text-sm font-normal text-amber-700 ml-1">
                  — 더 정확한 분석을 위해 입력해주세요
                </span>
              </h3>

              <div className="space-y-6">
                {/* 고혈압 Stage */}
                {hasHypertension && (
                  <div>
                    <Label className="text-base font-medium">고혈압 단계</Label>
                    <p className="text-xs text-gray-500 mb-2">
                      Stage I: 수축기 140~159 / Stage II: 수축기 160 이상
                    </p>
                    <div className="flex gap-6">
                      {[
                        { value: 1, label: "Stage I (경증)" },
                        { value: 2, label: "Stage II (중증)" },
                      ].map((opt) => (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="hypertension_stage"
                            value={opt.value}
                            checked={profile.hypertension_stage === opt.value}
                            onChange={() =>
                              setProfile((prev) => ({
                                ...prev,
                                hypertension_stage: opt.value,
                              }))
                            }
                            className="w-4 h-4 text-amber-600"
                          />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 이상지질혈증 수치 입력 (LDL, 중성지방, HDL 3종) */}
                {hasDyslipidemia && (
                  <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="text-sm font-medium text-blue-800">
                      이상지질혈증 — 지질 수치 입력 (mg/dL)
                    </p>
                    {/* [변경] 지질 수치 3칸: 밑줄 칸 + 떠오르는 이름표 (FloatingField). 기준 범위 안내는 칸 아래 작은 글씨 */}
                    {(
                      [
                        { key: "ldl_value", label: "LDL 콜레스테롤", hint: "정상 <130 / 경계 130~159 / 높음 160~189 / 매우높음 ≥190" },
                        { key: "tg_value", label: "중성지방 (TG)", hint: "정상 <150 / 경계 150~199 / 높음 200~499 / 매우높음 ≥500" },
                        { key: "hdl_value", label: "HDL 콜레스테롤", hint: "정상 ≥40 / 낮음(위험) <40" },
                      ] as const
                    ).map((f) => (
                      <div key={f.key}>
                        <FloatingField
                          id={`profile-${f.key}`}
                          label={f.label}
                          type="number"
                          inputMode="decimal"
                          suffix="mg/dL"
                          value={profile[f.key] ?? ""}
                          onChange={(v) =>
                            setProfile((prev) => ({ ...prev, [f.key]: v === "" ? null : Number(v) }))
                          }
                        />
                        <p className="text-xs text-gray-500 mt-1 px-1">{f.hint}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* 신장병 GFR */}
                {hasCKD && (
                  <div>
                    <Label
                      className="text-base font-medium"
                      htmlFor="gfr_value"
                    >
                      GFR 수치 (사구체 여과율)
                    </Label>
                    <p className="text-xs text-gray-500 mb-2">
                      20~50: 중기 / 20 미만: 말기 / 0 입력 시 이식 환자로 처리
                    </p>
                    {/* [변경] 밑줄 칸 + 떠오르는 이름표 (FloatingField) */}
                    <div className="max-w-xs">
                      <FloatingField
                        id="gfr_value"
                        label="GFR"
                        type="number"
                        inputMode="decimal"
                        suffix="mL/min"
                        value={profile.gfr_value}
                        onChange={(v) =>
                          setProfile((prev) => ({ ...prev, gfr_value: parseFloat(v) || 0 }))
                        }
                      />
                      <p className="text-xs text-gray-500 mt-1 px-1">단위: mL/min/1.73m²</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── 알레르기 ── */}
          <Card className="p-6 gap-0">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" /> 알레르기
            </h3>
            {/* [변경] 버튼으로 켜고 끄기 (직접 입력 없음). 식품 알레르기 판정이 아는 17개 묶음 */}
            <p className="text-sm text-gray-500 mb-4">해당하는 알레르기를 모두 눌러 주세요.</p>
            <ToggleChips
              options={withSaved(COMMON_ALLERGIES, profile.allergens)}
              selected={profile.allergens}
              onToggle={(v) => toggleInList("allergens", v)}
              label="알레르기"
            />
            {/* 묶음 안내: 버튼 아래 작게 */}
            <p className="text-xs text-gray-400 mt-3">
              견과류는 잣·호두·헤이즐넛,
              <br />
              갑각류는 새우·게, 생선은 고등어를 포함해요.
            </p>
          </Card>

          {/* ── 저장 버튼 ── */}
          <Button
            onClick={handleSaveProfile}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
            size="lg"
          >
            <Save className="w-5 h-5 mr-2" /> 프로필 저장
          </Button>
        </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}