import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { FocusMark } from "@/components/FocusMark";

export function AuthPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const authMutation = useMutation({
    mutationFn: async () => {
      if (mode === "register")
        return api.register({
          displayName: displayName.trim(),
          email: email.trim(),
          password,
        });
      const response = await api.login({ email: email.trim(), password });
      return { ...response, claimedLegacyWorkspace: false };
    },
    onSuccess: async (response) => {
      setMessage(
        response.claimedLegacyWorkspace
          ? "Your existing local workspace was securely linked to this new account."
          : "Your private workspace is ready.",
      );
      queryClient.setQueryData(["auth", "session"], { user: response.user });
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (mode === "register" && !displayName.trim()) return;
    authMutation.mutate();
  }

  function changeMode(nextMode: "register" | "login") {
    setMode(nextMode);
    setMessage(null);
    authMutation.reset();
  }

  const isRegister = mode === "register";
  return (
    <main className="auth-page">
      <section className="auth-ambient" aria-hidden="true">
        <span className="auth-orbit auth-orbit-one" />
        <span className="auth-orbit auth-orbit-two" />
        <span className="auth-orbit-core">
          <Sparkles size={19} />
        </span>
      </section>
      <section className="auth-panel">
        <div className="auth-brand-row">
          <FocusMark />
          <span className="auth-brand-kicker">PRIVATE WORKSPACE</span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">
            {isRegister ? "START WITH YOUR OWN SPACE" : "WELCOME BACK"}
          </span>
          <h1>
            {isRegister ? "Focus, safely yours." : "Return to what matters."}
          </h1>
          <p>
            {isRegister
              ? "Create a private FocusAI workspace. Your data is isolated by a secure server session—not just hidden in the interface."
              : "Sign in to your private FocusAI workspace."}
          </p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? "active" : ""}
            onClick={() => changeMode("register")}
          >
            Create account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? "active" : ""}
            onClick={() => changeMode("login")}
          >
            Sign in
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {isRegister && (
            <label>
              Your name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                autoComplete="name"
                placeholder="How should FocusAI greet you?"
                required
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              required
            />
          </label>
          <label>
            Password
            <span className="password-input-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={
                  isRegister ? "At least 12 characters" : "Your password"
                }
                minLength={12}
                maxLength={1_024}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            {isRegister && (
              <span className="field-helper">
                Use a memorable passphrase of at least 12 characters.
              </span>
            )}
          </label>
          {authMutation.isError && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} /> {authMutation.error.message}
            </p>
          )}
          {message && (
            <p className="auth-success" role="status">
              <ShieldCheck size={16} /> {message}
            </p>
          )}
          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={
              authMutation.isPending ||
              !email.trim() ||
              password.length < 12 ||
              (isRegister && !displayName.trim())
            }
          >
            <LockKeyhole size={16} />
            {authMutation.isPending
              ? "Securing your session…"
              : isRegister
                ? "Create private workspace"
                : "Sign in securely"}
            {!authMutation.isPending && <ArrowRight size={16} />}
          </button>
        </form>
        <div className="auth-assurances">
          <span>
            <ShieldCheck size={14} /> HTTP-only session cookie
          </span>
          <span>
            <LockKeyhole size={14} /> Memory-hard password hashing
          </span>
        </div>
      </section>
    </main>
  );
}
