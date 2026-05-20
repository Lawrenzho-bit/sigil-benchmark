from fastapi import FastAPI

from app.routers import auth as auth_router
from app.routers import customers as customers_router
from app.routers import inbound as inbound_router
from app.routers import kb as kb_router
from app.routers import macros as macros_router
from app.routers import reports as reports_router
from app.routers import tickets as tickets_router


def create_app() -> FastAPI:
    app = FastAPI(title="Support Tool", version="0.1.0")
    app.include_router(auth_router.router)
    app.include_router(tickets_router.customer_router)
    app.include_router(tickets_router.agent_router)
    app.include_router(customers_router.router)
    app.include_router(kb_router.router)
    app.include_router(macros_router.router)
    app.include_router(reports_router.router)
    app.include_router(inbound_router.router)

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
