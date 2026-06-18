from frappe import _


def get_data():
	return [
		{
			"module_name": "Voice Sql Report",
			"category": "Modules",
			"label": _("Voice Sql Report"),
			"color": "#4ECDC4",
			"icon": "fa fa-microphone",
			"type": "module",
			"description": "AI-powered voice-to-SQL reporting using Claude API",
		}
	]
