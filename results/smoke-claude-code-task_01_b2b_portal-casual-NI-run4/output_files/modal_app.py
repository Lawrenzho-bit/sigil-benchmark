"""Modal deployment wrapper.

Deploy with:  modal deploy modal_app.py

Modal builds the same Dockerfile and serves the ASGI app. Secrets (SECRET_KEY,
DATABASE_URL, Stripe keys, SMTP creds) must be created once via the dashboard
or `modal secret create sigil-portal-secrets ...`.
"""

import modal

image = modal.Image.from_dockerfile("Dockerfile")

app = modal.App("sigil-portal")


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("sigil-portal-secrets")],
    min_containers=1,
)
@modal.asgi_app()
def fastapi_app():
    # Imported inside the function so the import runs in the Modal container,
    # where all runtime dependencies are installed.
    from app.main import app as fastapi

    return fastapi
