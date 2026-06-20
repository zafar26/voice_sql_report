# Voice SQL Report — AI Voice Reporting for ERPNext

A custom Frappe/ERPNext app that lets users **speak or type a report
request** (e.g. *"show me today's sales"*) and get back a live report
rendered as an HTML table, with **Print** and **Export to Excel** buttons —
powered by the **Claude API**.

<img width="1353" height="689" alt="Screenshot 2026-06-18 at 11 29 53 AM" src="https://github.com/user-attachments/assets/7a485e68-e6a4-4615-95c8-ef0f203c877c" />
<img width="1353" height="325" alt="Screenshot 2026-06-20 at 11 28 59 AM" src="https://github.com/user-attachments/assets/9bed6dd5-85d5-422c-ad87-a0ef81803b38" />

---

## How it works

```
User speaks: "show me today's sales"
        |
        v
Web Speech API converts speech -> text (browser, no server round-trip)
        |
        v
frappe.call() -> voice_sql_report.api.voice_query.process_voice_query
        |
        v
Python sends ONLY the user's text query to Claude
(Claude never sees ERPNext data, only DocType/table names it's allowed to use)
        |
        v
Claude returns JSON: { title, sql, html_template, row_template }
        |
        v
Python validates the SQL (SELECT-only, whitelisted tables, no stacked queries)
        |
        v
Python runs the SQL via frappe.db.sql() against the real ERPNext database
        |
        v
Python returns { title, html_template, row_template, data } to the browser
(html_template/row_template came from Claude; data came from ERPNext — merged client-side)
        |
        v
JavaScript merges `data` into `row_template`, injects into `html_template`,
renders the table, and enables Print / Export to Excel buttons
```

### Why this design is safe

- **Claude never receives ERPNext data.** It only ever sees the user's
  spoken/typed request and a list of permitted table names. It generates
  SQL and HTML *blind* to your actual business data.
- **Claude-generated SQL is validated before execution**: must be a single
  `SELECT` statement, must only reference whitelisted `tab<DocType>` tables,
  and is scanned for dangerous keywords (`DROP`, `DELETE`, `UPDATE`, etc.)
  as a defense-in-depth layer on top of the system prompt instructions.
- **Claude-generated HTML is validated before rendering**: no `<script>`
  tags, no inline event handlers, no `javascript:` URLs.
- **Every request is logged** to the `Voice Report Log` DocType (user,
  query text, generated SQL, row count) for audit purposes.
- **Guest users are blocked** — only logged-in ERPNext users can run reports.

---

## Installation

```bash
# From your bench directory
bench get-app voice_sql_report /path/to/voice_sql_report
bench --site yoursite.local install-app voice_sql_report
bench --site yoursite.local migrate
```

### Configure your Claude API key

Never hardcode the key. Store it in site config:

```bash
bench --site yoursite.local set-config anthropic_api_key "sk-ant-xxxxxxxx"
```

### Access the page

Once installed, navigate to:

```
https://yoursite.local/app/voice-report
```

---

## Customizing the allowed DocTypes

Edit `voice_sql_report/api/voice_query.py` and update the `ALLOWED_DOCTYPES`
list. Only DocTypes in this list can be queried — this is your main
security control, so review it carefully before adding sensitive DocTypes
(e.g. never add `User`, `User Permission`, or anything with passwords/tokens).

```python
ALLOWED_DOCTYPES = [
    "Sales Invoice", "Purchase Invoice", "Sales Order",
    "Purchase Order", "Payment Entry", "Customer", "Supplier",
    "Item", "Stock Entry", "Journal Entry", "GL Entry",
    "Quotation", "Delivery Note",
]
```

---

## Example voice/text queries

- "Show me today's sales"
- "Top 10 customers this month by total sales"
- "Pending purchase orders"
- "Stock entries from last 7 days"
- "Outstanding payments from customers"

---

## Project structure

```
voice_sql_report/
├── voice_sql_report/
│   ├── api/
│   │   └── voice_query.py          # Claude call + SQL validation + execution
│   ├── doctype/
│   │   └── voice_report_log/       # Audit log DocType
│   ├── page/
│   │   └── voice_report/
│   │       ├── voice_report.js     # Mic capture, render, print, Excel export
│   │       ├── voice_report.py     # Page registration
│   │       └── voice_report.json   # Page definition
│   ├── hooks.py
│   └── modules.txt
├── setup.py
└── requirements.txt
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Voice input | Web Speech API (browser native, free) |
| AI | Claude API (claude-sonnet-4-6) |
| Backend | Frappe Framework (Python) |
| Database | MariaDB via `frappe.db.sql()` |
| Excel export | SheetJS (xlsx) |
| Print | Native browser print (`window.print()`) |
| Audit logging | Custom Frappe DocType |

---

## Author

Mohammed Qutubuddin Zafar — Senior Full-Stack Developer, ERPNext/Frappe Specialist
