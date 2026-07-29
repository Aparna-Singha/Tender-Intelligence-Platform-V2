"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";

export function AuthForm({
  mode,
}: {
  readonly mode: "login" | "register";
}): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    const values = new FormData(event.currentTarget);
    const text = (name: string): string => {
      const value = values.get(name);
      return typeof value === "string" ? value : "";
    };
    const input = {
      ...(mode === "register" ? { display_name: text("display_name") } : {}),
      email: text("email"),
      password: text("password"),
    };
    try {
      await apiRequest(`/auth/${mode}`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      router.push("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      {mode === "register" && (
        <label>
          Display name
          <input name="display_name" required />
        </label>
      )}
      <label>
        Email
        <input name="email" required type="email" />
      </label>
      <label>
        Password
        <input
          minLength={mode === "register" ? 12 : 1}
          name="password"
          required
          type="password"
        />
      </label>
      <button type="submit">
        {mode === "login" ? "Log in" : "Create account"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
