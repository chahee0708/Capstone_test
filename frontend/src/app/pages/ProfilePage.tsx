/**
 * ProfilePage.tsx
 *
 * 변경 사항:
 *   - profile state에 hypertension_stage, ldl_level, gfr_value 추가
 *   - GET/PUT 요청에 새 필드 포함
 *   - 질병 선택 시 심각도 입력 폼 조건부 표시
 *     - 고혈압 → Stage I / Stage II 라디오
 *     - 이상지질혈증 → LDL 수준 셀렉트 (경계/높음/매우높음)
 *     - 신장병 → GFR 수치 숫자 입력
 *   - "만성콩팥병" → "신장병"으로 통일 (scoreService.js와 일치)
 *   - "갑상선 질환" 제거 (구현 제외)
 */

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../contexts/AuthContext";
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
import { AllergenQuickPick } from "../components/AllergenQuickPick";
import { apiFetch, readErrorMessage } from "../../lib/api";

// 질병 목록 (갑상선 제거, 만성콩팥병 → 신장병)
const COMMON_CONDITIONS = [
  "2형 당뇨",
  "1형 당뇨",
  "고혈압",
  "이상지질혈증",
  "신장병",
];

export function ProfilePage() {
  const { user } = useAuth();
  // 로그인한 사용자 본인의 프로필만 다룬다 (서버도 본인 id 가 아니면 403)
  const USER_ID = user!.id;
  const [profile, setProfile] = useState({
    name: "",
    age: null as number | null,
    gender: "male",
    weight: null as number | null,
    height: null as number | null,
    diseases: [] as string[],
    allergens: [] as string[],

    // 질병 심각도 필드
    hypertension_stage: 1,
    ldl_value: null as number | null,
    tg_value:  null as number | null,
    hdl_value: null as number | null,
    gfr_value: 35 as number | null,
  });

  const [newCondition, setNewCondition] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 마지막으로 서버와 동기화된 상태(JSON). 현재 값과 다르면 "저장하지 않은 변경"이다.
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const dirty = useMemo(
    () => !isLoading && JSON.stringify(profile) !== savedSnapshot,
    [profile, savedSnapshot, isLoading],
  );

  // 저장하지 않은 변경이 있을 때 새로고침/탭 닫기를 한 번 막는다
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── 백엔드에서 사용자 정보 불러오기 ──────────────────────────
  useEffect(() => {
    apiFetch(`/users/${USER_ID}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, "프로필 불러오기 실패"));
        }
        return res.json();
      })
      .then((data) => {
        const loaded = {
          name: data.name || "",
          age: data.age ?? null,
          gender: data.gender || "male",
          weight: data.weight ?? null,
          height: data.height ?? null,
          diseases: data.diseases || [],
          allergens: data.allergens || [],
          hypertension_stage: data.hypertension_stage ?? 1,
          ldl_value: data.ldl_value ?? null,
          tg_value:  data.tg_value  ?? null,
          hdl_value: data.hdl_value ?? null,
          gfr_value: data.gfr_value ?? 35,
        };
        setProfile(loaded);
        setSavedSnapshot(JSON.stringify(loaded));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "프로필 불러오기 실패");
        setIsLoading(false);
      });
  }, [USER_ID]);

  // ── 저장 ─────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/users/${USER_ID}`, {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        // 서버 검증 메시지(예: "나이는 1~120 사이여야 합니다.")를 그대로 보여준다.
        toast.error(await readErrorMessage(res, "저장 실패. 잠시 후 다시 시도해주세요."));
        return;
      }
      setSavedSnapshot(JSON.stringify(profile));
      toast.success("프로필이 저장되었습니다", {
        description: "맞춤 분석에 반영됩니다",
      });
    } catch {
      toast.error("저장 실패. 서버에 연결할 수 없습니다.");
    } finally {
      setSaving(false);
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
    return (
      <div className="p-8 text-center text-body" role="status" aria-live="polite">
        불러오는 중...
      </div>
    );

  const hasHypertension = profile.diseases.includes("고혈압");
  const hasDyslipidemia = profile.diseases.includes("이상지질혈증");
  const hasCKD = profile.diseases.includes("신장병");
  const hasDetailNeeded = hasHypertension || hasDyslipidemia || hasCKD;

  return (
    <div className="min-h-full bg-background py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">건강 프로필</h1>
          <p className="text-body">
            정확한 분석을 위해 건강 정보를 입력해주세요
          </p>
        </div>

        <div className="space-y-6">
          {/* ── 기본 정보 ── */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-positive-deep" /> 기본 정보
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
                  <Label htmlFor={field.id} className="mb-1.5 block">
                    {field.label}
                  </Label>
                  <Input
                    id={field.id}
                    type={field.type}
                    value={(profile as any)[field.key] ?? ""}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        [field.key]:
                          field.type === "number"
                            ? e.target.value === ""
                              ? null
                              : Number(e.target.value)
                            : e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <fieldset className="mt-4">
              <legend className="text-base font-medium leading-normal">성별</legend>
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
                      className="w-4 h-4 text-positive-deep"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>

          {/* ── 질환 ── */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Heart className="w-5 h-5 text-negative-deep" /> 건강 질환
            </h3>

            {/* 선택된 질환 뱃지 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.diseases.map((d) => (
                <Badge
                  key={d}
                  asChild
                  className="bg-negative/10 text-negative-deep cursor-pointer"
                >
                  <button
                    type="button"
                    aria-label={`${d} 삭제`}
                    onClick={() => removeFromList("diseases", d)}
                  >
                    {d} <X className="w-3 h-3 ml-1" />
                  </button>
                </Badge>
              ))}
            </div>

            {/* 직접 입력 */}
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="질환명 입력"
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                onKeyDown={(e) =>
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
                  asChild
                  variant="outline"
                  className="cursor-pointer hover:bg-primary-pale"
                >
                  <button
                    type="button"
                    aria-label={`${c} 추가`}
                    onClick={() => addToList("diseases", c)}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {c}
                  </button>
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
                {/* 고혈압 Stage */}
                {hasHypertension && (
                  <div>
                    <Label className="text-base font-medium">고혈압 단계</Label>
                    <p className="text-xs text-body mb-2">
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

                {/* 이상지질혈증 수치 입력 */}
                {hasDyslipidemia && (
                  <div className="space-y-4 rounded-lg border border-transparent bg-canvas-soft p-3">
                    <p className="text-sm font-medium text-ink">
                      이상지질혈증 — 지질 수치 입력 (mg/dL)
                    </p>
                    {(
                      [
                        { key: "ldl_value", label: "LDL 콜레스테롤", ph: "예: 165", help: "정상 <130 / 경계 130~159 / 높음 160~189 / 매우높음 ≥190" },
                        { key: "tg_value", label: "중성지방 (TG)", ph: "예: 220", help: "정상 <150 / 경계 150~199 / 높음 200~499 / 매우높음 ≥500" },
                        { key: "hdl_value", label: "HDL 콜레스테롤", ph: "예: 38", help: "정상 ≥40 / 낮음(위험) <40" },
                      ] as const
                    ).map((f) => (
                      <div key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Label htmlFor={`lipid-${f.key}`} className="w-36 shrink-0 text-sm text-body">
                          {f.label}
                        </Label>
                        <Input
                          id={`lipid-${f.key}`}
                          type="number"
                          inputMode="decimal"
                          placeholder={f.ph}
                          value={profile[f.key] ?? ""}
                          onChange={(e) =>
                            setProfile((prev) => ({
                              ...prev,
                              [f.key]: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="w-28"
                        />
                        <span className="basis-full sm:basis-auto text-xs text-body">{f.help}</span>
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
                    <p className="text-xs text-body mb-2">
                      20~50: 중기 / 20 미만: 말기 / 0 입력 시 이식 환자로 처리
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id="gfr_value"
                        type="number"
                        min={0}
                        max={150}
                        value={profile.gfr_value ?? ""}
                        onChange={(e) =>
                          setProfile((prev) => ({
                            ...prev,
                            // 비워 두면 null → 서버 기본값(35). 0 은 "이식 환자"이므로 명시 입력일 때만 사용
                            gfr_value: e.target.value === "" ? null : Number(e.target.value),
                          }))
                        }
                        className="w-40"
                      />
                      <span className="text-sm text-body">
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
                  asChild
                  className="bg-amber-100 text-amber-700 cursor-pointer"
                >
                  <button
                    type="button"
                    aria-label={`${a} 삭제`}
                    onClick={() => removeFromList("allergens", a)}
                  >
                    {a} <X className="w-3 h-3 ml-1" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="알레르기 성분 입력"
                value={newAllergy}
                onChange={(e) => setNewAllergy(e.target.value)}
                onKeyDown={(e) =>
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
            <AllergenQuickPick selected={profile.allergens} onAdd={(a) => addToList("allergens", a)} />
          </Card>

          {/* ── 저장 바: 변경 사항이 있을 때만 하단에 고정해 보여 준다 ── */}
          {(dirty || saving) && (
            <div className="sticky bottom-[4.75rem] md:bottom-4 z-30">
              <div className="rounded-2xl bg-white/95 backdrop-blur border border-border shadow-lg p-2.5 pl-4 flex items-center gap-3">
                <p
                  className="text-sm flex-1 min-w-0 text-warning-content font-semibold leading-snug"
                  role="status"
                  aria-live="polite"
                >
                  저장하지 않은 변경 사항이 있어요
                </p>
                <Button onClick={handleSaveProfile} disabled={saving} className="shrink-0">
                  <Save className="w-4 h-4" /> {saving ? "저장 중…" : "저장"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
