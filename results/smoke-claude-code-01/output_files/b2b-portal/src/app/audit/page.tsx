import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { listAuditLogs } from "@/lib/audit";
import { Nav } from "../dashboard/page";

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "audit:view")) redirect("/dashboard");

  const logs = await listAuditLogs(session.orgId, 200);

  return (
    <div>
      <Nav role={session.role} email={session.email} />
      <h1>Audit log</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Actor</th>
            <th style={{ padding: 8 }}>Action</th>
            <th style={{ padding: 8 }}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8, fontSize: 13 }}>
                {l.createdAt.toISOString()}
              </td>
              <td style={{ padding: 8, fontSize: 13 }}>{l.actorEmail}</td>
              <td style={{ padding: 8, fontSize: 13 }}>{l.action}</td>
              <td style={{ padding: 8, fontSize: 13 }}>
                <code>{JSON.stringify(l.metadata ?? {})}</code>
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 8, color: "#999" }}>
                No audit events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
