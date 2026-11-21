/**
 * RootLayout.tsx
 *
 * 역할: 로그인한 사용자용 공통 레이아웃. 상단 헤더(로고·메뉴·로그아웃) + 페이지 내용(Outlet).
 *       로그인하지 않았으면 /login 으로 보낸다.
 *
 * 이번에 바뀐 점:
 *   - 바코드 기능 삭제에 맞춰 "분석" 메뉴 아이콘을 바코드(ScanBarcode) → 검색(Search) 으로 변경
 *
 * 쓰이는 곳: routes.ts 에서 "/" 아래 모든 페이지(홈·분석·프로필)를 감싼다
 */
import { Outlet, Link, useLocation, Navigate } from "react-router";
import { Home, Search, User, LogOut } from "lucide-react";
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
            {/* 로고: 아이콘 없이 글자만, 브랜드색. 누르면 홈 (상단 메뉴에 "홈" 이 없어서 이것이 홈 버튼) */}
            <Link to="/" aria-label="SafeBite 홈" className="font-bold text-xl text-[#388E3C]">
              SafeBite
            </Link>
            {/* 노트북 상단 메뉴: 아이콘 없이 글자만.
                지금 페이지 = 브랜드색 30% 배경, 마우스 올림 = 브랜드색 10%, 누르는 순간 = 30%. 로그아웃은 아이콘만 */}
            <nav className="hidden md:flex items-center gap-2">
              {/* 상단 메뉴는 프로필만: 홈은 왼쪽 SafeBite 글자, 검색·사진 분석은 홈 화면에서 한다. 휴대폰 아래 메뉴는 그대로 */}
              {navItems.filter((item) => item.path === "/profile").map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      // 연한 배경에서는 흰 글자가 잘 안 보여서 진한 초록 글자
                      isActive
                        ? "bg-[#388E3C]/30 text-[#1B5E20] font-medium"
                        : "text-gray-600 hover:bg-[#388E3C]/10 active:bg-[#388E3C]/30"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {/* 로그아웃: 글자 대신 아이콘 (화면 읽기 프로그램용 이름은 aria-label) */}
              <button
                onClick={logout}
                aria-label="로그아웃"
                title="로그아웃"
                className="p-2 rounded-lg text-gray-600 hover:bg-[#388E3C]/10 active:bg-[#388E3C]/30 transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* flex flex-col: 페이지가 남은 높이를 채울 수 있게 (홈 배경색) */}
      <main className="flex-1 flex flex-col">
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
                  isActive ? "text-[#388E3C]" : "text-gray-600"
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