/**
 * voice_report.js
 *
 * AI Voice Report — Custom Page inside ERPNext.
 *
 * Flow:
 *  1. User clicks mic, speaks a request ("show me today's sales")
 *  2. Web Speech API converts speech -> text
 *  3. frappe.call() hits our whitelisted Python method:
 *       voice_sql_report.api.voice_query.process_voice_query
 *  4. Python asks Claude for {title, sql, html_template, row_template},
 *     validates + runs the SQL against ERPNext, and returns the
 *     templates + real data separately.
 *  5. JS merges the real `data` rows into Claude's `row_template`,
 *     injects that into `html_template`, and renders it on the page.
 *  6. Print button -> browser print of the rendered table.
 *     Export button -> SheetJS converts the same data to .xlsx.
 */

frappe.pages["voice-report"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "AI Voice Report",
		single_column: true,
	});

	new VoiceReport(page);
};

class VoiceReport {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.last_data = null;
		this.last_title = null;

		this.render_shell();
		this.bind_mic_button();
		this.bind_action_buttons();
	}

	// -------------------------------------------------------------------
	// UI SHELL
	// -------------------------------------------------------------------
	render_shell() {
		this.wrapper.html(`
			<div class="vr-container">
				<div class="vr-input-row">
					<input type="text" class="form-control vr-text-input"
						placeholder="Type a request, or click the mic and speak — e.g. 'show me today's sales'">
					<button class="btn btn-default vr-mic-btn" title="Click and speak">
						<i class="fa fa-microphone"></i>
					</button>
					<button class="btn btn-primary vr-ask-btn">
						Ask AI
					</button>
				</div>

				<div class="vr-status text-muted small" style="margin-top:8px;"></div>

				<div class="vr-result-card" style="display:none; margin-top:20px;">
					<div class="vr-result-header">
						<h4 class="vr-result-title"></h4>
						<div class="vr-result-actions">
							<button class="btn btn-sm btn-default vr-print-btn">
								<i class="fa fa-print"></i> Print
							</button>
							<button class="btn btn-sm btn-success vr-excel-btn">
								<i class="fa fa-file-excel-o"></i> Export Excel
							</button>
						</div>
					</div>
					<div class="vr-table-wrapper"></div>
				</div>
			</div>

			<style>
				.vr-container { max-width: 900px; margin: 0 auto; padding: 10px 0; }
				.vr-input-row { display: flex; gap: 8px; }
				.vr-text-input { flex: 1; }
				.vr-mic-btn.listening { background: #ff4d4f; color: white; }
				.vr-result-card {
					border: 1px solid var(--border-color, #d1d8dd);
					border-radius: 8px;
					padding: 16px;
					background: var(--card-bg, #fff);
				}
				.vr-result-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 12px;
				}
				.vr-result-actions { display: flex; gap: 8px; }
				.vr-table-wrapper table.vr-table {
					width: 100%;
					border-collapse: collapse;
					font-size: 13px;
				}
				.vr-table-wrapper table.vr-table th,
				.vr-table-wrapper table.vr-table td {
					border: 1px solid #e0e0e0;
					padding: 6px 10px;
					text-align: left;
				}
				.vr-table-wrapper table.vr-table th {
					background: #f5f7fa;
					font-weight: 600;
				}
				.vr-table-wrapper table.vr-table tr:nth-child(even) {
					background: #fafbfc;
				}
				@media print {
					.vr-input-row, .vr-result-actions, .vr-status { display: none !important; }
				}
			</style>
		`);
	}

	// -------------------------------------------------------------------
	// VOICE CAPTURE (Web Speech API)
	// -------------------------------------------------------------------
	bind_mic_button() {
		const mic_btn = this.wrapper.find(".vr-mic-btn");
		const text_input = this.wrapper.find(".vr-text-input");

		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SpeechRecognition) {
			mic_btn.prop("disabled", true).attr("title", "Voice input not supported in this browser");
			return;
		}

		const recognizer = new SpeechRecognition();
		recognizer.lang = "en-US";
		recognizer.interimResults = false;
		recognizer.maxAlternatives = 1;

		let listening = false;

		mic_btn.on("click", () => {
			if (listening) {
				recognizer.stop();
				return;
			}
			recognizer.start();
		});

		recognizer.onstart = () => {
			listening = true;
			mic_btn.addClass("listening");
			this.set_status("Listening...");
		};

		recognizer.onresult = (event) => {
			const transcript = event.results[0][0].transcript;
			text_input.val(transcript);
			this.set_status(`Heard: "${transcript}"`);
		};

		recognizer.onerror = (event) => {
			this.set_status(`Voice error: ${event.error}`, true);
		};

		recognizer.onend = () => {
			listening = false;
			mic_btn.removeClass("listening");
		};
	}

	// -------------------------------------------------------------------
	// ASK AI / PRINT / EXCEL BUTTONS
	// -------------------------------------------------------------------
	bind_action_buttons() {
		this.wrapper.find(".vr-ask-btn").on("click", () => this.run_query());

		this.wrapper.find(".vr-text-input").on("keypress", (e) => {
			if (e.which === 13) this.run_query();
		});

		this.wrapper.find(".vr-print-btn").on("click", () => {
			window.print();
		});

		this.wrapper.find(".vr-excel-btn").on("click", () => {
			this.export_excel();
		});
	}

	set_status(msg, is_error) {
		this.wrapper
			.find(".vr-status")
			.text(msg || "")
			.css("color", is_error ? "#d33" : "");
	}

	// -------------------------------------------------------------------
	// MAIN QUERY EXECUTION
	// -------------------------------------------------------------------
	run_query() {
		const query_text = this.wrapper.find(".vr-text-input").val().trim();
		if (!query_text) {
			frappe.show_alert({ message: "Please type or speak a request first", indicator: "orange" });
			return;
		}

		this.set_status("Asking AI and fetching data from ERPNext...");
		this.wrapper.find(".vr-ask-btn").prop("disabled", true);

		frappe.call({
			method: "voice_sql_report.api.voice_query.process_voice_query",
			args: { query_text },
			freeze: true,
			freeze_message: "Generating your report...",
			callback: (r) => {
				this.wrapper.find(".vr-ask-btn").prop("disabled", false);

				if (!r.message) {
					this.set_status("No response from AI.", true);
					return;
				}
				this.render_report(r.message);
				this.set_status(`Done — ${r.message.data.length} row(s) returned.`);
			},
			error: () => {
				this.wrapper.find(".vr-ask-btn").prop("disabled", false);
				this.set_status("Something went wrong. Please try rephrasing your request.", true);
			},
		});
	}

	// -------------------------------------------------------------------
	// MERGE CLAUDE'S HTML TEMPLATE WITH REAL ERPNEXT DATA
	// -------------------------------------------------------------------
	render_report(payload) {
		const { title, html_template, row_template, data } = payload;

		this.last_data = data;
		this.last_title = title;

		// Build each row by replacing {{field}} placeholders with real values
		const rows_html = data
			.map((row) => {
				let row_html = row_template;
				Object.keys(row).forEach((key) => {
					const value = row[key] === null || row[key] === undefined ? "" : row[key];
					row_html = row_html.split(`{{${key}}}`).join(this.escape_html(value));
				});
				return row_html;
			})
			.join("");

		const final_html = html_template.replace("{{ROWS}}", rows_html);

		this.wrapper.find(".vr-result-title").text(title);
		this.wrapper.find(".vr-table-wrapper").html(final_html);
		this.wrapper.find(".vr-result-card").show();
	}

	escape_html(value) {
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}

	// -------------------------------------------------------------------
	// EXCEL EXPORT (SheetJS)
	// -------------------------------------------------------------------
	export_excel() {
		if (!this.last_data || !this.last_data.length) {
			frappe.show_alert({ message: "No data to export yet", indicator: "orange" });
			return;
		}

		// frappe.boot already ships with xlsx in newer versions; if not,
		// load it dynamically from the bundled assets.
		const generate = () => {
			const ws = XLSX.utils.json_to_sheet(this.last_data);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, "Report");
			const filename = `${(this.last_title || "report").replace(/\s+/g, "_")}.xlsx`;
			XLSX.writeFile(wb, filename);
		};

		if (typeof XLSX !== "undefined") {
			generate();
		} else {
			frappe.require(
				"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
				generate
			);
		}
	}
}
