import frappe
import requests
import json
import re
from datetime import datetime, date

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

SYSTEM_PROMPT = """You are an ERPNext Agentic AI assistant. You help users manage their business operations by taking multi-step autonomous actions.

You have access to the following actions:
1. CHECK_PENDING_PAYMENTS - Check pending/overdue invoices
2. SEND_EMAIL_REMINDER - Send email reminders to customers
3. LOG_ACTION - Log an action to the audit log
4. GENERATE_REPORT - Generate a summary report of actions taken

Your job is to:
1. Understand what the user wants to do
2. Ask clarifying questions if needed (channel: Email or WhatsApp, timing: now or schedule)
3. Execute actions step by step
4. Report back what was done

Always respond in this JSON format:
{
  "message": "Your conversational reply to the user",
  "action": "ACTION_NAME or null",
  "action_params": {},
  "is_complete": false,
  "needs_input": true or false,
  "input_question": "Question to ask user if needs_input is true or null"
}

Be conversational, clear, and professional. Always confirm before sending emails.
"""


def get_api_key():
    key = frappe.conf.get("anthropic_api_key", "")
    return key.encode("ascii", errors="ignore").decode("ascii")


@frappe.whitelist()
def process_agent_message(conversation_history, user_message):
    """Main agentic loop — receives full conversation and user message, returns next agent step."""
    frappe.only_for_logged_in_user()

    history = json.loads(conversation_history) if isinstance(conversation_history, str) else conversation_history
    history.append({"role": "user", "content": user_message})

    api_key = get_api_key()
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1000,
        "system": SYSTEM_PROMPT,
        "messages": history,
    }

    response = requests.post(CLAUDE_API_URL, headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    data = response.json()

    raw_text = data["content"][0]["text"]

    # Parse JSON from Claude response
    try:
        clean = re.sub(r"```json|```", "", raw_text).strip()
        agent_response = json.loads(clean)
    except Exception:
        agent_response = {
            "message": raw_text,
            "action": None,
            "action_params": {},
            "is_complete": False,
            "needs_input": False,
            "input_question": None,
        }

    # Execute action if Claude decided to take one
    action_result = None
    if agent_response.get("action"):
        action_result = execute_action(agent_response["action"], agent_response.get("action_params", {}))

    # Add assistant reply to history
    history.append({"role": "assistant", "content": raw_text})

    return {
        "message": agent_response.get("message", ""),
        "action": agent_response.get("action"),
        "action_result": action_result,
        "is_complete": agent_response.get("is_complete", False),
        "needs_input": agent_response.get("needs_input", False),
        "input_question": agent_response.get("input_question"),
        "history": history,
    }


def execute_action(action, params):
    """Execute the agentic action decided by Claude."""
    if action == "CHECK_PENDING_PAYMENTS":
        return check_pending_payments()
    elif action == "SEND_EMAIL_REMINDER":
        return send_email_reminders(params)
    elif action == "LOG_ACTION":
        return log_action(params)
    elif action == "GENERATE_REPORT":
        return generate_summary(params)
    return None


def check_pending_payments():
    """Fetch overdue/unpaid sales invoices."""
    try:
        invoices = frappe.db.sql("""
            SELECT
                name, customer, due_date, outstanding_amount, grand_total, status
            FROM
                `tabSales Invoice`
            WHERE
                docstatus = 1
                AND outstanding_amount > 0
                AND status IN ('Unpaid', 'Overdue', 'Partly Paid')
            ORDER BY
                due_date ASC
            LIMIT 20
        """, as_dict=True)

        # Convert date objects to strings
        for inv in invoices:
            if isinstance(inv.get("due_date"), date):
                inv["due_date"] = str(inv["due_date"])

        total_outstanding = sum(float(inv.get("outstanding_amount") or 0) for inv in invoices)

        return {
            "invoices": invoices,
            "count": len(invoices),
            "total_outstanding": total_outstanding,
        }
    except Exception as e:
        return {"error": str(e)}


def send_email_reminders(params):
    """Send payment reminder emails to customers."""
    invoices = params.get("invoices", [])
    sent = []
    failed = []

    for inv in invoices:
        try:
            customer_email = frappe.db.get_value("Customer", inv.get("customer"), "email_id")
            if not customer_email:
                # Try contact
                contact = frappe.db.sql("""
                    SELECT email_id FROM `tabContact`
                    WHERE name IN (
                        SELECT parent FROM `tabDynamic Link`
                        WHERE link_doctype='Customer' AND link_name=%s
                    )
                    LIMIT 1
                """, inv.get("customer"), as_dict=True)
                customer_email = contact[0].email_id if contact else None

            if customer_email:
                frappe.sendmail(
                    recipients=[customer_email],
                    subject=f"Payment Reminder — Invoice {inv.get('name')}",
                    message=f"""
                        <p>Dear {inv.get('customer')},</p>
                        <p>This is a friendly reminder that Invoice <strong>{inv.get('name')}</strong>
                        with an outstanding amount of <strong>₹{inv.get('outstanding_amount')}</strong>
                        was due on <strong>{inv.get('due_date')}</strong>.</p>
                        <p>Please arrange payment at your earliest convenience.</p>
                        <p>Thank you,<br>Accounts Team</p>
                    """,
                    now=True,
                )
                sent.append(inv.get("name"))
                log_action({"description": f"Email reminder sent for {inv.get('name')} to {customer_email}"})
            else:
                failed.append({"invoice": inv.get("name"), "reason": "No email found"})
        except Exception as e:
            failed.append({"invoice": inv.get("name"), "reason": str(e)})

    return {"sent": sent, "failed": failed, "sent_count": len(sent)}


def log_action(params):
    """Log agentic action to Voice Report Log."""
    try:
        frappe.get_doc({
            "doctype": "Voice Report Log",
            "user": frappe.session.user,
            "query_text": params.get("description", "Agentic action"),
            "generated_sql": params.get("sql", "N/A"),
            "row_count": params.get("row_count", 0),
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        return {"logged": True}
    except Exception as e:
        return {"logged": False, "error": str(e)}


def generate_summary(params):
    """Generate a final summary of all actions taken."""
    return {
        "summary": params.get("summary", "Actions completed successfully."),
        "timestamp": str(datetime.now()),
        "user": frappe.session.user,
    }
