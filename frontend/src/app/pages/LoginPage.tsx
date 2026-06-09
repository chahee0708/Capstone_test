import { useState } from "react";
import { useNavigate } from "react-router";
import { Heart, LogIn, User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

const DEMO_USERS = [
  { id: 1, name: "홍길동", age: 45, gender: "남성", diseases: ["2형 당뇨"], allergens: ["우유"] },
  { id: 2, name: "이영희", age: 55, gender: "여성", diseases: ["고혈압 Stage II"], allergens: [] },
  { id: 3, name: "박민수", age: 50, gender: "남성", diseases: ["이상지질혈증"], allergens: [] },
  { id: 4, name: "최지수", age: 60, gender: "여성", diseases: ["신장병 (GFR 30)"], allergens: [] },
  { id: 5, name: "김철수", age: 28, gender: "남성", diseases: ["1형 당뇨"], allergens: [] },
  { id: 6, name: "정하나", age: 30, gender: "여성", diseases: [], allergens: [] },
];

const DISEASE_COLOR: Record<string, string> = {
  "2형 당뇨": "bg-blue-100 text-blue-700",
  "1형 당뇨": "bg-indigo-100 text-indigo-700",
  "고혈압 Stage II": "bg-red-100 text-red-700",
  "이상지질혈증": "bg-orange-100 text-orange-700",
  "신장병 (GFR 30)": "bg-purple-100 text-purple-700",
};

export function LoginPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(null);

  const handleLogin = () => {
    if (!selected) return;
    const user = DEMO_USERS.find((u) => u.id === selected)!;
    localStorage.setItem("userId", String(user.id));
    localStorage.setItem("userName", user.name);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-blue-50 to-teal-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
              <Heart className="w-7 h-7 text-white" />
            </div>
            <span className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
              SafeBite
            </span>
          </div>
          <p className="text-gray-500 text-sm">시연용 계정을 선택하세요</p>
        </div>

        {/* 사용자 목록 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {DEMO_USERS.map((user) => (
            <Card
              key={user.id}
              onClick={() => setSelected(user.id)}
              className={`p-4 cursor-pointer transition-all border-2 ${
                selected === user.id
                  ? "border-emerald-500 bg-emerald-50 shadow-md"
                  : "border-gray-200 hover:border-emerald-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    selected === user.id
                      ? "bg-emerald-500 text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <User className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{user.name}</span>
                    <span className="text-xs text-gray-400">
                      {user.age}세 · {user.gender}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {user.diseases.length === 0 ? (
                      <Badge className="bg-gray-100 text-gray-500 text-xs">질환 없음</Badge>
                    ) : (
                      user.diseases.map((d) => (
                        <Badge
                          key={d}
                          className={`text-xs ${DISEASE_COLOR[d] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {d}
                        </Badge>
                      ))
                    )}
                    {user.allergens.map((a) => (
                      <Badge key={a} className="bg-amber-100 text-amber-700 text-xs">
                        {a} 알레르기
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Button
          onClick={handleLogin}
          disabled={!selected}
          className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-base"
        >
          <LogIn className="w-5 h-5 mr-2" />
          {selected
            ? `${DEMO_USERS.find((u) => u.id === selected)?.name}으로 로그인`
            : "계정을 선택하세요"}
        </Button>
      </div>
    </div>
  );
}
