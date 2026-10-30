"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, formatApiError } from "../../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  FileText,
  ArrowLeft,
  ArrowRight,
  Mail,
  Lock,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";

export function AuthScreen({
  mode,
}: {
  readonly mode: "login" | "register";
}): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const isLogin = mode === "login";
  const setAuthMode = (next: "login" | "register"): void =>
    router.push(`/${next}`);
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (authLoading) return;
    setError("");
    setAuthLoading(true);
    try {
      await apiRequest(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          ...(isLogin ? {} : { display_name: name }),
        }),
      });
      router.push("/dashboard");
    } catch (caught) {
      setError(
        formatApiError(
          caught,
          "The request could not be completed. Please try again.",
        ),
      );
      setAuthLoading(false);
    }
  };

  return (
    <div className="zai-design min-h-screen grid lg:grid-cols-2 bg-[#F9FAFB]">
      {/* Left — form */}
      <div className="flex flex-col px-6 sm:px-10 lg:px-16 py-8">
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111827] transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </button>

        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full py-10">
          <div className="flex items-center gap-2.5 mb-8">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] flex items-center justify-center">
              <FileText className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <div className="text-[#111827] text-sm font-semibold leading-tight">
                Tender Intelligence
              </div>
              <div className="text-[10px] text-[#6B7280] uppercase tracking-wider leading-tight">
                Platform V2
              </div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">
            {isLogin ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-[#6B7280] leading-relaxed">
            {isLogin
              ? "Sign in to your tender workspace to continue preparation."
              : "Create your account, then create or join an organisation to start preparing evidence-backed responses."}
          </p>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="mt-7 space-y-4"
          >
            {!isLogin && (
              <>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="name"
                    className="text-sm font-medium text-[#111827]"
                  >
                    Full name
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                    <Input
                      id="name"
                      name="display_name"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="pl-9 h-11 border-[#E5E7EB] bg-white focus:border-[#FF5722] focus:ring-[#FF5722]/20"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-sm font-medium text-[#111827]"
              >
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="email"
                  name="email"
                  required
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.in"
                  className="pl-9 h-11 border-[#E5E7EB] bg-white focus:border-[#FF5722] focus:ring-[#FF5722]/20"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium text-[#111827]"
                >
                  Password
                </Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="password"
                  name="password"
                  required
                  minLength={isLogin ? 1 : 12}
                  maxLength={128}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  pattern={
                    isLogin
                      ? undefined
                      : "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}"
                  }
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 pr-10 h-11 border-[#E5E7EB] bg-white focus:border-[#FF5722] focus:ring-[#FF5722]/20"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280]"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {!isLogin && (
              <p className="text-xs text-[#6B7280]">
                Use at least 12 characters with uppercase, lowercase and a
                number.
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[var(--brand-danger-soft)] px-3 py-2.5 text-sm text-[var(--brand-danger)]"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={authLoading}
              className="w-full h-11 bg-[#FF5722] hover:bg-[#E64A19] text-white text-sm font-medium"
            >
              {authLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isLogin ? "Signing in…" : "Creating workspace…"}
                </>
              ) : (
                <>
                  {isLogin ? "Sign in" : "Create account"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-[#6B7280]">
            {isLogin ? (
              <>
                New to the platform?{" "}
                <button
                  onClick={() => {
                    setError("");
                    setAuthMode("register");
                  }}
                  className="text-[#FF5722] font-medium hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have a workspace?{" "}
                <button
                  onClick={() => {
                    setError("");
                    setAuthMode("login");
                  }}
                  className="text-[#FF5722] font-medium hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-[#9CA3AF]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Session protected with CSRF and organisation-scoped permissions.
          </div>
        </div>
      </div>

      {/* Right — showcase panel */}
      <div className="hidden lg:flex relative bg-[var(--brand-nav)] overflow-hidden">
        <div className="absolute inset-0 bg-dots opacity-20" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[#0EA5E9]/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-[#FF5722]/20 blur-3xl" />

        <div className="relative flex flex-col justify-center px-12 xl:px-16 w-full text-white">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 w-fit mb-6">
            <ShieldCheck className="h-3.5 w-3.5" /> Evidence-first tender
            preparation
          </div>
          <h2 className="text-3xl xl:text-4xl font-bold tracking-tight leading-tight max-w-md">
            From a 100-page tender to a reviewable, citation-backed response.
          </h2>
          <p className="mt-5 text-white/60 leading-relaxed max-w-md">
            Upload, extract, assess, prepare, review and export — every step
            grounded in real backend state, every claim traceable to its source.
          </p>

          <div className="mt-10 space-y-3 max-w-md">
            {[
              "Citation-backed AI assistance grounded in your documents",
              "Eligibility comparison with six explicit assessment states",
              "Human-in-the-loop review and controlled package export",
              "Organisation-scoped permissions and private document storage",
            ].map((p) => (
              <div key={p} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-[#1D9A55] shrink-0 mt-0.5" />
                <span className="text-sm text-white/85 leading-relaxed">
                  {p}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-xl border border-white/10 bg-white/5 p-5 max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] flex items-center justify-center">
                <FileText className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="text-sm font-semibold">
                Your private workspace
              </div>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Sign in with your account to access your organisation?s private
              tenders, evidence and drafts. Human review remains required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
