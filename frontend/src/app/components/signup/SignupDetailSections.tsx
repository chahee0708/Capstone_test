import { useEffect, useRef, useState } from "react";
import {
  User,
  Heart,
  AlertCircle,
  X,
  Plus,
  Camera,
  ChevronRight,
  Save,
  Stethoscope,
  Activity,
  Loader2,
} from "lucide-react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { AllergenQuickPick } from "../AllergenQuickPick";
import { apiFetch, readErrorMessage } from "../../../lib/api";
import { prepareImage } from "../../../lib/image";
import type { OcrCheckupResult } from "../../../lib/types";

export const COMMON_CONDITIONS = [
  "2형 당뇨",
  "1형 당뇨",
  "고혈압",
  "이상지질혈증",
  "신장병",
];

export const COMMON_ALLERGIES = [
  "우유",
  "계란",
  "땅콩",
  "견과류",
  "대두",
  "밀",
  "갑각류",
  "생선",
];

export const emptyProfile = {
  name: "",
  age: "",
  weight: "",
  height: "",
  gender: "female",
  diseases: [] as string[],
  allergens: [] as string[],
  hypertension_stage: "Stage I",
  ldl_value: "",
  tg_value: "",
  hdl_value: "",
  gfr_value: "",
};

export type ProfileFormState = typeof emptyProfile;

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 가입 폼 상태(문자열 입력값)를 서버 프로필 형식(숫자/null, 고혈압 단계 1|2)으로 변환한다.
 * 비어 있는 입력은 null 로 보내 서버가 "미입력"으로 처리하게 한다.
 */
export function toProfilePayload(profile: ProfileFormState) {
  return {
    age: toNumberOrNull(profile.age),
    weight: toNumberOrNull(profile.weight),
    height: toNumberOrNull(profile.height),
    gender: profile.gender === "male" || profile.gender === "female" ? profile.gender : null,
    diseases: profile.diseases,
    allergens: profile.allergens,
    hypertension_stage: profile.hypertension_stage === "Stage II" ? (2 as const) : (1 as const),
    ldl_value: toNumberOrNull(profile.ldl_value),
    tg_value: toNumberOrNull(profile.tg_value),
    hdl_value: toNumberOrNull(profile.hdl_value),
    gfr_value: toNumberOrNull(profile.gfr_value),
  };
}

