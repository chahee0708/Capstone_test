import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  User,
  Heart,
  AlertCircle,
  Save,
  Plus,
  X,
  Activity,
  History,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

type Verdict = "추천" | "주의" | "비추천";

interface HistoryItem {
  id: number;
  food_name: string;
  verdict: Verdict;
  searched_at: string;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  추천: "bg-emerald-100 text-emerald-700",
  주의: "bg-amber-100 text-amber-700",
  비추천: "bg-red-100 text-red-700",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProfilePage() {
  const { user, token } = useAuth();
  const USER_ID = user?.id ?? 1;

  const [activeTab, setActiveTab] = useState<"profile" | "history">("profile");

  const [profile, setProfile] = useState({
    name: "",
    age: 0,
    gender: "male",
    weight: 0,
    height: 0,
    diseases: [] as string[],
    allergens: [] as string[],
    hypertension_stage: 1,
    ldl_value: null as number | null,
    tg_value: null as number | null,
    hdl_value: null as number | null,
    gfr_value: 35,
  });

  const [newCondition, setNewCondition] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/users/${USER_ID}`, {
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

  useEffect(() => {
    if (activeTab !== "history") return;
    setHistoryLoading(true);
    fetch(`${API_URL}/history`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        setHistory(Array.isArray(data) ? data : []);
        setHistoryLoading(false);
      })
      .catch(() => {
        toast.error("검색기록 불러오기 실패");
        setHistoryLoading(false);
      });
  }, [activeTab]);

  const handleSaveProfile = async () => {
    try {
      const res = await fetch(`${API_URL}/users/${USER_ID}`, {
        method: "PUT",
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
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">마이페이지</h1>
          <p className="text-gray-600">건강 정보와 검색기록을 확인하세요</p>
        </div>

        {/* ── 탭 ── */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === "profile"
                ? "bg-white border border-b-white border-gray-200 text-emerald-700 -mb-px"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <User className="w-4 h-4" />
            내 정보
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === "history"
                ? "bg-white border border-b-white border-gray-200 text-emerald-700 -mb-px"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <History className="w-4 h-4" />
            검색기록
          </button>
        </div>

        {/* ── 탭 1: 내 정보 ── */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            {/* 기본 정보 */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-600" /> 기본 정보
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(
                  [
                    { id: "name", label: "이름", type: "text", key: "name" },
                    { id: "age", label: "나이", type: "number", key: "age" },
                    { id: "weight", label: "몸무게 (kg)", type: "number", key: "weight" },
                    { id: "height", label: "키 (cm)", type: "number", key: "height" },
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
                          setProfile((prev) => ({ ...prev, gender: e.target.value }))
                        }
                        className="w-4 h-4 text-emerald-600"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Card>

            {/* 질환 */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Heart className="w-5 h-5 text-red-600" /> 건강 질환
              </h3>
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
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="질환명 입력"
                  value={newCondition}
                  onChange={(e) => setNewCondition(e.target.value)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && addToList("diseases", newCondition)
                  }
                />
                <Button onClick={() => addToList("diseases", newCondition)} variant="outline">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {COMMON_CONDITIONS.filter((c) => !profile.diseases.includes(c)).map((c) => (
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

            {/* 질병 심각도 상세 입력 */}
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
                          <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="hypertension_stage"
                              value={opt.value}
                              checked={profile.hypertension_stage === opt.value}
                              onChange={() =>
                                setProfile((prev) => ({ ...prev, hypertension_stage: opt.value }))
                              }
                              className="w-4 h-4 text-amber-600"
                            />
                            <span className="text-sm">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasDyslipidemia && (
                    <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                      <p className="text-sm font-medium text-blue-800">
                        이상지질혈증 — 지질 수치 입력 (mg/dL)
                      </p>
                      {[
                        {
                          key: "ldl_value" as const,
                          label: "LDL 콜레스테롤",
                          placeholder: "예: 165",
                          hint: "정상 <130 / 경계 130~159 / 높음 160~189 / 매우높음 ≥190",
                        },
                        {
                          key: "tg_value" as const,
                          label: "중성지방 (TG)",
                          placeholder: "예: 220",
                          hint: "정상 <150 / 경계 150~199 / 높음 200~499 / 매우높음 ≥500",
                        },
                        {
                          key: "hdl_value" as const,
                          label: "HDL 콜레스테롤",
                          placeholder: "예: 38",
                          hint: "정상 ≥40 / 낮음(위험) <40",
                        },
                      ].map((f) => (
                        <div key={f.key} className="flex items-center gap-3">
                          <Label className="w-36 text-sm text-gray-700">{f.label}</Label>
                          <Input
                            type="number"
                            placeholder={f.placeholder}
                            value={profile[f.key] ?? ""}
                            onChange={(e) =>
                              setProfile((prev) => ({
                                ...prev,
                                [f.key]: e.target.value === "" ? null : Number(e.target.value),
                              }))
                            }
                            className="w-28"
                          />
                          <span className="text-xs text-gray-500">{f.hint}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {hasCKD && (
                    <div>
                      <Label className="text-base font-medium" htmlFor="gfr_value">
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
                          className="w-40"
                        />
                        <span className="text-sm text-gray-500">mL/min/1.73m²</span>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* 알레르기 */}
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
                <Button onClick={() => addToList("allergens", newAllergy)} variant="outline">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {COMMON_ALLERGIES.filter((a) => !profile.allergens.includes(a)).map((a) => (
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

            {/* 저장 버튼 */}
            <Button
              onClick={handleSaveProfile}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              size="lg"
            >
              <Save className="w-5 h-5 mr-2" /> 프로필 저장
            </Button>
          </div>
        )}

        {/* ── 탭 2: 검색기록 ── */}
        {activeTab === "history" && (
          <div>
            {historyLoading ? (
              <div className="p-8 text-center text-gray-500">불러오는 중...</div>
            ) : history.length === 0 ? (
              <Card className="p-12 text-center text-gray-400">
                <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>아직 검색기록이 없습니다.</p>
                <p className="text-sm mt-1">음식 분석을 해보세요!</p>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">음식명</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">판정 결과</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">검색 날짜</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {history.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium">{item.food_name}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                              VERDICT_STYLE[item.verdict] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {item.verdict}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(item.searched_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
