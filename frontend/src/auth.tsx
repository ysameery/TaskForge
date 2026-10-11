
import { useState, type FormEvent } from "react";

import "./App.css";
import {
  Zap,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";

type AuthProps = {
  onLogin: (user: { username: string; token: string }) => void;
};

const API = "http://127.0.0.1:8000";

export default function Auth({ onLogin }: AuthProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const endpoint =
        mode === "register"
          ? `${API}/auth/register`
          : `${API}/auth/login`;

      const body =
        mode === "register"
          ? { username, email, password }
          : { email, password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Authentication failed. Please try again."
        );
      }

      if (mode === "register") {
        setMessage("Registration successful! Please log in.");
        setMode("login");
        setPassword("");
      } else {
        onLogin({
          username: data.username,
          token: data.access_token,
        });
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <Zap size={25} />
          </div>
          <h1>TaskForge</h1>
          <p className="auth-subtitle">
            Organize your work. Achieve more.
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setMessage("");
            }}
          >
            Login
          </button>

          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setMessage("");
            }}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="auth-input">
              <UserRound size={18} />
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                minLength={3}
                maxLength={50}
                required
              />
            </div>
          )}

          <div className="auth-input">
            <Mail size={18} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="auth-input">
            <LockKeyhole size={18} />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "login"
                  ? "current-password"
                  : "new-password"
              }
              minLength={8}
              required
            />
          </div>

          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Login to TaskForge"
                : "Create Account"}
          </button>
        </form>

        <p className="auth-footer">
          {mode === "login"
            ? "New to TaskForge? Create an account to get started."
            : "Already have an account? Switch to Login."}
        </p>
      </div>
    </div>
  );
}
