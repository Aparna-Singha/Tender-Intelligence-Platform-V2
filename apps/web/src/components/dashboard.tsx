"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "../lib/api";

interface OrganisationMembership {
  organisation: { id: string; name: string; type: string };
  role: string;
}

interface DashboardGuidance {
  display_mode: "BEGINNER" | "PROFESSIONAL";
  recommendations: readonly {
    action: string;
    id: string;
    priority: string;
  }[];
}

export function Dashboard(): JSX.Element {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<OrganisationMembership[]>(
    [],
  );
  const [message, setMessage] = useState("Loading…");
  const [guidance, setGuidance] = useState<
    Readonly<Record<string, DashboardGuidance>>
  >({});
  async function load(): Promise<void> {
    try {
      await apiRequest("/auth/session");
      const memberships =
        await apiRequest<OrganisationMembership[]>("/organisations");
      setOrganisations(memberships);
      const dashboardEntries = await Promise.all(
        memberships.map(
          async ({ organisation }) =>
            [
              organisation.id,
              await apiRequest<DashboardGuidance>(
                `/organisations/${organisation.id}/dashboard-recommendations`,
              ),
            ] as const,
        ),
      );
      setGuidance(Object.fromEntries(dashboardEntries));
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
      {organisations.map(({ organisation }) => (
        <section key={organisation.id}>
          <h2>{organisation.name}</h2>
          <Link href={`/onboarding/${organisation.id}`}>
            Continue onboarding or edit profile
          </Link>
          <p>
            Dashboard mode:{" "}
            {guidance[organisation.id]?.display_mode ?? "BEGINNER"}
          </p>
          <div aria-label={`Recommendations for ${organisation.name}`}>
            {guidance[organisation.id]?.recommendations.map(
              (recommendation) => (
                <article key={recommendation.id}>
                  <h3>{recommendation.priority} priority</h3>
                  <p>{recommendation.action}</p>
                </article>
              ),
            )}
          </div>
        </section>
      ))}
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
