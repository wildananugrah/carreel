import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useAuth } from "../lib/auth";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-[#0f0f0f]">
      <div className="mb-8 text-center">
        <img
          src="/car-reel-logo.png"
          alt="Carreel"
          className="h-16 mx-auto"
          loading="eager"
          decoding="async"
        />
        <p className="text-neutral-500 mt-2">Vehicle Inspection Platform</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="driver@example.com"
          required
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
          autoComplete="current-password"
        />

        <Button type="submit" className="w-full" loading={loading}>
          Log In
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500 mt-6">
        Don't have an account?{" "}
        <Link to="/register" className="text-yellow-400 font-medium">
          Register
        </Link>
      </p>
    </div>
  );
}
