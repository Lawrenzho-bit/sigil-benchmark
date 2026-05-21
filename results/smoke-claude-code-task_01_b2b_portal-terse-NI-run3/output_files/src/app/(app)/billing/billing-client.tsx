"use client";

import { useState } from "react";
import type { Plan } from "@prisma/client";
import { apiFetch } from "@/components/forms";

interface PlanCard {
  id: Plan;
  name: string;
  priceLabel: string;
  features: string[];
}

export function BillingClient({
  currentPlan,
  canManage,
  billingEnabled,
  hasCustomer,
  plans,
}: {
  currentPlan: Plan;
  canManage: boolean;
  billingEnabled: boolean;
  hasCustomer: boolean;
  plans: PlanCard[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: Plan) {
    setError(null);
    setBusy(plan);
    const res = await apiFetch<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: { plan },
    });
    if (res.ok && res.data.url) {
      window.location.href = res.data.url;
    } else {
      setBusy(null);
      setError(res.error ?? "Could not start checkout.");
    }
  }

  async function openPortal() {
    setError(null);
    setBusy("portal");
    const res = await apiFetch<{ url: string }>("/api/billing/portal", {
      method: "POST",
    });
    if (res.ok && res.data.url) {
      window.location.href = res.data.url;
    } else {
      setBusy(null);
      setError(res.error ?? "Could not open the billing portal.");
    }
  }

  const actionsDisabled = !canManage || !billingEnabled;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlan;
          return (
            <div
              key={p.id}
              className={`card flex flex-col ${
                isCurrent ? "ring-2 ring-brand-500" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-zinc-900">{p.name}</h3>
                {isCurrent && (
                  <span className="badge bg-brand-50 text-brand-700">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-1 text-lg font-medium text-zinc-900">
                {p.priceLabel}
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-zinc-600">
                {p.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              <button
                className="btn-primary mt-4"
                disabled={isCurrent || actionsDisabled || busy !== null}
                onClick={() => checkout(p.id)}
              >
                {isCurrent
                  ? "Current plan"
                  : busy === p.id
                    ? "Redirecting…"
                    : "Choose plan"}
              </button>
            </div>
          );
        })}
      </div>

      {canManage && billingEnabled && hasCustomer && (
        <div className="card flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-zinc-900">Billing portal</h3>
            <p className="text-sm text-zinc-500">
              Update your card, download invoices or cancel.
            </p>
          </div>
          <button
            className="btn-secondary"
            disabled={busy !== null}
            onClick={openPortal}
          >
            {busy === "portal" ? "Opening…" : "Open portal"}
          </button>
        </div>
      )}
    </div>
  );
}
