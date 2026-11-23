/**
 * RootLayout.tsx
 *
 * 역할: 로그인한 사용자용 공통 레이아웃. 상단 헤더(로고·메뉴·로그아웃) + 페이지 내용(Outlet).
 *       로그인하지 않았으면 /login 으로 보낸다.
 *
 * 이번에 바뀐 점:
 *   - [추가] 휴대폰 화면 헤더 오른쪽에 로그아웃 버튼
 *       위쪽 메뉴(로그아웃 포함)는 넓은 화면(md 이상)에서만 보여서 휴대폰에서는 로그아웃할 방법이 없었다
 *       → 시연 때 질환별 계정을 바꿔 가며 쓸 수 없던 문제
 *   - [변경] 휴대폰 로그아웃 버튼은 아이콘만 ("로그아웃" 글자와 사용자 이름은 뺌, 헤더가 너무 꽉 차서)
 *
 * 이전 변경:
 *   - 바코드 기능 삭제에 맞춰 "분석" 메뉴 아이콘을 바코드(ScanBarcode) → 검색(Search) 으로 변경
 *
 * 쓰이는 곳: routes.ts 에서 "/" 아래 모든 페이지(홈·분석·프로필)를 감싼다
 */
import { Outlet, Link, useLocation, Navigate } from "react-router";
import { Home, Search, User, Heart, LogOut } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

export function RootLayout() {
  const location = useLocation();
  const { user, logout } = useAuth();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const navItems = [
    { path: "/", icon: Home, label: "홈" },
    { path: "/analysis", icon: Search, label: "분석" }, // 바코드 기능 삭제로 아이콘을 검색으로 변경
    { path: "/profile", icon: User, label: "프로필" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-blue-500 rounded-lg flex items-center justify-center">
                <Heart className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg">Before you Bite</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? "bg-emerald-50 text-emerald-600"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                );
              })}
              <button
                onClick={logout}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">로그아웃</span>
              </button>
            </nav>
            {/* [추가] 휴대폰 화면: 로그아웃 아이콘 (위 메뉴는 md 이상에서만 보인다)
                [변경] 글자·사용자 이름 없이 아이콘만 (휴대폰 헤더가 꽉 차서). 화면 낭독기용 이름은 aria-label·title */}
            <button
              type="button"
              onClick={logout}
              aria-label="로그아웃"
              title="로그아웃"
              className="md:hidden shrink-0 p-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden bg-white border-t border-gray-200 sticky bottom-0 z-50">
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-1 py-3 px-4 flex-1 ${
                  isActive ? "text-emerald-600" : "text-gray-600"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}