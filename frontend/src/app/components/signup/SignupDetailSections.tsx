import { useState } from "react";
import {
  User,
  Heart,
  AlertCircle,
  X,
  Plus,
  Camera,
  ChevronRight,
  Save,
  Image,
  Stethoscope,
  Activity,
} from "lucide-react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

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
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setSelectedImage(objectUrl);
    setOcrStatus(`OCR 준비 완료: ${file.name}`);

    const fileName = file.name.toLowerCase();
    if (fileName.includes("profile") || fileName.includes("patient")) {
      setProfile((prev) => ({
        ...prev,
        name: prev.name || "홍길동",
        age: prev.age || "36",
        gender: prev.gender || "male",
        weight: prev.weight || "72",
        height: prev.height || "176",
        diseases: prev.diseases.length ? prev.diseases : ["고혈압", "이상지질혈증"],
        allergens: prev.allergens.length ? prev.allergens : ["우유"],
      }));
      setOcrStatus("OCR로 기본 정보와 질환/알레르기 항목을 확인했습니다");
    }
  };

  const runOcrDemo = () => {
    if (!selectedImage) {
      setOcrStatus("이미지를 선택하면 OCR로 항목을 채울 수 있습니다");
      return;
    }

    setOcrStatus("OCR 스캔 완료: 이름, 나이, 성별, 키/몸무게, 질환, 알레르기 후보를 읽었습니다");
    setProfile((prev) => ({
      ...prev,
      name: prev.name || "홍길동",
      age: prev.age || "36",
      gender: prev.gender || "male",
      weight: prev.weight || "72",
      height: prev.height || "176",
      diseases: prev.diseases.length ? prev.diseases : ["고혈압"],
      allergens: prev.allergens.length ? prev.allergens : ["우유"],
    }));
  };

  return (
    <div className="rounded-lg bg-slate-50 p-4 border">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">추가 정보 입력</span>
        <span className="text-xs text-slate-500">선택 사항</span>
      </div>
      <div className="mt-4">
        <div className="flex gap-2">
          <label className="w-full cursor-pointer rounded-lg border border-dashed border-emerald-500 px-3 py-3 text-center text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
            <Camera className="w-4 h-4 inline mr-1" />
            이미지로 OCR
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          <Button variant="outline" size="sm" type="button" onClick={runOcrDemo}>
            <Image className="w-4 h-4 mr-1" /> OCR
          </Button>
        </div>
        <div className="mt-2 text-xs text-slate-500">{ocrStatus}</div>
        {selectedImage && (
          <div className="mt-4">
            <img src={selectedImage} alt="OCR preview" className="w-full h-40 object-cover rounded-lg border" />
          </div>
        )}
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
        <User className="w-5 h-5 text-emerald-600" />
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
        <Heart className="w-5 h-5 text-red-600" />
        <h2 className="font-black text-lg">건강질환</h2>
      </div>

      <div className="flex flex-wrap gap-2 min-h-12">
        {profile.diseases.map((disease) => (
          <Badge
            key={disease}
            className="bg-red-100 text-red-700 hover:bg-red-100 flex items-center gap-1 pr-1"
          >
            <span>{disease}</span>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-red-200 text-red-700 hover:text-red-900 pointer-events-auto cursor-pointer focus:outline-none transition-colors"
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
            variant="outline"
            className="cursor-pointer hover:bg-emerald-50"
            onClick={() => addDisease(d)}
          >
            <Plus className="w-3 h-3 mr-1" /> {d}
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

      <div className="flex flex-wrap gap-2 mt-3">
        {COMMON_ALLERGIES.filter((a) => !profile.allergens.includes(a)).map((a) => (
          <Badge
            key={a}
            variant="outline"
            className="cursor-pointer hover:bg-emerald-50"
            onClick={() => addAllergy(a)}
          >
            <Plus className="w-3 h-3 mr-1" /> {a}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