export function SignupOcrPanel({
  profile,
  setProfile,
  selectedImage,
  setSelectedImage,
  ocrStatus,
  setOcrStatus,
}: {
  profile: ProfileFormState;
  setProfile: React.Dispatch<React.SetStateAction<ProfileFormState>>;
  selectedImage: string | null;
  setSelectedImage: (value: string | null) => void;
  ocrStatus: string;
  setOcrStatus: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{ name: string; reason: string }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(
    () => () => {
      if (selectedImage) URL.revokeObjectURL(selectedImage);
    },
    // 미리보기 URL 은 교체/언마운트 때 해제한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** OCR 결과를 폼에 반영한다. 사용자가 이미 입력한 값은 덮어쓰지 않는다. */
  const applyResult = (r: OcrCheckupResult) => {
    const done: string[] = [];
    setProfile((prev) => {
      const next = { ...prev };
      const fill = (key: "age" | "height" | "weight" | "ldl_value" | "tg_value" | "hdl_value" | "gfr_value", v: number | null, label: string) => {
        if (v !== null && v !== undefined && String(prev[key]).trim() === "") {
          next[key] = String(v);
          done.push(`${label} ${v}`);
        }
      };
      fill("age", r.profile.age, "나이");
      fill("height", r.profile.height, "키");
      fill("weight", r.profile.weight, "몸무게");
      fill("ldl_value", r.profile.ldl_value, "LDL");
      fill("tg_value", r.profile.tg_value, "중성지방");
      fill("hdl_value", r.profile.hdl_value, "HDL");
      fill("gfr_value", r.profile.gfr_value, "GFR");
      if (r.profile.gender) {
        // 성별 기본값("female")은 사용자가 고른 값이 아니므로 인식 결과로 바꾼다
        next.gender = r.profile.gender;
        done.push(`성별 ${r.profile.gender === "male" ? "남성" : "여성"}`);
      }
      if (r.profile.hypertension_stage) {
        next.hypertension_stage = r.profile.hypertension_stage === 2 ? "Stage II" : "Stage I";
      }
      return next;
    });
    setFilled(done);
    setSuggestions(r.suggestedDiseases ?? []);
    setWarnings((r.warnings ?? []).map((w) => w.message));
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFailed(false);
    setFilled([]);
    setSuggestions([]);
    setWarnings([]);
    if (selectedImage) URL.revokeObjectURL(selectedImage);
    setSelectedImage(URL.createObjectURL(file));
    setOcrStatus("검진 결과지를 읽고 있어요… (5~30초)");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const prepared = await prepareImage(file, 2000);
      const form = new FormData();
      form.append("image", prepared, prepared.name);
      const res = await apiFetch("/ocr/checkup", { method: "POST", body: form, signal: controller.signal });
      if (!res.ok) {
        setFailed(true);
        setOcrStatus(await readErrorMessage(res, "이미지를 분석하지 못했어요. 아래 항목을 직접 입력해 주세요."));
        return;
      }
      const data = (await res.json()) as OcrCheckupResult;
      applyResult(data);
      setOcrStatus(
        data.status === "empty"
          ? "수치를 찾지 못했어요. 결과지가 선명하게 보이도록 다시 촬영하거나 직접 입력해 주세요."
          : "인식한 값을 아래 입력란에 채웠어요. 틀린 값이 없는지 꼭 확인해 주세요.",
      );
      if (data.status === "empty") setFailed(true);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setFailed(true);
      setOcrStatus("서버에 연결할 수 없어요. 아래 항목을 직접 입력해 주세요.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addDisease = (name: string) => {
    setProfile((prev) => (prev.diseases.includes(name) ? prev : { ...prev, diseases: [...prev.diseases, name] }));
    setSuggestions((prev) => prev.filter((s) => s.name !== name));
  };

  return (
    <div className="rounded-lg bg-background p-4 border">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-body">건강검진 결과지로 자동 입력</span>
        <span className="text-xs text-body">선택 사항</span>
      </div>
      <div className="mt-4">
        <label
          className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink px-3 py-3 text-center text-sm font-semibold text-positive-deep hover:bg-primary-pale focus-within:ring-2 focus-within:ring-ring ${
            loading ? "pointer-events-none opacity-60" : "cursor-pointer"
          }`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />}
          {loading ? "읽는 중…" : "결과지 사진 선택 / 촬영"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleImageUpload}
            disabled={loading}
            data-testid="checkup-file"
          />
        </label>
        <p className={`mt-2 text-xs ${failed ? "text-negative-deep" : "text-body"}`} role="status" aria-live="polite">
          {ocrStatus}
        </p>

        {filled.length > 0 && (
          <p className="mt-2 text-xs text-positive-deep">채운 항목: {filled.join(" · ")}</p>
        )}
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-warning-content">
            {warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        )}

        {suggestions.length > 0 && (
          <div className="mt-3 rounded-lg bg-warning-light px-3 py-2">
            <p className="text-xs font-semibold text-warning-content mb-1.5">
              수치상 해당될 수 있는 질환 (참고용 — 의사 진단이 아니에요)
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => addDisease(s.name)}
                  className="inline-flex items-center gap-1 rounded-full border border-warning-deep/50 bg-canvas px-3 py-1.5 text-xs font-medium text-warning-content hover:bg-primary-pale focus-visible:ring-2 focus-visible:ring-ring"
                  title={s.reason}
                >
                  <Plus className="w-3 h-3" aria-hidden="true" /> {s.name}
                  <span className="text-mute font-normal">· {s.reason}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedImage && (
          <div className="mt-4">
            <img src={selectedImage} alt="선택한 검진 결과지 미리보기" className="w-full h-40 object-cover rounded-lg border" />
          </div>
        )}
        <p className="mt-3 text-xs text-mute">
          사진은 글자를 읽는 데만 사용하고 저장하지 않아요. 주민등록번호 등 개인정보는 가리고 올려도 됩니다.
        </p>
      </div>
    </div>
  );
}

export function SignupPersonalInfoSection({
  profile,
  setProfile,
}: {
  profile: ProfileFormState;
  setProfile: React.Dispatch<React.SetStateAction<ProfileFormState>>;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <User className="w-5 h-5 text-positive-deep" />
        <h2 className="font-black text-lg">개인정보</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="profile-name">이름</Label>
          <Input
            id="profile-name"
            value={profile.name}
            placeholder="OCR로 읽기 또는 직접 입력"
            onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="age">나이</Label>
          <Input
            id="age"
            type="number"
            value={profile.age}
            placeholder="나이"
            onChange={(e) => setProfile((prev) => ({ ...prev, age: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="weight">몸무게 (kg)</Label>
          <Input
            id="weight"
            type="number"
            value={profile.weight}
            placeholder="예: 72"
            onChange={(e) => setProfile((prev) => ({ ...prev, weight: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="height">키 (cm)</Label>
          <Input
            id="height"
            type="number"
            value={profile.height}
            placeholder="예: 176"
            onChange={(e) => setProfile((prev) => ({ ...prev, height: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4">
        <Label>성별</Label>
        <div className="flex gap-4 mt-2">
          {[
            { value: "male", label: "남성" },
            { value: "female", label: "여성" },
          ].map((g) => (
            <label className="flex items-center gap-2" key={g.value}>
              <input
                type="radio"
                name="gender"
                value={g.value}
                checked={profile.gender === g.value}
                onChange={(e) => setProfile((prev) => ({ ...prev, gender: e.target.value }))}
              />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function SignupHealthConditionsSection({
  profile,
  setProfile,
}: {
  profile: ProfileFormState;
  setProfile: React.Dispatch<React.SetStateAction<ProfileFormState>>;
}) {
  const [diseaseInput, setDiseaseInput] = useState("");

  const addDisease = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!profile.diseases.includes(trimmed)) {
      setProfile((prev) => ({ ...prev, diseases: [...prev.diseases, trimmed] }));
    }
    setDiseaseInput("");
  };

  const removeDisease = (value: string) => {
    setProfile((prev) => ({ ...prev, diseases: prev.diseases.filter((item) => item !== value) }));
  };

  const hasHypertension = profile.diseases.includes("고혈압");
  const hasDyslipidemia = profile.diseases.includes("이상지질혈증");
  const hasCKD = profile.diseases.includes("신장병");
  const canShowDiseaseDetail = hasHypertension || hasDyslipidemia || hasCKD;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Heart className="w-5 h-5 text-negative-deep" />
        <h2 className="font-black text-lg">건강질환</h2>
      </div>

      <div className="flex flex-wrap gap-2 min-h-12">
        {profile.diseases.map((disease) => (
          <Badge
            key={disease}
            className="bg-negative/10 text-negative-deep hover:bg-negative/10 flex items-center gap-1 pr-1"
          >
            <span>{disease}</span>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-red-200 text-negative-deep hover:text-red-900 pointer-events-auto cursor-pointer focus:outline-none transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                removeDisease(disease);
              }}
              title={`${disease} 삭제`}
              aria-label={`${disease} 삭제`}
            >
              <X className="w-3.5 h-3.5 pointer-events-none" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          id="disease-input"
          placeholder="질환명 입력"
          value={diseaseInput}
          onChange={(e) => setDiseaseInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDisease(diseaseInput);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => addDisease(diseaseInput)}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {COMMON_CONDITIONS.filter((d) => !profile.diseases.includes(d)).map((d) => (
          <Badge
            key={d}
            asChild
            variant="outline"
            className="cursor-pointer hover:bg-primary-pale"
          >
            <button type="button" aria-label={`${d} 추가`} onClick={() => addDisease(d)}>
              <Plus className="w-3 h-3 mr-1" /> {d}
            </button>
          </Badge>
        ))}
      </div>

      {canShowDiseaseDetail && (
        <div className="mt-5 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope className="w-5 h-5 text-amber-600" />
            <span className="font-bold text-amber-800">질병 상세 정보</span>
          </div>

          {hasHypertension && (
            <div className="mb-4">
              <Label className="font-semibold">고혈압 단계</Label>
              <div className="flex gap-4 mt-2">
                {[
                  { label: "Stage I", value: "Stage I" },
                  { label: "Stage II", value: "Stage II" },
                ].map((stage) => (
                  <label className="flex items-center gap-2" key={stage.value}>
                    <input
                      type="radio"
                      name="hypertension_stage"
                      checked={profile.hypertension_stage === stage.value}
                      onChange={() => setProfile((prev) => ({ ...prev, hypertension_stage: stage.value }))}
                    />
                    <span>{stage.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {hasDyslipidemia && (
            <div className="rounded-lg bg-white p-3 border">
              <div className="font-semibold mb-3">이상지질혈증 수치</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>LDL</Label>
                  <Input
                    type="number"
                    placeholder="예: 165"
                    value={profile.ldl_value}
                    onChange={(e) => setProfile((prev) => ({ ...prev, ldl_value: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>TG</Label>
                  <Input
                    type="number"
                    placeholder="예: 220"
                    value={profile.tg_value}
                    onChange={(e) => setProfile((prev) => ({ ...prev, tg_value: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>HDL</Label>
                  <Input
                    type="number"
                    placeholder="예: 38"
                    value={profile.hdl_value}
                    onChange={(e) => setProfile((prev) => ({ ...prev, hdl_value: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {hasCKD && (
            <div className="mt-3">
              <Label htmlFor="gfr">GFR 수치</Label>
              <Input
                id="gfr"
                type="number"
                value={profile.gfr_value}
                placeholder="예: 35"
                onChange={(e) => setProfile((prev) => ({ ...prev, gfr_value: e.target.value }))}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SignupAllergySection({
  profile,
  setProfile,
}: {
  profile: ProfileFormState;
  setProfile: React.Dispatch<React.SetStateAction<ProfileFormState>>;
}) {
  const [allergyInput, setAllergyInput] = useState("");

  const addAllergy = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!profile.allergens.includes(trimmed)) {
      setProfile((prev) => ({ ...prev, allergens: [...prev.allergens, trimmed] }));
    }
    setAllergyInput("");
  };

  const removeAllergy = (value: string) => {
    setProfile((prev) => ({ ...prev, allergens: prev.allergens.filter((item) => item !== value) }));
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-amber-600" />
        <h2 className="font-black text-lg">알레르기</h2>
      </div>

      <div className="flex flex-wrap gap-2 min-h-12">
        {profile.allergens.map((allergy) => (
          <Badge
            key={allergy}
            className="bg-amber-100 text-amber-800 hover:bg-amber-100 flex items-center gap-1 pr-1"
          >
            <span>{allergy}</span>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-amber-200 text-amber-800 hover:text-amber-950 pointer-events-auto cursor-pointer focus:outline-none transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                removeAllergy(allergy);
              }}
              title={`${allergy} 삭제`}
              aria-label={`${allergy} 삭제`}
            >
              <X className="w-3.5 h-3.5 pointer-events-none" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          id="allergy-input"
          placeholder="알레르기 입력"
          value={allergyInput}
          onChange={(e) => setAllergyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAllergy(allergyInput);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => addAllergy(allergyInput)}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="mt-3">
        <AllergenQuickPick selected={profile.allergens} onAdd={addAllergy} />
      </div>
    </Card>
  );
}
