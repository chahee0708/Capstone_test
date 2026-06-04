/**
 * ProfilePage.tsx
 *
 * 변경 사항:
 *   - 이상지질혈증 심각도: ldl_level(드롭다운) → ldl_value, tg_value, hdl_value(실제 수치 입력)
 *   - profile state, useEffect, PUT 요청 모두 반영
 *   - 나머지 코드는 기존과 동일
 */

import { useState, useEffect } from "react";
import {
  User,
  Heart,
  AlertCircle,
  Save,
  Plus,
  X,
  Activity,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const USER_ID = 1;

const COMMON_CONDITIONS = [
  "2형 당뇨",
  "1형 당뇨",
  "고혈압",
  "이상지질혈증",
  "신장병",
];
const COMMON_ALLERGIES = [
  "우유",
  "계란",
  "땅콩",
  "견과류",
  "대두",
  "밀",
  "갑각류",
  "생선",
];

export function ProfilePage() {
  const [profile, setProfile] = useState({
    name: "",
    age: 0,
    gender: "male",
    weight: 0,
    height: 0,
    diseases: [] as string[],
    allergens: [] as string[],

    // 고혈압 심각도
    hypertension_stage: 1,

    // 이상지질혈증 — 실제 수치 (mg/dL)
    ldl_value: null as number | null,
    tg_value: null as number | null,
    hdl_value: null as number | null,

    // 신장병 GFR
    gfr_value: 35,
  });

  const [newCondition, setNewCondition] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // ── 백엔드에서 사용자 정보 불러오기 ──────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/users/${USER_ID}`)
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
          tg_value: data.tg_value ?? null,
          hdl_value: data.hdl_value ?? null,
          gfr_value: data.gfr_value ?? 35,
        });
        setIsLoading(false);
      })
      .catch(() => {
        toast.error("프로필 불러오기 실패");
        setIsLoading(false);
      });
  }, []);

  // ── 저장 ─────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    try {
      const res = await fetch(`${API_URL}/users/${USER_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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

  // ── 질환/알레르기 추가·제거 ──────────────────────────────────
  const addToList = (key: "diseases" | "allergens", value: string) => {
    const trimmed = value.trim();
    if (trimmed && !profile[key].includes(trimmed)) {
      setProfile((prev) => ({ ...prev, [key]: [...prev[key], trimmed] }));
      if (key === "diseases") setNewCondition("");
      else setNewAllergy("");
    }
  };

  const removeFromList = (key: "diseases" | "allergens", value: string) => {
    setProfile((prev) => ({
      ...prev,
      [key]: prev[key].filter((v) => v !== value),
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
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">건강 프로필</h1>
          <p className="text-gray-600">
            정확한 분석을 위해 건강 정보를 입력해주세요
          </p>
        </div>

        <div className="space-y-6">
          {/* ── 기본 정보 ── */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600" /> 기본 정보
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(
                [
                  { id: "name", label: "이름", type: "text", key: "name" },
                  { id: "age", label: "나이", type: "number", key: "age" },
                  {
                    id: "weight",
                    label: "몸무게 (kg)",
                    type: "number",
                    key: "weight",
                  },
                  {
                    id: "height",
                    label: "키 (cm)",
                    type: "number",
                    key: "height",
                  },
                ] as const
              ).map((field) => (
                <div key={field.id}>
                  <Label htmlFor={field.id}>{field.label}</Label>
                  <Input
                    id={field.id}
                    type={field.type}
                    value={(profile as any)[field.key]}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        [field.key]:
                          field.type === "number"
                            ? parseFloat(e.target.value) || 0
                            : e.target.value,
                      }))
                    }
                  />
                </div>
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
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-600" /> 건강 질환
            </h3>

            {/* 선택된 질환 뱃지 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.diseases.map((d) => (
                <Badge
                  key={d}
                  className="bg-red-100 text-red-700 cursor-pointer"
                  onClick={() => removeFromList("diseases", d)}
                >
                  {d} <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>

            {/* 직접 입력 */}
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="질환명 입력"
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" && addToList("diseases", newCondition)
                }
              />
              <Button
                onClick={() => addToList("diseases", newCondition)}
                variant="outline"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* 빠른 선택 */}
            <div className="flex flex-wrap gap-2">
              {COMMON_CONDITIONS.filter(
                (c) => !profile.diseases.includes(c),
              ).map((c) => (
                <Badge
                  key={c}
                  variant="outline"
                  className="cursor-pointer hover:bg-emerald-50"
                  onClick={() => addToList("diseases", c)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  {c}
                </Badge>
              ))}
            </div>
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
                {/* ── 고혈압 Stage ── */}
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

                {/* ── 이상지질혈증 — 지질 수치 3개 입력 ── */}
                {hasDyslipidemia && (
                  <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-medium text-blue-800">
                      이상지질혈증 — 지질 수치 입력 (mg/dL)
                    </p>
                    <p className="text-xs text-blue-600">
                      건강검진 결과지의 수치를 그대로 입력해주세요
                    </p>

                    {/* LDL */}
                    <div className="flex items-center gap-3">
                      <Label className="w-40 text-sm text-gray-700">
                        LDL 콜레스테롤
                      </Label>
                      <Input
                        type="number"
                        placeholder="예: 165"
                        value={profile.ldl_value ?? ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            ldl_value:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        className="w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-xs text-gray-500">
                        정상 &lt;130 / 경계 130~159 / 높음 160~189 / 매우높음
                        ≥190
                      </span>
                    </div>

                    {/* 중성지방 (TG) */}
                    <div className="flex items-center gap-3">
                      <Label className="w-40 text-sm text-gray-700">
                        중성지방 (TG)
                      </Label>
                      <Input
                        type="number"
                        placeholder="예: 220"
                        value={profile.tg_value ?? ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            tg_value:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        className="w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-xs text-gray-500">
                        정상 &lt;150 / 경계 150~199 / 높음 200~499 / 매우높음
                        ≥500
                      </span>
                    </div>

                    {/* HDL */}
                    <div className="flex items-center gap-3">
                      <Label className="w-40 text-sm text-gray-700">
                        HDL 콜레스테롤
                      </Label>
                      <Input
                        type="number"
                        placeholder="예: 38"
                        value={profile.hdl_value ?? ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            hdl_value:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        className="w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-xs text-gray-500">
                        정상 ≥40 / 낮음(위험) &lt;40
                      </span>
                    </div>
                  </div>
                )}

                {/* ── 신장병 GFR ── */}
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
                    <div className="flex items-center gap-2">
                      <Input
                        id="gfr_value"
                        type="number"
                        min={0}
                        max={150}
                        value={profile.gfr_value}
                        onChange={(e) =>
                          setProfile((prev) => ({
                            ...prev,
                            gfr_value: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-sm text-gray-500">
                        mL/min/1.73m²
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── 알레르기 ── */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" /> 알레르기
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.allergens.map((a) => (
                <Badge
                  key={a}
                  className="bg-amber-100 text-amber-700 cursor-pointer"
                  onClick={() => removeFromList("allergens", a)}
                >
                  {a} <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="알레르기 성분 입력"
                value={newAllergy}
                onChange={(e) => setNewAllergy(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" && addToList("allergens", newAllergy)
                }
              />
              <Button
                onClick={() => addToList("allergens", newAllergy)}
                variant="outline"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMMON_ALLERGIES.filter(
                (a) => !profile.allergens.includes(a),
              ).map((a) => (
                <Badge
                  key={a}
                  variant="outline"
                  className="cursor-pointer hover:bg-emerald-50"
                  onClick={() => addToList("allergens", a)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  {a}
                </Badge>
              ))}
            </div>
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
      </div>
    </div>
  );
}
