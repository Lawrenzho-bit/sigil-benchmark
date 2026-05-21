"""Business-logic services.

Routers stay thin: they parse input, call a service, and render a response.
All domain rules — auth, RBAC enforcement beyond the dependency layer,
billing, invitations, GDPR — live here and are independently testable.
"""
