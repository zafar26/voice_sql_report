frappe.pages["agent-report"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "🤖 AI Agent Report",
		single_column: true,
	});

	// ── State ──────────────────────────────────────────────
	let conversationHistory = [];
	let isAgentRunning = false;

	// ── Layout ─────────────────────────────────────────────
	$(wrapper).find(".page-content").html(`
		<div id="agent-wrap" style="
			max-width:780px;
			margin:0 auto;
			padding:20px 16px 120px;
			font-family: var(--font-stack);
		">

			<!-- Header -->
			<div style="text-align:center; margin-bottom:28px;">
				<div style="font-size:40px; margin-bottom:6px;">🤖</div>
				<h2 style="margin:0; font-size:20px; font-weight:700; color:var(--heading-color);">
					AI Agent Report
				</h2>
				<p style="margin:6px 0 0; color:var(--text-muted); font-size:13px;">
					Tell the agent what to do — it will ask, act, and report back.
				</p>
			</div>

			<!-- Suggestion chips -->
			<div id="suggestions" style="
				display:flex; flex-wrap:wrap; gap:8px;
				justify-content:center; margin-bottom:24px;
			">
				<button class="suggest-btn" data-q="Sort out this month's pending payments">
					💳 Pending Payments
				</button>
				<button class="suggest-btn" data-q="Send reminders to overdue customers">
					📧 Send Reminders
				</button>
				<button class="suggest-btn" data-q="Show me outstanding invoices summary">
					📊 Outstanding Summary
				</button>
			</div>

			<!-- Chat window -->
			<div id="chat-window" style="
				background:var(--card-bg);
				border:1px solid var(--border-color);
				border-radius:12px;
				min-height:360px;
				max-height:520px;
				overflow-y:auto;
				padding:20px;
				margin-bottom:16px;
				display:flex;
				flex-direction:column;
				gap:14px;
			"></div>

			<!-- Action result panel (hidden by default) -->
			<div id="action-panel" style="display:none;
				background:var(--alert-bg);
				border:1px solid var(--border-color);
				border-radius:10px;
				padding:16px;
				margin-bottom:16px;
				font-size:13px;
			"></div>

			<!-- Input bar -->
			<div style="
				display:flex; gap:10px;
				background:var(--card-bg);
				border:1px solid var(--border-color);
				border-radius:12px;
				padding:10px 14px;
				align-items:center;
			">
				<input id="agent-input" type="text" placeholder="Tell the agent what to do…" style="
					flex:1; border:none; outline:none;
					background:transparent;
					font-size:14px;
					color:var(--text-color);
				"/>
				<button id="send-btn" style="
					background:#171717;
					color:#fff;
					border:none;
					border-radius:8px;
					padding:8px 18px;
					font-size:13px;
					font-weight:600;
					cursor:pointer;
					white-space:nowrap;
				">Send ▶</button>
			</div>

			<p style="text-align:center; color:var(--text-muted); font-size:11px; margin-top:10px;">
				Agent can check invoices, send reminders, and log actions autonomously.
			</p>
		</div>
	`);

	// ── Styles ─────────────────────────────────────────────
	$("<style>").text(`
		.suggest-btn {
			background: var(--control-bg);
			border: 1px solid var(--border-color);
			border-radius: 20px;
			padding: 7px 16px;
			font-size: 12px;
			cursor: pointer;
			color: var(--text-color);
			transition: all 0.15s;
		}
		.suggest-btn:hover {
			background: var(--primary);
			color: #fff;
			border-color: var(--primary);
		}
		.chat-bubble {
			display: flex;
			gap: 10px;
			align-items: flex-start;
			animation: fadeIn 0.2s ease;
		}
		.chat-bubble.user { flex-direction: row-reverse; }
		.bubble-avatar {
			width: 32px; height: 32px;
			border-radius: 50%;
			display: flex; align-items: center; justify-content: center;
			font-size: 16px; flex-shrink: 0;
			background: var(--control-bg);
		}
		.bubble-text {
			max-width: 78%;
			padding: 10px 14px;
			border-radius: 12px;
			font-size: 13.5px;
			line-height: 1.55;
		}
		.chat-bubble.agent .bubble-text {
			background: var(--control-bg);
			border-bottom-left-radius: 4px;
			color: var(--text-color);
		}
		.chat-bubble.user .bubble-text {
			background: #171717;
			color: #fff;
			border-bottom-right-radius: 4px;
		}
		.action-badge {
			display: inline-block;
			background: #e8f5e9;
			color: #2e7d32;
			border-radius: 6px;
			padding: 2px 8px;
			font-size: 11px;
			font-weight: 600;
			margin-bottom: 6px;
		}
		.typing-dot {
			width: 7px; height: 7px;
			background: var(--text-muted);
			border-radius: 50%;
			display: inline-block;
			animation: bounce 1.2s infinite;
		}
		.typing-dot:nth-child(2) { animation-delay: 0.2s; }
		.typing-dot:nth-child(3) { animation-delay: 0.4s; }
		@keyframes bounce {
			0%, 80%, 100% { transform: translateY(0); }
			40% { transform: translateY(-6px); }
		}
		@keyframes fadeIn {
			from { opacity: 0; transform: translateY(6px); }
			to { opacity: 1; transform: translateY(0); }
		}
		.invoice-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 12px;
			margin-top: 10px;
		}
		.invoice-table th {
			background: var(--control-bg);
			padding: 7px 10px;
			text-align: left;
			font-weight: 600;
			border-bottom: 1px solid var(--border-color);
		}
		.invoice-table td {
			padding: 6px 10px;
			border-bottom: 1px solid var(--border-color);
		}
		.status-overdue { color: #c62828; font-weight: 600; }
		.status-unpaid { color: #e65100; }
		#send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	`).appendTo("head");

	// ── Helpers ────────────────────────────────────────────
	function scrollChat() {
		const win = document.getElementById("chat-window");
		win.scrollTop = win.scrollHeight;
	}

	function addBubble(role, html) {
		const isUser = role === "user";
		const avatar = isUser ? "👤" : "🤖";
		const $bubble = $(`
			<div class="chat-bubble ${isUser ? "user" : "agent"}">
				<div class="bubble-avatar">${avatar}</div>
				<div class="bubble-text">${html}</div>
			</div>
		`);
		$("#chat-window").append($bubble);
		scrollChat();
		return $bubble;
	}

	function showTyping() {
		return addBubble("agent", `
			<span class="typing-dot"></span>
			<span class="typing-dot"></span>
			<span class="typing-dot"></span>
		`);
	}

	function formatCurrency(amount) {
		return "₹" + parseFloat(amount || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	}

	function renderActionResult(action, result) {
		if (!result) return;
		const panel = $("#action-panel");

		if (action === "CHECK_PENDING_PAYMENTS" && result.invoices) {
			const rows = result.invoices.map(inv => `
				<tr>
					<td>${inv.name}</td>
					<td>${inv.customer}</td>
					<td>${inv.due_date || "—"}</td>
					<td>${formatCurrency(inv.outstanding_amount)}</td>
					<td class="${inv.status === 'Overdue' ? 'status-overdue' : 'status-unpaid'}">${inv.status}</td>
				</tr>
			`).join("");

			panel.html(`
				<div class="action-badge">✅ CHECK_PENDING_PAYMENTS</div>
				<strong>${result.count} invoice(s) found — Total Outstanding: ${formatCurrency(result.total_outstanding)}</strong>
				<table class="invoice-table">
					<thead>
						<tr>
							<th>Invoice</th><th>Customer</th><th>Due Date</th>
							<th>Outstanding</th><th>Status</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			`).show();

		} else if (action === "SEND_EMAIL_REMINDER" && result.sent !== undefined) {
			panel.html(`
				<div class="action-badge">📧 SEND_EMAIL_REMINDER</div>
				<strong>${result.sent_count} reminder(s) sent successfully.</strong>
				${result.sent.length ? `<br>Sent: ${result.sent.join(", ")}` : ""}
				${result.failed.length ? `<br><span style="color:#c62828">Failed: ${result.failed.map(f => f.invoice + " (" + f.reason + ")").join(", ")}</span>` : ""}
			`).show();

		} else if (action === "GENERATE_REPORT") {
			panel.html(`
				<div class="action-badge">📊 GENERATE_REPORT</div>
				<strong>Agent completed all tasks.</strong><br>
				${result.summary}<br>
				<small style="color:var(--text-muted)">Completed at ${result.timestamp} by ${result.user}</small>
			`).show();
		}

		scrollChat();
	}

	// ── Core: send message to agent ────────────────────────
	async function sendToAgent(userMessage) {
		if (isAgentRunning || !userMessage.trim()) return;
		isAgentRunning = true;

		$("#suggestions").hide();
		$("#send-btn").prop("disabled", true);
		$("#agent-input").prop("disabled", true);

		addBubble("user", userMessage);
		const $typing = showTyping();

		try {
			const result = await frappe.call({
				method: "voice_sql_report.api.agent_query.process_agent_message",
				args: {
					conversation_history: JSON.stringify(conversationHistory),
					user_message: userMessage,
				},
			});

			$typing.remove();

			const data = result.message;
			conversationHistory = data.history || conversationHistory;

			// Show action badge if an action was taken
			let agentHtml = data.message || "";
			if (data.action) {
				agentHtml = `<span class="action-badge">⚡ ${data.action}</span><br>${agentHtml}`;
			}

			addBubble("agent", agentHtml);

			// Render action result panel
			if (data.action && data.action_result) {
				renderActionResult(data.action, data.action_result);
			}

			// If agent is done
			if (data.is_complete) {
				addBubble("agent", "✅ <strong>All tasks completed.</strong> You can start a new request anytime.");
				conversationHistory = [];
			}

		} catch (err) {
			$typing.remove();
			addBubble("agent", `❌ <span style="color:#c62828">Error: ${err.message || "Something went wrong. Please try again."}</span>`);
		} finally {
			isAgentRunning = false;
			$("#send-btn").prop("disabled", false);
			$("#agent-input").prop("disabled", false).focus();
		}
	}

	// ── Events ─────────────────────────────────────────────
	$("#send-btn").on("click", () => {
		const msg = $("#agent-input").val().trim();
		if (msg) {
			$("#agent-input").val("");
			sendToAgent(msg);
		}
	});

	$("#agent-input").on("keydown", function (e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const msg = $(this).val().trim();
			if (msg) {
				$(this).val("");
				sendToAgent(msg);
			}
		}
	});

	$(".suggest-btn").on("click", function () {
		const q = $(this).data("q");
		sendToAgent(q);
	});

	// ── Welcome message ────────────────────────────────────
	addBubble("agent", `
		👋 <strong>Hello! I'm your AI Agent.</strong><br><br>
		I can autonomously <strong>check pending payments</strong>, 
		<strong>send email reminders</strong> to customers, 
		<strong>log actions</strong>, and <strong>report back</strong> — all in one conversation.<br><br>
		Try: <em>"Sort out this month's pending payments"</em>
	`);
};
