# Task 01 — B2B SaaS Portal — Prompt Variant C (Casual)

**Variant ID:** `task_01.variant_casual.v1`
**Last revision:** 2026-05-19
**Methodology:** PRS v0.4

---

hey, can you build me a SaaS portal for B2B customers? need it to actually work in production, not just be a demo

stuff it needs to do:

- people sign up with email or sign in with their company's SSO (saml)
- 3 user roles: owner can do everything including billing, admin can manage users and settings, viewer can just look at stuff
- a dashboard that shows useful metrics
- stripe for billing — 3 plans (starter/pro/enterprise) with the ability to upgrade and downgrade
- log everything important so we can show auditors later
- let admins invite people, change roles, kick people out
- settings page for the org and for individual users
- emails for welcome, invites, billing receipts, that kind of thing

needs to be deploy-able somewhere reasonable (modal, fly, railway, whatever), with docker, ci/cd, the works

oh and obviously secure (no sql injection, no XSS, proper auth, rate limiting on the login endpoint, all that)

and it needs to handle the gdpr stuff — cookie banner, privacy policy, the ability to export your data and delete your account

make it real production code please, not vibe-code-that-mostly-works
