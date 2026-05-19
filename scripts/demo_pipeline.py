"""
Demo pipeline — end-to-end dry run with mock data.

Runs the full scoring + aggregation pipeline against pre-built mock tool outputs.
No API keys needed. No deployment needed. No real tools invoked.

Useful for:
  - Demonstrating Sigil Benchmark visually (video / pitch)
  - Validating the pipeline works end-to-end
  - Showing investors / technical co-founder candidates a live run
  - Smoke-testing changes to scoring engines

Usage:
  python scripts/demo_pipeline.py
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

# Use ASCII-safe console on Windows to avoid cp1252 encoding errors
console = Console(legacy_windows=False, force_terminal=True, no_color=False)
import os
if os.name == "nt":
    # Reconfigure stdout to UTF-8 on Windows
    import sys as _sys
    try:
        _sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass

from harness.analysis.aggregation import CycleAggregator
from harness.deployment.base import DeploymentResult
from harness.orchestrator import (
    BenchmarkConfig,
    BenchmarkCycle,
    BenchmarkRun,
    TaskDefinition,
)
from harness.scoring.compliance import ComplianceScoringEngine
from harness.scoring.cost_efficiency import CostEfficiencyScoringEngine
from harness.scoring.production_ops import ProductionOpsScoringEngine
from harness.scoring.scalability import ScalabilityScoringEngine
from harness.scoring.security import SecurityScoringEngine
from harness.tools.base import ToolOutput

# ---------- Mock tool outputs ----------


def mock_outputs() -> dict[str, dict[str, str]]:
    """
    Build mock tool outputs for demonstration.

    Three "tools" producing different quality of code:
      - sigil-deploy: certified components stitched together (high quality)
      - claude-sonnet-4-5: AI-generated, mostly competent
      - bolt-vibe-coded: AI-generated, low quality vibe code
    """

    high_quality = {
        "package.json": """{
  "name": "b2b-portal",
  "version": "1.0.0",
  "scripts": {
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "18.3.1",
    "prisma": "5.18.0",
    "@prisma/client": "5.18.0",
    "stripe": "16.7.0",
    "next-auth": "5.0.0-beta",
    "winston": "3.13.0",
    "@opentelemetry/api": "1.9.0",
    "ioredis": "5.4.1",
    "bullmq": "5.12.10"
  }
}""",
        "Dockerfile": "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci --production\nRUN npm run build\nEXPOSE 3000\nCMD [\"npm\", \"start\"]\n",
        ".env.example": "DATABASE_URL=\nNEXTAUTH_SECRET=\nSTRIPE_SECRET_KEY=\nREDIS_URL=\n",
        ".github/workflows/deploy.yml": "name: Deploy\non: push\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm test && modal deploy\n",
        "lib/auth.ts": """import NextAuth from "next-auth";
import { SAMLProvider } from "next-auth/providers/saml";

export const { auth, handlers } = NextAuth({
  providers: [SAMLProvider({ /* ... */ })],
  session: { strategy: "jwt" },
  callbacks: {
    async session({ session, token }) {
      session.user.role = token.role;
      return session;
    },
  },
});
""",
        "lib/db.ts": """import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient({
  log: ["error", "warn"],
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

// Connection pool configured via DATABASE_URL params
""",
        "lib/cache.ts": """import Redis from "ioredis";
export const cache = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
});

export async function cacheGet(key: string) { return cache.get(key); }
export async function cacheSet(key: string, val: string, ttl=300) {
  return cache.setex(key, ttl, val);
}
export async function cacheDelete(key: string) { return cache.del(key); }
""",
        "lib/jobs.ts": """import { Queue, Worker } from "bullmq";

export const emailQueue = new Queue("email", {
  connection: { url: process.env.REDIS_URL },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnFail: { age: 86400 },
  },
});

const worker = new Worker("email", async (job) => {
  // ... process email
}, { connection: { url: process.env.REDIS_URL } });
""",
        "lib/audit.ts": """import { db } from "./db";

export async function auditLog(params: {
  actor: string; action: string; target: string;
  before?: unknown; after?: unknown; ip: string;
}) {
  await db.auditLog.create({
    data: {
      ...params,
      timestamp: new Date(), // UTC
      diff: { before: params.before, after: params.after },
    },
  });
}

