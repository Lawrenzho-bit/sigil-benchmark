"use client";

import { useFormState, useFormStatus } from "react-dom";
import { inviteUser, type ActionResult } from "@/app/(dashboard)/users/actions";

const initialState: ActionResult = { ok: false, message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Sending…" : "Send invite"}
    </button>
  );
}

/** Invite form with inline success/error feedback. */
export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [state, formAction] = useFormState(inviteUser, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label className="label" htmlFor="invite-email">Email address</label>
          <input id="invite-email" name="email" type="email" required className="input" placeholder="teammate@company.com" />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" className="input" defaultValue="VIEWER">
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
            {canInviteOwner && <option value="OWNER">Owner</option>}
          </select>
        </div>
        <div className="flex items-end">
          <SubmitButton />
        </div>
      </div>

      {state.message && (
        <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
