"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type JSX } from "react";
import { Button, Field, FormMessage, IconButton, Input } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

export function AuthForm({
  mode,
}: {
  readonly mode: "login" | "register";
}): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string): string => {
      const value = values.get(name);
      return typeof value === "string" ? value : "";
    };
    setError("");
    setSubmitting(true);
    try {
      await apiRequest(`/auth/${mode}`, {
        body: JSON.stringify({
          ...(mode === "register"
            ? { display_name: text("display_name") }
            : {}),
          email: text("email"),
          password: text("password"),
        }),
        method: "POST",
      });
      router.push("/dashboard");
    } catch (caught) {
      setError(
        formatApiError(
          caught,
          "The request could not be completed. Please try again.",
        ),
      );
      setSubmitting(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      {mode === "register" && (
        <Field htmlFor="auth-display-name" label="Display name" required>
          <Input
            autoComplete="name"
            id="auth-display-name"
            name="display_name"
            required
          />
        </Field>
      )}
      <Field htmlFor="auth-email" label="Email address" required>
        <Input
          autoCapitalize="none"
          autoComplete="email"
          id="auth-email"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </Field>
      <Field
        hint={
          mode === "register" ? (
            <span id="password-guidance">
              Use at least 12 characters with uppercase, lowercase and a number.
            </span>
          ) : undefined
        }
        htmlFor="auth-password"
        label="Password"
        required
      >
        <span className="password-input">
          <Input
            aria-describedby={
              mode === "register" ? "password-guidance" : undefined
            }
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            id="auth-password"
            minLength={mode === "register" ? 12 : 1}
            name="password"
            pattern={
              mode === "register"
                ? "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}"
                : undefined
            }
            required
            type={showPassword ? "text" : "password"}
          />
          <IconButton
            label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </IconButton>
        </span>
      </Field>
      {error !== "" && <FormMessage>{error}</FormMessage>}
      <Button className="auth-submit" loading={submitting} type="submit">
        {submitting
          ? mode === "login"
            ? "Logging in…"
            : "Creating account…"
          : mode === "login"
            ? "Log in"
            : "Create account"}
      </Button>
    </form>
  );
}
