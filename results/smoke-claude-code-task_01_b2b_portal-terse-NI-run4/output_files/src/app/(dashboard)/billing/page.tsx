import { requireRole } from "@/lib/session";
import { features } from "@/lib/env";
import { PLAN_LIST, PLANS } from "@/lib/plans";
import { startCheckout, openBillingPortal } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_BANNER: Record<string, { text: string; cls: string }> = {
  success: { text: "Subscription updated. Thanks!", cls: "bg-green-50 text-green-700" },
  cancelled: { text: "Checkout cancelled — no changes were made.", cls: "bg-gray-100 text-gray-600" },
};
const ERROR_BANNER: Record<string, string> = {
  noprice: "That plan has no Stripe price configured.",
  nocustomer: "No billing account yet — subscribe to a plan first.",
  checkout: "Could not start checkout. Please try again.",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { status?: string; error?: string };
}) {
  const actor = await requireRole("OWNER");
  const org = actor.organization;
  const currentPlan = PLANS[org.plan];

  const banner = searchParams.status ? STATUS_BANNER[searchParams.status] : null;
  const error = searchParams.error ? ERROR_BANNER[searchParams.error] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500">Manage your subscription and plan.</p>
      </div>

      {banner && <p className={`rounded-md px-3 py-2 text-sm ${banner.cls}`}>{banner.text}</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!features.stripe && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Billing is not configured. Set <code>STRIPE_SECRET_KEY</code> and the plan price IDs to
          enable subscriptions.
        </p>
      )}

      <div className="card flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Current plan</p>
          <p className="text-xl font-semibold text-gray-900">{currentPlan.name}</p>
          <p className="text-xs text-gray-400">Status: {org.subscriptionStatus}</p>
        </div>
        {features.stripe && org.stripeCustomerId && (
          <form action={openBillingPortal}>
            <button type="submit" className="btn-secondary">Manage billing</button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLAN_LIST.map((plan) => {
          const isCurrent = plan.id === org.plan;
          return (
            <div
              key={plan.id}
              className={`card flex flex-col ${isCurrent ? "ring-2 ring-brand-500" : ""}`}
            >
              <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
              <p className="text-2xl font-bold text-gray-900">{plan.priceLabel}</p>
              <ul className="my-4 flex-1 space-y-1 text-sm text-gray-600">
                {plan.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="badge bg-brand-100 text-brand-700">Current plan</span>
              ) : (
                <form action={startCheckout}>
                  <input type="hidden" name="plan" value={plan.id} />
                  <button
                    type="submit"
                    disabled={!features.stripe || !plan.priceId}
                    className="btn-primary w-full"
                  >
                    Choose {plan.name}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
