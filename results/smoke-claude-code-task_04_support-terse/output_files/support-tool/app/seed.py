"""Seed demo data. Run with: python -m app.seed"""
from app.auth import hash_password
from app.db import SessionLocal
from app.models import Role, User


DEMO_USERS = [
    ("admin@example.com", "Admin User", Role.admin.value, "admin123"),
    ("agent@example.com", "Agent User", Role.agent.value, "agent123"),
    ("customer@example.com", "Customer User", Role.customer.value, "customer123"),
]


def main() -> None:
    db = SessionLocal()
    try:
        for email, name, role, password in DEMO_USERS:
            if db.query(User).filter(User.email == email).first():
                continue
            db.add(User(email=email, name=name, role=role,
                        hashed_password=hash_password(password)))
        db.commit()
        print("Seeded demo users:")
        for email, _, role, password in DEMO_USERS:
            print(f"  {role:8}  {email}  /  {password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
