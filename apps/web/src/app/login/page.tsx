import Link from "next/link";
import type { JSX } from "react";
import { AuthForm } from "../../components/auth-form";

export default function LoginPage(): JSX.Element {
  return (
    <main>
      <h1>Log in</h1>
      <AuthForm mode="login" />
      <Link href="/register">Create account</Link>
    </main>
  );
}
