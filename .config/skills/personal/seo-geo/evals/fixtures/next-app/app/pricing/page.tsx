"use client";
import { useEffect, useState } from "react";

type Plan = { name: string; gbpPerUser: number; features: string[] };

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    document.title = "Pricing | Rotaly";
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d: { plans: Plan[] }) => setPlans(d.plans));
  }, []);

  if (plans.length === 0) return <div className="spinner" />;

  return (
    <main>
      <h1>Simple pricing per staff member</h1>
      <div className="plans">
        {plans.map((p) => (
          <div className="plan" key={p.name}>
            <h2>{p.name}</h2>
            <p>£{p.gbpPerUser} per user / month</p>
            <ul>
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
