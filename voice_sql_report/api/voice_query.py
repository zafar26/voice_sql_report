"""
voice_sql_report/api/voice_query.py

Core API for Voice-to-SQL AI Report system.

Flow:
1. Frontend sends voice transcript text
2. We ask Claude to convert it into:
      - a safe read-only SQL query against ERPNext's MariaDB
      - an HTML table template + row template to render results
3. We validate the SQL is SELECT-only (security gate)
4. We execute the SQL via frappe.db.sql() against the real ERPNext database
5. We return the Claude-generated HTML templates + the real data separately
   (Claude never sees actual ERPNext data — it only sees the user's text query
   and the database schema/DocType field names needed to write SQL)
"""

import json
import re
import requests
import frappe
from frappe import _


# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------
# Store your Claude API key in site_config.json (NOT in code):
#   bench --site yoursite.local set-config anthropic_api_key "sk-ant-xxxx"
#
# This keeps the key out of version control and out of the repo entirely.

CLAUDE_MODEL = "claude-sonnet-4-6"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

# Hard block list — if ANY of these keywords appear in the SQL Claude
# generates, we refuse to execute it. This is a defense-in-depth layer;
# the system prompt also instructs Claude to only ever write SELECT.
BLOCKED_SQL_KEYWORDS = [
    "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
    "TRUNCATE", "CREATE", "REPLACE", "GRANT", "REVOKE",
    "EXEC", "EXECUTE", "CALL", "INTO OUTFILE", "LOAD_FILE"
]

# Whitelist of DocTypes the assistant is allowed to query.
# This prevents Claude (even if manipulated) from pulling sensitive
# tables like tabUser, tabUser Permission, tabAuth, etc.
ALLOWED_DOCTYPES = [
    "Sales Invoice", "Sales Invoice Item",
    "Purchase Invoice", "Purchase Invoice Item",
    "Sales Order", "Sales Order Item",
    "Purchase Order", "Purchase Order Item",
    "Payment Entry",
    "Customer", "Supplier", "Item",
    "Stock Entry", "Stock Ledger Entry",
    "Journal Entry", "Journal Entry Account",
    "GL Entry",
    "Quotation", "Delivery Note",
]


# ---------------------------------------------------------------------------
# SYSTEM PROMPT — sent to Claude on every request
# ---------------------------------------------------------------------------

def build_system_prompt():
    """
    Builds the instruction prompt for Claude. Includes the allowed
    DocTypes so Claude knows the real table names (tab<DocType>) and
    sticks to schema it's permitted to use.
    """
    doctype_list = "\n".join(f"- `tab{d}`" for d in ALLOWED_DOCTYPES)

    return f"""You are a backend assistant inside an ERPNext/Frappe application.
A user will describe, in plain language, a business report they want
(e.g. "show me today's sales" or "top 10 customers this month").

Your job is to return ONLY a single JSON object (no prose, no markdown
fences, no explanation) with exactly this shape:

{{
  "title": "Short human-readable report title",
  "sql": "A single read-only MySQL/MariaDB SELECT statement",
  "html_template": "<table class='vr-table'><thead><tr>...header cells...</tr></thead><tbody>{{{{ROWS}}}}</tbody></table>",
  "row_template": "<tr><td>{{{{field_one}}}}</td><td>{{{{field_two}}}}</td></tr>"
}}

Strict rules:
1. "sql" MUST be a single SELECT statement only. Never write INSERT, UPDATE,
   DELETE, DROP, ALTER, TRUNCATE, or any data-modifying statement.
2. Only query these whitelisted Frappe tables (use backticks exactly like this):
{doctype_list}
3. Always filter on docstatus = 1 for transactional doctypes (Sales Invoice,
   Purchase Invoice, Sales Order, Purchase Order, etc.) unless the user
   explicitly asks for drafts/cancelled documents.
4. Use CURDATE(), CURDATE() - INTERVAL n DAY, MONTH(), YEAR() etc. for
   relative date logic like "today", "this week", "this month", "last 7 days".
5. "row_template" must contain a `{{{{field}}}}` placeholder for every column
   you SELECT, using the exact same alias/column name as in the SQL.
6. "html_template" must contain the literal placeholder `{{{{ROWS}}}}` exactly
   once, inside a <tbody>, where generated rows will be injected.
7. Keep HTML simple: <table>, <thead>, <tr>, <th>, <td> only. No <script> tags,
   no inline event handlers, no external resources.
8. If the user's request is ambiguous, make a reasonable default choice
   (e.g. "sales" with no date = today's sales) rather than asking a question.
9. Return raw JSON only — your entire response must be valid JSON, nothing else.
"""


# ---------------------------------------------------------------------------
# CLAUDE CALL
# ---------------------------------------------------------------------------

