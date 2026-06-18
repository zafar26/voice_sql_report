app_name = "voice_sql_report"
app_title = "Voice SQL Report"
app_publisher = "Mohammed Qutubuddin Zafar"
app_description = "AI-powered voice-to-SQL reporting for ERPNext using Claude API"
app_email = "your-email@example.com"
app_license = "mit"

# Apps
# ------------------
required_apps = ["frappe", "erpnext"]

# Includes in <head>
# ------------------
# app_include_css = "/assets/voice_sql_report/css/voice_sql_report.css"
# app_include_js = "/assets/voice_sql_report/js/voice_sql_report.js"

# Home Pages
# ----------
# application home page (will override Website Settings)
# home_page = "login"

# Installation
# ------------
# before_install = "voice_sql_report.install.before_install"
# after_install = "voice_sql_report.install.after_install"

# Fixtures
# --------
# Ensures the Voice Report Log DocType ships with the app on install
fixtures = []

# Desk Notifications
# -------------------
# See frappe.core.notifications.get_notification_config

# Permissions
# -----------
# Permissions evaluated in scripted ways

# DocType Class
# ---------------
# Override standard doctype classes

# Document Events
# ---------------
# Hook on document methods and events

# Scheduled Tasks
# ---------------
# scheduler_events = {}

# Testing
# -------
# before_tests = "voice_sql_report.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "voice_sql_report.event.get_events"
# }
