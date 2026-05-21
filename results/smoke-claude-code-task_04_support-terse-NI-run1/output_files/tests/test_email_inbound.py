from app.services import email_inbound
from app.services.email_inbound import strip_signature


def test_strip_signature_cuts_at_delimiter():
    text = "Hello there\nplease help\n\n-- \nJane Doe\nSenior VP\n"
    assert strip_signature(text) == "Hello there\nplease help"


def test_strip_signature_cuts_at_on_wrote():
    text = "thanks\n\nOn Mon, Jan 1, 2026 at 10:00 AM, agent wrote:\n> previous reply"
    assert strip_signature(text) == "thanks"


def test_strip_signature_drops_trailing_quotes():
    text = "yes\n\n> previous line\n> > deeper\n"
    assert strip_signature(text) == "yes"


def test_inbound_creates_new_ticket(db):
    ticket = email_inbound.handle_inbound(
        db,
        {
            "from": "Customer <new@example.com>",
            "to": ["support@example.com"],
            "subject": "My API key broke",
            "text": "I cannot authenticate anymore.",
            "headers": {"Message-ID": "<abc@example.com>"},
        },
    )
    assert ticket.customer.email == "new@example.com"
    assert ticket.subject == "My API key broke"
    assert ticket.messages[0].external_id == "<abc@example.com>"


def test_inbound_reply_routes_via_plus_address(db):
    first = email_inbound.handle_inbound(
        db,
        {
            "from": "u@example.com",
            "to": ["support@example.com"],
            "subject": "Bug",
            "text": "first message",
            "headers": {"Message-ID": "<m1@example.com>"},
        },
    )

    second = email_inbound.handle_inbound(
        db,
        {
            "from": "u@example.com",
            "to": [f"support+{first.number}@example.com"],
            "subject": f"Re: Bug [#{first.number}]",
            "text": "follow-up",
            "headers": {"Message-ID": "<m2@example.com>", "In-Reply-To": "<m1@example.com>"},
        },
    )
    assert second.id == first.id
    assert len(second.messages) == 2
