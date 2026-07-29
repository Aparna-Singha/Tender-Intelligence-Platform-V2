import Link from "next/link";
import type { JSX } from "react";
import { AuthForm } from "../../components/auth-form";

export default function RegisterPage(): JSX.Element {
  return (
    <main>
      <h1>Create account</h1>
      <AuthForm mode="register" />
      <Link href="/login">Log in</Link>
    </main>
  );
}