// Audit logs are write-only at the DB level — see migration 003_audit_immutable.sql
""",
        "app/api/health/route.ts": """import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cache } from "@/lib/cache";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    await cache.ping();
    return NextResponse.json({ status: "ok", db: "ok", cache: "ok" });
  } catch (err) {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
""",
        "app/privacy/page.tsx": """export default function PrivacyPolicy() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p>This service uses: Stripe (payments), SendGrid (email), Cloudflare (CDN), and PostgreSQL (database).
      We collect: email, name, role, billing details (via Stripe Connect, never stored by us).
      Your data is encrypted at rest using AES-256 and in transit via TLS 1.3.
      Data retention: 7 years for audit log; 30 days after account deletion for all other data.
      ... [substantial policy text continues for 2000+ words]
      </p>
    </article>
  );
}
""",
        "app/api/me/export/route.ts": """import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await db.user.findUnique({
    where: { id: session.user.id },
    include: { orders: true, auditEntries: true },
  });
  return NextResponse.json(data, {
    headers: { "Content-Disposition": "attachment; filename=my-data.json" },
  });
}
""",
        "components/CookieConsent.tsx": """"use client";
import { useEffect, useState } from "react";

export function CookieConsent() {
  const [consent, setConsent] = useState<string | null>(null);
  useEffect(() => setConsent(localStorage.getItem("cookie-consent")), []);

  if (consent === "accepted" || consent === "rejected") return null;

  const accept = () => { localStorage.setItem("cookie-consent", "accepted"); setConsent("accepted"); };
  const reject = () => { localStorage.setItem("cookie-consent", "rejected"); setConsent("rejected"); };
  // Tracking scripts only load when consent === "accepted" (see _app.tsx)
  return (
    <div role="banner">
      <p>We use cookies. <button onClick={accept}>Accept</button> <button onClick={reject}>Reject</button></p>
      <a href="/preferences">Granular preferences</a>
    </div>
  );
}
""",
    }

    # ---- Medium-quality output ----

    medium_quality = dict(high_quality)
    # Remove some best-practice files
    medium_quality.pop("lib/cache.ts")
    medium_quality.pop("lib/jobs.ts")
    medium_quality.pop(".github/workflows/deploy.yml")
    medium_quality["lib/db.ts"] = """// Direct connection, no pool
const { Client } = require("pg");
export const db = new Client({ connectionString: process.env.DATABASE_URL });
db.connect();
"""
    medium_quality["lib/auth.ts"] = """// Custom JWT, no MFA
import jwt from "jsonwebtoken";

export function sign(user) {
  return jwt.sign({ id: user.id }, "secret-key-CHANGE-ME"); // hardcoded!
}
"""
    medium_quality.pop("app/privacy/page.tsx")
    medium_quality.pop("app/api/me/export/route.ts")
    medium_quality["app/api/health/route.ts"] = """export async function GET() {
  return new Response("ok");
}
"""

    # ---- Low-quality (vibe-coded) output ----

    low_quality = {
        "package.json": """{
  "name": "app",
  "dependencies": {
    "express": "4.18.2",
    "stripe": "16.7.0"
  }
}""",
        "index.js": """const express = require('express');
const stripe = require('stripe')('sk_test_HARDCODED_KEY_HERE');
const app = express();
app.use(express.json());

// Auth: just trust whatever the client sends
app.post('/login', (req, res) => {
  res.cookie('userId', req.body.userId); // no security flags
  res.send('logged in');
});

