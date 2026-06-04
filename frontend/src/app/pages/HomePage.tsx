import { Link } from "react-router";
import { ScanBarcode, Search, Camera, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export function HomePage() {
  const features = [
    {
      icon: ScanBarcode,
      title: "바코드 스캔",
      description: "제품 바코드를 스캔하여 즉시 분석",
      color: "from-emerald-500 to-teal-500",
    },
    {
      icon: Search,
      title: "제품명 검색",
      description: "식품명으로 빠르게 찾기",
      color: "from-blue-500 to-cyan-500",
    },
    {
      icon: Camera,
      title: "영양성분표 촬영",
      description: "OCR로 자동 정보 인식",
      color: "from-purple-500 to-pink-500",
    },
  ];

  return (
    <div className="min-h-full">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-emerald-50 via-blue-50 to-teal-50 py-12 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full mb-6 shadow-sm">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span className="text-sm text-gray-700">개인 맞춤 식품 분석</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold mb-6 bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
              당신의 건강을 지키는
              <br />
              스마트 식품 분석 서비스
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              건강 프로필을 기반으로 식품 성분을 분석하고,
              <br className="hidden sm:block" />
              3초 만에 적합성을 확인하세요
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/analysis">
                <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto">
                  <ScanBarcode className="w-5 h-5 mr-2" />
                  지금 분석 시작하기
                </Button>
              </Link>
              <Link to="/profile">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-emerald-600 text-emerald-600 hover:bg-emerald-50 w-full sm:w-auto"
                >
                  프로필 설정하기
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">다양한 분석 방법</h2>
            <p className="text-gray-600">편한 방법으로 식품 정보를 입력하세요</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card
                  key={index}
                  className="p-6 hover:shadow-lg transition-shadow cursor-pointer group"
                >
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600">{feature.description}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}