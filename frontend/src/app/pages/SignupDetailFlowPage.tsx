import { useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { User, ChevronRight, Save } from "lucide-react";
import {
  SignupOcrPanel,
  SignupPersonalInfoSection,
  SignupHealthConditionsSection,
  SignupAllergySection,
  emptyProfile,
} from "../components/signup/SignupDetailSections";

export function SignupDetailFlowPage() {
  const navigate = useNavigate();
  const [signup, setSignup] = useState({
    name: "",
    id: "",
    password: "",
    confirmPassword: "",
  });
  const [profile, setProfile] = useState(emptyProfile);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string>("이미지 미선택");

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wide">
              SafeBite Signup
            </span>
            <h1 className="text-3xl font-black mt-2">회원가입 정보 입력</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-slate-300"
              onClick={() => navigate("/")}
            >
              나중에 입력할게요
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700">
              가입 완료
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4">
            <Card className="p-6 sticky top-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-2xl bg-emerald-100 p-2 text-emerald-700">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">계정 등록</div>
                  <div className="font-bold text-xl">회원 정보</div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">이름</Label>
                  <Input
                    id="name"
                    value={signup.name}
                    placeholder="이름"
                    onChange={(e) => setSignup((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="id">아이디</Label>
                  <Input
                    id="id"
                    value={signup.id}
                    placeholder="아이디"
                    onChange={(e) => setSignup((prev) => ({ ...prev, id: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="password">비밀번호</Label>
                  <Input
                    id="password"
                    type="password"
                    value={signup.password}
                    placeholder="비밀번호"
                    onChange={(e) => setSignup((prev) => ({ ...prev, password: e.target.value }))}
                  />
                </div>

                <div>
                  <Label htmlFor="confirmPassword">비밀번호 확인</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={signup.confirmPassword}
                    placeholder="비밀번호 확인"
                    onChange={(e) =>
                      setSignup((prev) => ({ ...prev, confirmPassword: e.target.value }))
                    }
                  />
                </div>

                <SignupOcrPanel
                  profile={profile}
                  setProfile={setProfile}
                  selectedImage={selectedImage}
                  setSelectedImage={setSelectedImage}
                  ocrStatus={ocrStatus}
                  setOcrStatus={setOcrStatus}
                />

                <div className="flex gap-2">
                  <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    회원가입
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-slate-300"
                    onClick={() => {
                      setProfile(emptyProfile);
                      setSignup({
                        name: "",
                        id: "",
                        password: "",
                        confirmPassword: "",
                      });
                    }}
                  >
                    초기화
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  className="w-full text-slate-500"
                  onClick={() => navigate("/")}
                >
                  나중에 입력할게요 <ChevronRight className="w-4 h-4 ml-1 inline" />
                </Button>
              </div>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-8 space-y-4">
            <SignupPersonalInfoSection profile={profile} setProfile={setProfile} />
            <SignupHealthConditionsSection profile={profile} setProfile={setProfile} />
            <SignupAllergySection profile={profile} setProfile={setProfile} />

            <div className="flex gap-3 justify-end">
              <Button variant="outline" className="border-slate-300" onClick={() => navigate("/")}>
                나중에 입력할게요
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-4 h-4 mr-1" /> 가입 정보 저장
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
