import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { FoodAnalysisPage } from "./pages/FoodAnalysisPage";
import { ProfilePage } from "./pages/ProfilePage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "analysis", Component: FoodAnalysisPage },
      { path: "profile", Component: ProfilePage },
    ],
  },
]);