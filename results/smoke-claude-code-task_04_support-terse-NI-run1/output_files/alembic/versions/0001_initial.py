"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ticket number sequence
    op.execute("CREATE SEQUENCE IF NOT EXISTS tickets_number_seq START 1001")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("agent", "admin", "supervisor", name="userrole"), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("locale", sa.String(16), nullable=False, server_default="en-US"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("profile", postgresql.JSONB, server_default="{}"),
        sa.Column("consents", postgresql.JSONB, server_default="{}"),
        sa.Column("erased_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_customers_email_lower", "customers", [sa.text("lower(email)")], unique=True)
    op.create_index("ix_customers_email", "customers", ["email"])

    op.create_table(
        "sla_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), unique=True),
        sa.Column("targets", postgresql.JSONB, server_default="{}"),
        sa.Column("business_hours", postgresql.JSONB),
        sa.Column("is_default", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("number", sa.BigInteger, nullable=False, unique=True),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column(
            "status",
            sa.Enum("new", "open", "pending", "on_hold", "resolved", "closed", "merged", name="ticketstatus"),
            nullable=False,
            server_default="new",
        ),
        sa.Column(
            "priority",
            sa.Enum("low", "normal", "high", "urgent", name="ticketpriority"),
            nullable=False,
            server_default="normal",
        ),
        sa.Column(
            "channel",
            sa.Enum("email", "web", "slack", "api", name="ticketchannel"),
            nullable=False,
            server_default="email",
        ),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("team", sa.String(64)),
        sa.Column("sla_policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sla_policies.id")),
        sa.Column("first_response_due_at", sa.DateTime(timezone=True)),
        sa.Column("first_response_at", sa.DateTime(timezone=True)),
        sa.Column("resolve_due_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("merged_into_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tickets.id")),
        sa.Column("external_thread_id", sa.String(998)),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("search_vector", postgresql.TSVECTOR),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_tickets_status_priority", "tickets", ["status", "priority"])
    op.create_index("ix_tickets_assignee_status", "tickets", ["assignee_id", "status"])
    op.create_index("ix_tickets_customer_created", "tickets", ["customer_id", "created_at"])
    op.create_index("ix_tickets_search", "tickets", ["search_vector"], postgresql_using="gin")
    op.create_index("ix_tickets_created_at", "tickets", ["created_at"])

    op.create_table(
        "ticket_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(64), unique=True, nullable=False),
    )

    op.create_table(
        "ticket_tags_assoc",
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ticket_tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("customer_reply", "agent_reply", "internal_note", "system", name="messagekind"),
            nullable=False,
        ),
        sa.Column(
            "channel",
            sa.Enum("email", "web", "slack", "api", name="messagechannel"),
            nullable=False,
        ),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id")),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("body_text", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text),
        sa.Column("external_id", sa.String(998)),
        sa.Column("in_reply_to", sa.String(998)),
        sa.Column("references", sa.Text),
        sa.Column("is_internal", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("headers", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_messages_ticket_created", "messages", ["ticket_id", "created_at"])
    op.create_index("ix_messages_external_id", "messages", ["external_id"])

    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("storage_url", sa.String(2048), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "sla_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("first_response", "resolution", "next_response", name="slakind"),
            nullable=False,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("met_at", sa.DateTime(timezone=True)),
        sa.Column("breached", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("breach_alerted_at", sa.DateTime(timezone=True)),
        sa.Column("pause_seconds_total", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sla_targets_ticket_id", "sla_targets", ["ticket_id"])
    op.create_index("ix_sla_targets_due_at", "sla_targets", ["due_at"])
    op.create_index("ix_sla_targets_breached", "sla_targets", ["breached"])

    op.create_table(
        "macros",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("actions", postgresql.JSONB, server_default="{}"),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("visibility", sa.String(20), server_default="team"),
        sa.Column("use_count", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "kb_articles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body_markdown", sa.Text, nullable=False),
        sa.Column("category", sa.String(120)),
        sa.Column(
            "status",
            sa.Enum("draft", "published", "archived", name="articlestatus"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("view_count", sa.Integer, server_default="0"),
        sa.Column("helpful_count", sa.Integer, server_default="0"),
        sa.Column("not_helpful_count", sa.Integer, server_default="0"),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("search_vector", postgresql.TSVECTOR),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_kb_articles_slug", "kb_articles", ["slug"], unique=True)
    op.create_index("ix_kb_articles_search", "kb_articles", ["search_vector"], postgresql_using="gin")
    op.create_index("ix_kb_articles_category", "kb_articles", ["category"])

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_type", sa.String(40), nullable=False),
        sa.Column("actor_id", sa.String(64)),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("target_type", sa.String(60), nullable=False),
        sa.Column("target_id", sa.String(64)),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("ip", postgresql.INET),
        sa.Column("user_agent", sa.String(512)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audit_actor_created", "audit_events", ["actor_id", "created_at"])
    op.create_index("ix_audit_target_created", "audit_events", ["target_type", "target_id", "created_at"])
    op.create_index("ix_audit_created_at", "audit_events", ["created_at"])

    op.create_table(
        "csat_responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tickets.id", ondelete="CASCADE"), unique=True),
        sa.Column("rating", sa.Integer, nullable=False),
        sa.Column("comment", sa.Text),
        sa.Column("token", sa.String(64), unique=True, nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Search-vector triggers — keep tickets.search_vector and kb_articles.search_vector
    # current automatically.
    op.execute(
        """
        CREATE FUNCTION tickets_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector :=
              setweight(to_tsvector('english', coalesce(NEW.subject, '')), 'A');
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_tickets_search
        BEFORE INSERT OR UPDATE OF subject ON tickets
        FOR EACH ROW EXECUTE FUNCTION tickets_search_vector_update();
        """
    )

    op.execute(
        """
        CREATE FUNCTION kb_articles_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector :=
              setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
              setweight(to_tsvector('english', coalesce(NEW.body_markdown, '')), 'B');
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_kb_articles_search
        BEFORE INSERT OR UPDATE OF title, body_markdown ON kb_articles
        FOR EACH ROW EXECUTE FUNCTION kb_articles_search_vector_update();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_kb_articles_search ON kb_articles")
    op.execute("DROP FUNCTION IF EXISTS kb_articles_search_vector_update")
    op.execute("DROP TRIGGER IF EXISTS trg_tickets_search ON tickets")
    op.execute("DROP FUNCTION IF EXISTS tickets_search_vector_update")

    for t in (
        "csat_responses",
        "audit_events",
        "kb_articles",
        "macros",
        "sla_targets",
        "attachments",
        "messages",
        "ticket_tags_assoc",
        "ticket_tags",
        "tickets",
        "sla_policies",
        "customers",
        "users",
    ):
        op.drop_table(t)

    for enum_name in (
        "articlestatus",
        "slakind",
        "messagechannel",
        "messagekind",
        "ticketchannel",
        "ticketpriority",
        "ticketstatus",
        "userrole",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")

    op.execute("DROP SEQUENCE IF EXISTS tickets_number_seq")
