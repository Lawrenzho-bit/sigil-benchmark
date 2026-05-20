"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-20

"""
from alembic import op
import sqlalchemy as sa


revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="customer"),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("is_anonymized", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role in ('customer','agent','admin')", name="ck_users_role"),
    )
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_is_anonymized", "users", ["is_anonymized"])

    op.create_table(
        "tickets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("public_id", sa.String(20), nullable=False, unique=True),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("requester_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("assignee_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("channel", sa.String(20), nullable=False, server_default="web"),
        sa.Column("tags", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("first_responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merged_into_id", sa.Integer, sa.ForeignKey("tickets.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status in ('new','open','pending','resolved','closed','merged')",
                           name="ck_tickets_status"),
        sa.CheckConstraint("priority in ('low','normal','high','urgent')", name="ck_tickets_priority"),
        sa.CheckConstraint("channel in ('email','web','slack','api')", name="ck_tickets_channel"),
    )
    op.create_index("ix_tickets_requester_id", "tickets", ["requester_id"])
    op.create_index("ix_tickets_assignee_id", "tickets", ["assignee_id"])
    op.create_index("ix_tickets_status", "tickets", ["status"])
    op.create_index("ix_tickets_priority", "tickets", ["priority"])
    op.create_index("ix_tickets_channel", "tickets", ["channel"])
    op.create_index("ix_tickets_created_at", "tickets", ["created_at"])
    op.create_index("ix_tickets_status_priority", "tickets", ["status", "priority"])
    op.create_index("ix_tickets_merged_into_id", "tickets", ["merged_into_id"])

    # FTS (postgres-only) — add a generated tsvector column and GIN index.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("""
            ALTER TABLE tickets
            ADD COLUMN search_tsv tsvector
            GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(description, '')), 'B')
            ) STORED
        """)
        op.execute("CREATE INDEX ix_tickets_search_tsv ON tickets USING GIN (search_tsv)")

    op.create_table(
        "sla_states",
        sa.Column("ticket_id", sa.Integer, sa.ForeignKey("tickets.id"), primary_key=True),
        sa.Column("first_response_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolution_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_response_breached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_breached_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sla_first_breach", "sla_states", ["first_response_breached_at"])
    op.create_index("ix_sla_res_breach", "sla_states", ["resolution_breached_at"])

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("ticket_id", sa.Integer, sa.ForeignKey("tickets.id"), nullable=False),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="public"),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("from_email", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("visibility in ('public','internal')", name="ck_comments_visibility"),
    )
    op.create_index("ix_comments_ticket_id", "comments", ["ticket_id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])
    op.create_index("ix_comments_visibility", "comments", ["visibility"])
    op.create_index("ix_comments_created_at", "comments", ["created_at"])

    op.create_table(
        "kb_articles",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("slug", sa.String(200), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("published", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_kb_published", "kb_articles", ["published"])
    if bind.dialect.name == "postgresql":
        op.execute("""
            ALTER TABLE kb_articles
            ADD COLUMN search_tsv tsvector
            GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(body, '')), 'B')
            ) STORED
        """)
        op.execute("CREATE INDEX ix_kb_search_tsv ON kb_articles USING GIN (search_tsv)")

    op.create_table(
        "macros",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("payload", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_actor_id", "audit_events", ["actor_id"])
    op.create_index("ix_audit_action", "audit_events", ["action"])
    op.create_index("ix_audit_entity_type", "audit_events", ["entity_type"])
    op.create_index("ix_audit_entity_id", "audit_events", ["entity_id"])
    op.create_index("ix_audit_ts", "audit_events", ["ts"])
    op.create_index("ix_audit_entity", "audit_events", ["entity_type", "entity_id"])

    op.create_table(
        "csat_surveys",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("ticket_id", sa.Integer, sa.ForeignKey("tickets.id"), nullable=False, unique=True),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("rating", sa.Integer, nullable=True),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("rating is null or (rating between 1 and 5)", name="ck_csat_rating"),
    )

    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("ticket_id", sa.Integer, sa.ForeignKey("tickets.id"), nullable=False),
        sa.Column("comment_id", sa.Integer, sa.ForeignKey("comments.id"), nullable=True),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("storage_url", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_attachments_ticket_id", "attachments", ["ticket_id"])
    op.create_index("ix_attachments_comment_id", "attachments", ["comment_id"])


def downgrade() -> None:
    op.drop_table("attachments")
    op.drop_table("csat_surveys")
    op.drop_table("audit_events")
    op.drop_table("macros")
    op.drop_table("kb_articles")
    op.drop_table("comments")
    op.drop_table("sla_states")
    op.drop_table("tickets")
    op.drop_table("users")
