/** Billing — plan overview, plan selection and Stripe portal. ADMIN+ to view. */
import { requirePermission } from "@/lib/auth";
import { billingEnabled } from "@/lib/env";
import { PLAN_LIST, PLANS } from "@/lib/plans";
import { BillingClient } from "./billing-client";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const { user, organization } = await requirePermission("billing:view");
  const canManage = user.role === "OWNER";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Billing</h1>
        <p className="text-sm text-zinc-500">
          Manage {organization.name}&apos;s subscription.
        </p>
      </div>

      {searchParams.status === "success" && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Payment received — your subscription is being activated.
        </div>
      )}
      {searchParams.status === "canceled" && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Checkout canceled. No changes were made.
        </div>
      )}
      {!billingEnabled && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Stripe is not configured on this deployment. Set the STRIPE_* env vars
          to enable checkout.
        </div>
      )}

      <div className="card">
        <p className="text-sm text-zinc-500">Current plan</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="text-xl font-semibold text-zinc-900">
            {PLANS[organization.plan].name}
          </span>
          <span className="badge bg-zinc-100 text-zinc-600">
            {organization.subscriptionStatus.toLowerCase().replace("_", " ")}
          </span>
        </div>
        {organization.currentPeriodEnd && (
          <p className="mt-1 text-sm text-zinc-500">
            Current period ends{" "}
            {organization.currentPeriodEnd.toLocaleDateString()}
          </p>
        )}
        {!canManage && (
          <p className="mt-2 text-xs text-zinc-400">
            Only an organization owner can change the plan.
          </p>
        )}
      </div>

      <BillingClient
        currentPlan={organization.plan}
        canManage={canManage}
        billingEnabled={billingEnabled}
        hasCustomer={!!organization.stripeCustomerId}
        plans={PLAN_LIST.map((p) => ({
          id: p.id,
          name: p.name,
          priceLabel: p.priceLabel,
          features: p.features,
        }))}
      />
    </div>
  );
}