// SQL injection waiting to happen
app.get('/users/:id', async (req, res) => {
  const sql = \`SELECT * FROM users WHERE id = \${req.params.id}\`;
  const result = await db.query(sql);
  res.json(result);
});

// Webhook with no signature validation
app.post('/stripe/webhook', (req, res) => {
  const event = req.body;
  if (event.type === 'invoice.paid') {
    // process...
  }
  res.send('ok');
});

app.listen(8080); // no health check, no graceful shutdown
""",
    }

    return {
        "sigil-deploy": high_quality,
        "claude-sonnet-4-5": medium_quality,
        "bolt-vibe-coded": low_quality,
    }


# ---------- Mock orchestration ----------


async def run_demo() -> None:
    console.print(
        Panel.fit(
            "[bold cyan]Sigil Benchmark — Demo Pipeline[/bold cyan]\n"
            "[dim]Runs PRS v0.4 scoring on mock tool outputs (no APIs required)[/dim]",
            border_style="cyan",
        )
    )
    console.print()

    outputs = mock_outputs()
    tools = list(outputs.keys())

    # Build a synthetic cycle
    cycle_id = "demo-2026-Q3"
    config = BenchmarkConfig(
        cycle_id=cycle_id,
        tasks=["task_01_b2b_portal"],
        tools=tools,
        runs_per_condition=3,  # small N for demo
        modes=["prs_autonomous"],
    )

    # Mock task definition
    task = TaskDefinition(
        task_id="task_01_b2b_portal",
        name="B2B SaaS Portal",
        prompts={"terse": "Build a B2B SaaS portal..."},
        acceptance_criteria="(mock)",
        weight_template={"security": 0.25, "ops": 0.25, "scale": 0.20, "compliance": 0.20, "cost": 0.10},
    )

    engines = [
        SecurityScoringEngine(),
        ProductionOpsScoringEngine(),
        ComplianceScoringEngine(),
        CostEfficiencyScoringEngine(),
        ScalabilityScoringEngine(),
    ]

    cycle = BenchmarkCycle(config=config)
    repo_root = Path(__file__).resolve().parent.parent
    results_dir = repo_root / "results" / cycle_id
    results_dir.mkdir(parents=True, exist_ok=True)

    total_runs = len(tools) * config.runs_per_condition

    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task_bar = progress.add_task("Scoring runs", total=total_runs)

        for tool_id in tools:
            tool_files = outputs[tool_id]
            for rep in range(config.runs_per_condition):
                # Add small variance per-rep to simulate stochasticity
                varied_files = _vary_files(tool_files, rep)

                tool_output = ToolOutput(
                    tool_id=tool_id,
                    model=tool_id,
                    mode="prs_autonomous",
                    prompt="(demo)",
                    output_files=varied_files,
                    completion_status="complete",
                    tokens_input=2000,
                    tokens_output=10000,
                    wall_clock_seconds=42.0,
                    generated_at=datetime.now(timezone.utc),
                )

                fake_deployment = DeploymentResult(
                    run_id=f"demo-{tool_id}-{rep}",
                    target="demo",
                    success=True,
                    deployed_at=datetime.now(timezone.utc),
                    public_url="http://localhost:1234",
                    cost_usd=0.0,
                )

                run = BenchmarkRun(
                    run_id=f"{cycle_id}.{tool_id}.task_01_b2b_portal.terse.prs_autonomous.r{rep:03d}",
                    cycle_id=cycle_id,
                    tool_id=tool_id,
                    task_id="task_01_b2b_portal",
                    variant="terse",
                    mode="prs_autonomous",
                    repetition=rep,
                    started_at=datetime.now(timezone.utc),
                    tool_output=tool_output,
                    deployment=fake_deployment,
                    status="complete",
                )

                # Run all 5 scoring engines
                for engine in engines:
                    score_result = await engine.score(
                        deployment=fake_deployment,
                        task=task,
                        tool_output=tool_output,
                    )
                    run.scores[engine.dimension_id] = score_result

                run.completed_at = datetime.now(timezone.utc)
                cycle.runs.append(run)

                # Persist
                run_dir = results_dir / "runs" / tool_id / "task_01_b2b_portal"
                run_dir.mkdir(parents=True, exist_ok=True)
                (run_dir / f"{run.run_id}.json").write_text(run.model_dump_json(indent=2))

                progress.update(task_bar, advance=1)

    cycle.completed_at = datetime.now(timezone.utc)

    # Persist cycle summary
    import json
    (results_dir / "cycle_summary.json").write_text(json.dumps({
        "cycle_id": cycle_id,
        "total_runs": len(cycle.runs),
        "complete": sum(1 for r in cycle.runs if r.status == "complete"),
        "methodology_version": "0.4.0 (demo)",
    }, indent=2))

    console.print()
    console.print("[green]✓ All runs scored[/green]")
    console.print()

    # Run aggregation
    console.print("[bold cyan]Running aggregation[/bold cyan] (bootstrap CIs, BH correction, rank stability)...")
    aggregator = CycleAggregator(results_dir)
    aggregates = aggregator.aggregate()

    console.print()

    # Display: per-tool scores
    tool_table = Table(title=f"Sigil Index Demo — {cycle_id}")
    tool_table.add_column("Rank", style="bold")
    tool_table.add_column("Tool")
    tool_table.add_column("Composite PRS")
    tool_table.add_column("95% CI")
    tool_table.add_column("Security")
    tool_table.add_column("Ops")
    tool_table.add_column("Scale")
    tool_table.add_column("Comp.")
    tool_table.add_column("Cost")

    sorted_tools = sorted(
        aggregates.per_tool.items(),
        key=lambda x: -x[1]["composite_prs"]["mean"],
    )

    for rank, (tool_id, stats) in enumerate(sorted_tools, 1):
        composite = stats["composite_prs"]
        dims = stats["dimensions"]
        tool_table.add_row(
            f"#{rank}",
            tool_id,
            f"{composite['mean']:.1f}",
            f"[{composite['ci_lower']:.1f}, {composite['ci_upper']:.1f}]",
            f"{dims.get('security', {}).get('mean', 0):.0f}",
            f"{dims.get('production_ops', {}).get('mean', 0):.0f}",
            f"{dims.get('scalability', {}).get('mean', 0):.0f}",
            f"{dims.get('compliance', {}).get('mean', 0):.0f}",
            f"{dims.get('cost_efficiency', {}).get('mean', 0):.0f}",
        )

    console.print(tool_table)
    console.print()

    # Display: rank stability
    if aggregates.rank_distributions:
        rank_table = Table(title="Rank Stability (PRS v0.4 §9)")
        rank_table.add_column("Tool")
        rank_table.add_column("Mean Rank")
        rank_table.add_column("80% Rank Band")
        rank_table.add_column("RSC")
        rank_table.add_column("Interpretation")
        for tool_id, rd in sorted(
            aggregates.rank_distributions.items(), key=lambda x: x[1]["mean_rank"]
        ):
            interp = "Stable" if rd["rsc"] < 0.1 else ("Moderate" if rd["rsc"] < 0.3 else "Unstable")
            rank_table.add_row(
                tool_id,
                f"{rd['mean_rank']:.1f}",
                f"[{rd['p10_rank']:.0f}, {rd['p90_rank']:.0f}]",
                f"{rd['rsc']:.2f}",
                interp,
            )
        console.print(rank_table)
        console.print()

    # Display: significant differences with BH correction
    significant = [c for c in aggregates.pairwise_comparisons if c.get("practically_significant")]
    if significant:
        sig_table = Table(title="Statistically + Practically Significant Differences (BH-corrected)")
        sig_table.add_column("Tool A")
        sig_table.add_column("Tool B")
        sig_table.add_column("Δ mean")
        sig_table.add_column("Cohen's d")
        sig_table.add_column("q-value")
        for c in significant[:10]:
            sig_table.add_row(
                c["tool_a"],
                c["tool_b"],
                f"{c['mean_diff']:+.1f}",
                f"{c['cohens_d']:+.2f}",
                f"{c['q_value']:.4f}",
            )
        console.print(sig_table)
        console.print()

    # Final summary panel
    console.print(
        Panel.fit(
            f"[bold green]Demo complete.[/bold green]\n\n"
            f"Cycle: [cyan]{cycle_id}[/cyan]\n"
            f"Runs: [cyan]{len(cycle.runs)}[/cyan] ({sum(1 for r in cycle.runs if r.status == 'complete')} complete)\n"
            f"Tools: [cyan]{len(tools)}[/cyan]\n"
            f"Dimensions scored: [cyan]5 of 5[/cyan] (32 of 50 sub-components implemented)\n"
            f"Statistical rigor: bootstrap CIs, BH correction, rank stability\n\n"
            f"Results: [dim]{results_dir}[/dim]\n"
            f"Aggregates: [dim]{results_dir}/aggregates/[/dim]",
            border_style="green",
        )
    )


def _vary_files(files: dict[str, str], seed: int) -> dict[str, str]:
    """Inject tiny per-rep variance so bootstrap CIs aren't degenerate."""
    if seed == 0:
        return files
    varied = dict(files)
    # Toggle one trivial thing per seed
    if "package.json" in varied:
        # Bump version to simulate slight per-run variation
        varied["package.json"] = varied["package.json"].replace(
            '"version": "1.0.0"', f'"version": "1.0.{seed}"'
        )
    return varied


if __name__ == "__main__":
    asyncio.run(run_demo())
