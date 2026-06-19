import frappe
from frappe.model.document import Document


class VoiceReportLog(Document):
	"""
	Audit log: stores every voice/text report request, the SQL Claude
	generated for it, and how many rows came back. Read-only audit trail —
	created automatically from voice_query.process_voice_query().
	"""
	pass
