"""
Modal deployment target.

Modal is the v0.4 primary deployment target. This implementation:
  1. Detects stack from tool output files
  2. Auto-generates Dockerfile if tool didn't produce one
  3. Builds Docker image locally (if `docker` CLI available)
  4. Optionally deploys to Modal (if Modal credentials configured)
  5. Falls back to local-only deployment if Modal isn't available

This makes the benchmark runnable on a developer laptop without Modal credentials
for v0 testing, while still providing the production path.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from harness.deployment.base import DeploymentResult, DeploymentTarget
from harness.deployment.dockerfile_generator import detect_stack, generate_dockerfile
from harness.tools.base import ToolOutput

logger = logging.getLogger(__name__)


class ModalDeploymentTarget(DeploymentTarget):
    """
    Deployment target that prefers Modal but falls back to local Docker.

    Stack detection → Dockerfile generation → image build → deploy.
    """

    target_name = "modal"

    def __init__(
        self,
        token_id: str | None = None,
        token_secret: str | None = None,
        prefer_local: bool = False,
        registry_image_prefix: str = "sigil-bench",
    ):
        self.token_id = token_id or os.environ.get("MODAL_TOKEN_ID")
        self.token_secret = token_secret or os.environ.get("MODAL_TOKEN_SECRET")
        self.prefer_local = prefer_local
        self.registry_image_prefix = registry_image_prefix

    async def deploy(
        self,
        tool_output: ToolOutput,
        run_id: str,
    ) -> DeploymentResult:
        start = time.monotonic()
        started_at = datetime.now(timezone.utc)
        logs: list[str] = []

        # 1. Materialize tool output to a temp directory
        with tempfile.TemporaryDirectory(prefix=f"sigil_deploy_{run_id}_") as tmp:
            workdir = Path(tmp)
            self._write_files(workdir, tool_output.output_files)
            logs.append(f"Materialized {len(tool_output.output_files)} files to {workdir}")

            # 2. Detect stack
            detection = detect_stack(tool_output.output_files)
            logs.append(
                f"Detected stack: {detection.language} / framework={detection.framework} "
                f"/ pm={detection.package_manager} / port={detection.port}"
            )

            # 3. Ensure Dockerfile exists
            dockerfile_path = workdir / "Dockerfile"
            tool_provided_dockerfile = dockerfile_path.exists()
            if not tool_provided_dockerfile:
                dockerfile_path.write_text(generate_dockerfile(detection))
                logs.append("Auto-generated Dockerfile from stack detection")
            else:
                logs.append("Using tool-provided Dockerfile")

            # 4. Choose target: Modal if credentials, else local Docker
            target_choice = await self._choose_target()
            logs.append(f"Deployment target: {target_choice}")

            # 5. Execute the chosen deployment path
            if target_choice == "modal":
                result = await self._deploy_modal(
                    workdir, run_id, detection, logs, started_at, start
                )
            elif target_choice == "local_docker":
                result = await self._deploy_local_docker(
                    workdir, run_id, detection, logs, started_at, start
                )
            else:
                result = DeploymentResult(
                    run_id=run_id,
                    target=self.target_name,
                    success=False,
                    deployed_at=started_at,
                    failure_reason="no_deployment_target_available",
                    deployment_logs="\n".join(logs),
                    build_duration_seconds=time.monotonic() - start,
                    metadata={
                        "stack_detection": detection.__dict__,
                        "tool_provided_dockerfile": tool_provided_dockerfile,
                        "hint": (
                            "Install Docker locally or configure MODAL_TOKEN_ID + "
                            "MODAL_TOKEN_SECRET for full deployment"
                        ),
                    },
                )

            return result

    async def teardown(self, deployment: DeploymentResult) -> None:
        """Clean up deployed resources."""
        if not deployment.success:
            return

        if deployment.metadata.get("local_container_id"):
            container_id = deployment.metadata["local_container_id"]
            proc = await asyncio.create_subprocess_exec(
                "docker", "rm", "-f", container_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()
            logger.debug("Removed local container %s", container_id)

        if deployment.metadata.get("modal_app_id"):
            # Modal app teardown — in production, call modal CLI
            logger.debug("Modal teardown stub for app %s", deployment.metadata["modal_app_id"])

    # ----- Internal -----

    async def _choose_target(self) -> str:
        """Decide between Modal and local Docker based on availability."""
        if not self.prefer_local and self.token_id and self.token_secret:
            if shutil.which("modal"):
                return "modal"
        if shutil.which("docker"):
            return "local_docker"
        return "none"

    async def _deploy_modal(
        self,
        workdir: Path,
        run_id: str,
        detection,
        logs: list[str],
        started_at: datetime,
        start: float,
    ) -> DeploymentResult:
        """Deploy via Modal CLI."""
        # v0: skeleton that calls modal CLI. Production would generate a modal Python script.
        proc = await asyncio.create_subprocess_exec(
            "modal", "deploy", "--name", f"{self.registry_image_prefix}-{run_id}",
            cwd=str(workdir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        logs.append(f"modal deploy stdout: {stdout.decode()[:500]}")
        logs.append(f"modal deploy stderr: {stderr.decode()[:500]}")

        success = proc.returncode == 0
        # Extract URL from Modal output if available
        url_match = None
        for line in stdout.decode().splitlines():
            if "https://" in line and "modal.run" in line:
                url_match = line.strip()
                break

        return DeploymentResult(
            run_id=run_id,
            target="modal",
            success=success,
            deployed_at=started_at,
            public_url=url_match,
            container_image=f"{self.registry_image_prefix}-{run_id}",
            build_duration_seconds=time.monotonic() - start,
            deployment_logs="\n".join(logs),
            failure_reason=None if success else "modal_deploy_failed",
            metadata={
                "stack_detection": detection.__dict__,
                "modal_app_id": f"{self.registry_image_prefix}-{run_id}",
            },
        )

    async def _deploy_local_docker(
        self,
        workdir: Path,
        run_id: str,
        detection,
        logs: list[str],
        started_at: datetime,
        start: float,
    ) -> DeploymentResult:
        """Build + run locally via Docker."""
        image_tag = f"{self.registry_image_prefix}:{run_id}".lower().replace("/", "-")

        # Build
        build_proc = await asyncio.create_subprocess_exec(
            "docker", "build", "-t", image_tag, str(workdir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        build_stdout, build_stderr = await build_proc.communicate()
        logs.append(f"docker build returncode: {build_proc.returncode}")

        if build_proc.returncode != 0:
            stderr_text = build_stderr.decode()[-500:]
            logs.append(f"docker build stderr (last 500 chars): {stderr_text}")
            return DeploymentResult(
                run_id=run_id,
                target="local_docker",
                success=False,
                deployed_at=started_at,
                failure_reason="docker_build_failed",
                deployment_logs="\n".join(logs),
                build_duration_seconds=time.monotonic() - start,
                metadata={
                    "stack_detection": detection.__dict__,
                    "image_tag": image_tag,
                },
            )

        logs.append(f"Built image: {image_tag}")

        # Run
        # Find available host port
        host_port = self._find_free_port()
        container_name = f"sigil-{run_id}".lower().replace("/", "-")[:60]

        run_proc = await asyncio.create_subprocess_exec(
            "docker", "run", "-d",
            "--name", container_name,
            "-p", f"{host_port}:{detection.port}",
            image_tag,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        run_stdout, run_stderr = await run_proc.communicate()

        if run_proc.returncode != 0:
            logs.append(f"docker run failed: {run_stderr.decode()[:500]}")
            return DeploymentResult(
                run_id=run_id,
                target="local_docker",
                success=False,
                deployed_at=started_at,
                failure_reason="docker_run_failed",
                deployment_logs="\n".join(logs),
                build_duration_seconds=time.monotonic() - start,
                metadata={
                    "stack_detection": detection.__dict__,
                    "image_tag": image_tag,
                },
            )

        container_id = run_stdout.decode().strip()
        logs.append(f"Container running: {container_id[:12]} on host port {host_port}")

        # Wait briefly for service to be ready
        await asyncio.sleep(3.0)
        health_ok = await self._probe_health(host_port, detection.port)
        logs.append(f"Initial health probe: {'OK' if health_ok else 'FAILED'}")

        return DeploymentResult(
            run_id=run_id,
            target="local_docker",
            success=True,
            deployed_at=started_at,
            public_url=f"http://localhost:{host_port}",
            internal_endpoint=f"http://localhost:{host_port}",
            container_image=image_tag,
            build_duration_seconds=time.monotonic() - start,
            deployment_logs="\n".join(logs),
            cost_usd=0.0,  # local deployment is free
            metadata={
                "stack_detection": detection.__dict__,
                "image_tag": image_tag,
                "local_container_id": container_id,
                "host_port": host_port,
                "container_port": detection.port,
                "initial_health_ok": health_ok,
            },
        )

    @staticmethod
    def _write_files(target_dir: Path, files: dict[str, str]) -> None:
        for rel_path, content in files.items():
            file_path = target_dir / rel_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content)

    @staticmethod
    def _find_free_port() -> int:
        """Find an available host port for binding."""
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            return s.getsockname()[1]

    @staticmethod
    async def _probe_health(host_port: int, _container_port: int) -> bool:
        """Quick HTTP probe to verify the container is responsive."""
        try:
            import httpx
        except ImportError:
            return False

        async with httpx.AsyncClient(timeout=5.0) as client:
            for path in ("/health", "/healthz", "/"):
                try:
                    response = await client.get(f"http://localhost:{host_port}{path}")
                    if response.status_code < 500:
                        return True
                except (httpx.RequestError, httpx.TimeoutException):
                    continue
        return False
