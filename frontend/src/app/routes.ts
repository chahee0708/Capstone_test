import { createBrowserRouter, redirect } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { FoodAnalysisPage } from "./pages/FoodAnalysisPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/signup",
    Component: SignupPage,
  },
  {
    // 예전 2단계 가입 화면. 서버에 저장되지 않고 평문 비밀번호를 localStorage 에 남겼기 때문에
    // 통합 가입 화면(/signup)으로 보낸다.
    path: "/signup-detail",
    loader: () => redirect("/signup"),
  },
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "analysis", Component: FoodAnalysisPage },
      { path: "profile", Component: ProfilePage },
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
]);