import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useRealtime } from "./hooks/useRealtime";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import FeedPage from "./pages/FeedPage";
import ExceptionsPage from "./pages/ExceptionsPage";
import ReportsPage from "./pages/ReportsPage";
import DevicesPage from "./pages/DevicesPage";
import AuditPage from "./pages/AuditPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { token } = useAuth();
  useRealtime();

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<FeedPage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
    </Routes>
  );
}
