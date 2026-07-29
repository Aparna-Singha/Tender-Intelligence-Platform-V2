"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "../lib/api";

interface OrganisationMembership {
  organisation: { id: string; name: string; type: string };
  role: string;
}

export function Dashboard(): JSX.Element {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<OrganisationMembership[]>(
    [],
  );
  const [message, setMessage] = useState("Loading…");
  async function load(): Promise<void> {
    try {
      await apiRequest("/auth/session");
      setOrganisations(await apiRequest("/organisations"));
      setMessage("");
    } catch {
      router.replace("/login");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await apiRequest("/organisations", {
      body: JSON.stringify({ name: data.get("name"), type: data.get("type") }),
      method: "POST",
    });
    event.currentTarget.reset();
    await load();
  }
  async function logout(): Promise<void> {
    await apiRequest("/auth/logout", { method: "POST" });
    router.replace("/login");
  }
  return (
    <main>
      <h1>Dashboard</h1>
      <p>
        This protected shell intentionally contains no tender or onboarding
        features.
      </p>
      {message && <p>{message}</p>}
      <label>
        Organisation
        <select
          onChange={(event) =>
            void apiRequest(`/organisations/${event.target.value}/select`, {
              method: "POST",
            })
          }
          defaultValue=""
        >
          <option disabled value="">
            Select
          </option>
          {organisations.map(({ organisation, role }) => (
            <option key={organisation.id} value={organisation.id}>
              {organisation.name} — {role}
            </option>
          ))}
        </select>
      </label>
      <form onSubmit={(event) => void create(event)}>
        <h2>Create organisation</h2>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Type
          <select name="type">
            <option value="MSME">MSME</option>
            <option value="CONSULTANT">Consultant</option>
          </select>
        </label>
        <button type="submit">Create</button>
      </form>
      <button onClick={() => void logout()} type="button">
        Log out
      </button>
    </main>
  );
}
