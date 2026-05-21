"""Customer-facing portal: HTML pages + form posts."""

from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.ticket import Ticket, TicketChannel
from app.models.user import Customer
from app.schemas.ticket import TicketCreate
from app.services import tickets
from app.services.auth import hash_password, verify_password

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def _portal_customer(request: Request, db: Session) -> Customer | None:
    cid = request.cookies.get("portal_cid")
    if not cid:
        return None
    try:
        return db.get(Customer, UUID(cid))
    except (ValueError, TypeError):
        return None


@router.get("/", response_class=HTMLResponse)
def home(request: Request, db: Session = Depends(get_db)):
    customer = _portal_customer(request, db)
    if not customer:
        return templates.TemplateResponse("portal/login.html", {"request": request})
    my_tickets = db.execute(
        select(Ticket).where(Ticket.customer_id == customer.id).order_by(Ticket.created_at.desc()).limit(50)
    ).scalars().all()
    return templates.TemplateResponse(
        "portal/home.html", {"request": request, "customer": customer, "tickets": my_tickets}
    )


@router.post("/login")
def portal_login(
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    customer = db.execute(select(Customer).where(Customer.email == email.lower())).scalar_one_or_none()
    if not customer or not customer.password_hash or not verify_password(password, customer.password_hash):
        raise HTTPException(401, "invalid_credentials")
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie("portal_cid", str(customer.id), httponly=True, samesite="lax")
    return response


@router.post("/register")
def portal_register(
    email: str = Form(...),
    name: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    if db.execute(select(Customer).where(Customer.email == email.lower())).scalar_one_or_none():
        raise HTTPException(409, "email_exists")
    customer = Customer(email=email.lower(), name=name, password_hash=hash_password(password))
    db.add(customer)
    db.commit()
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie("portal_cid", str(customer.id), httponly=True, samesite="lax")
    return response


@router.post("/portal/tickets")
def portal_new_ticket(
    request: Request,
    subject: str = Form(...),
    body: str = Form(...),
    db: Session = Depends(get_db),
):
    customer = _portal_customer(request, db)
    if not customer:
        raise HTTPException(401, "not_authenticated")
    ticket = tickets.create_ticket(
        db,
        TicketCreate(
            subject=subject,
            body=body,
            customer_email=customer.email,
            customer_name=customer.name,
            channel=TicketChannel.WEB,
        ),
        actor_id=str(customer.id),
    )
    return RedirectResponse(url=f"/portal/tickets/{ticket.id}", status_code=303)


@router.get("/portal/tickets/{ticket_id}", response_class=HTMLResponse)
def portal_view_ticket(ticket_id: UUID, request: Request, db: Session = Depends(get_db)):
    customer = _portal_customer(request, db)
    if not customer:
        raise HTTPException(401, "not_authenticated")
    ticket = db.get(Ticket, ticket_id)
    if not ticket or ticket.customer_id != customer.id:
        raise HTTPException(404, "not_found")
    visible = [m for m in ticket.messages if not m.is_internal]
    return templates.TemplateResponse(
        "portal/ticket.html",
        {"request": request, "ticket": ticket, "messages": visible, "customer": customer},
    )


@router.post("/portal/tickets/{ticket_id}/reply")
def portal_reply(
    ticket_id: UUID,
    request: Request,
    body: str = Form(...),
    db: Session = Depends(get_db),
):
    from app.models.message import MessageChannel, MessageKind

    customer = _portal_customer(request, db)
    if not customer:
        raise HTTPException(401, "not_authenticated")
    ticket = db.get(Ticket, ticket_id)
    if not ticket or ticket.customer_id != customer.id:
        raise HTTPException(404, "not_found")
    tickets.reply(
        db,
        ticket_id,
        body=body,
        customer_id=customer.id,
        kind=MessageKind.CUSTOMER_REPLY,
        channel=MessageChannel.WEB,
    )
    return RedirectResponse(url=f"/portal/tickets/{ticket_id}", status_code=303)


@router.post("/logout")
def portal_logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("portal_cid")
    return response