def ask_claude(user_query: str) -> dict:
    """
    Sends the user's voice transcript to Claude and parses the
    JSON response (sql + html_template + row_template + title).
    """
    api_key = frappe.conf.get("anthropic_api_key")
    if not api_key:
        frappe.throw(_("Anthropic API key not configured. Run: "
                        "bench set-config anthropic_api_key <key>"))

    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "system": build_system_prompt(),
        "messages": [
            {"role": "user", "content": user_query}
        ]
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    response = requests.post(CLAUDE_API_URL, headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    result = response.json()

    raw_text = "".join(
        block.get("text", "") for block in result.get("content", [])
        if block.get("type") == "text"
    ).strip()

    # Claude sometimes wraps JSON in ```json fences despite instructions —
    # strip them defensively.
    raw_text = re.sub(r"^```(json)?\s*|\s*```$", "", raw_text.strip())

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        frappe.log_error(message=raw_text, title="Voice SQL Report: bad JSON from Claude")
        frappe.throw(_("AI returned an invalid response. Please rephrase your request."))

    for key in ("title", "sql", "html_template", "row_template"):
        if key not in parsed:
            frappe.throw(_("AI response missing required field: {0}").format(key))

    return parsed


# ---------------------------------------------------------------------------
# SQL SAFETY VALIDATION
# ---------------------------------------------------------------------------

def validate_sql(sql: str):
    """
    Defense-in-depth checks before we ever execute AI-generated SQL.
    Raises frappe.ValidationError if the query looks unsafe.
    """
    sql_clean = sql.strip().rstrip(";")
    sql_upper = sql_clean.upper()

    # Must start with SELECT
    if not sql_upper.startswith("SELECT"):
        frappe.throw(_("Only SELECT queries are permitted."))

    # Must not contain a second statement (basic stacked-query guard)
    if ";" in sql_clean:
        frappe.throw(_("Multiple SQL statements are not permitted."))

    # Block dangerous keywords anywhere in the query
    for keyword in BLOCKED_SQL_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", sql_upper):
            frappe.throw(_("Query contains a disallowed keyword: {0}").format(keyword))

    # Ensure every referenced `tabX` table is in our whitelist
    referenced_tables = re.findall(r"`tab([^`]+)`", sql_clean)
    if not referenced_tables:
        frappe.throw(_("Could not detect a valid Frappe table reference in the query."))

    for table in referenced_tables:
        if table not in ALLOWED_DOCTYPES:
            frappe.throw(_("Query references a table that is not permitted: {0}").format(table))

    return sql_clean


def validate_html(html_template: str, row_template: str):
    """
    Basic safety checks on AI-generated HTML before it ever reaches the
    browser. We strip script tags / event handlers defensively even
    though the system prompt forbids them.
    """
    forbidden_patterns = [r"<script", r"on\w+\s*=", r"javascript:"]
    combined = (html_template or "") + (row_template or "")
    for pattern in forbidden_patterns:
        if re.search(pattern, combined, re.IGNORECASE):
            frappe.throw(_("AI-generated HTML failed safety validation."))

    if "{{ROWS}}" not in html_template:
        frappe.throw(_("AI-generated HTML template is missing the {{ROWS}} placeholder."))


# ---------------------------------------------------------------------------
# WHITELISTED ENDPOINT
# ---------------------------------------------------------------------------

@frappe.whitelist()
def process_voice_query(query_text: str):
    """
    Main entry point called from the Custom Page via frappe.call().

    Args:
        query_text: the transcribed voice (or typed) text from the user.

    Returns:
        {
          "title": "...",
          "html_template": "...",   # from Claude
          "row_template": "...",    # from Claude
          "data": [ {...}, {...} ]  # real rows from ERPNext, via frappe.db.sql
        }
    """
    if not query_text or not query_text.strip():
        frappe.throw(_("Please provide a report request."))

    # Optional: restrict who can run this. Adjust role as needed.
    if frappe.session.user == "Guest":
        frappe.throw(_("You must be logged in to generate reports."), frappe.PermissionError)

    # 1. Ask Claude for SQL + HTML templates (no ERPNext data sent to Claude)
    ai_result = ask_claude(query_text.strip())

    # 2. Validate the SQL Claude wrote before running it
    safe_sql = validate_sql(ai_result["sql"])

    # 3. Validate the HTML Claude wrote before rendering it
    validate_html(ai_result["html_template"], ai_result["row_template"])

    # 4. Execute against the real ERPNext database
    try:
        data = frappe.db.sql(safe_sql, as_dict=True)
    except Exception as e:
        frappe.log_error(message=f"SQL: {safe_sql}\nError: {e}",
                          title="Voice SQL Report: execution failed")
        frappe.throw(_("Could not run the generated report query. Please rephrase your request."))

    # 5. Log for audit trail (who ran what, when)
    frappe.get_doc({
        "doctype": "Voice Report Log",
        "user": frappe.session.user,
        "query_text": query_text,
        "generated_sql": safe_sql,
        "row_count": len(data),
    }).insert(ignore_permissions=True)

    return {
        "title": ai_result["title"],
        "html_template": ai_result["html_template"],
        "row_template": ai_result["row_template"],
        "data": data,
    }
