import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      login(res.token, res.staff);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink-950">
      <div className="w-full max-w-md">
        <h1 className="font-sans text-4xl font-bold tracking-tight text-veld-600 mb-2">
          E-Wallet Recon
        </h1>
        <p className="text-sand-200 mb-8 font-sans">Staff sign-in for deposit reconciliation</p>
        <form
          onSubmit={onSubmit}
          className="space-y-4 border border-ink-700 bg-ink-900 p-6 rounded-lg shadow-fb-md"
        >
          <label className="block font-sans text-sm">
            <span className="text-sand-200 font-semibold">Email</span>
            <input
              className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500 focus:ring-2 focus:ring-veld-700"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label className="block font-sans text-sm">
            <span className="text-sand-200 font-semibold">Password</span>
            <input
              className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500 focus:ring-2 focus:ring-veld-700"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error && <p className="text-clay-500 text-sm font-sans">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-veld-600 hover:bg-veld-500 disabled:opacity-50 py-2.5 font-sans font-semibold text-white"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
