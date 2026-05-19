import { createHash } from "node:crypto";

const CLP_FORMAT = new Intl.NumberFormat("es-CL", {
	style: "currency",
	currency: "CLP",
	maximumFractionDigits: 0,
});

const CATEGORY_RULES = [
	{
		category: "Comida",
		re: /supermercado|jumbo|lider|unimarc|tottus|restaurant|caf[eé]|delivery|rappi|pedidos/i,
	},
	{
		category: "Transporte",
		re: /uber|cabify|metro|bip|copec|shell|petrobras|bencina|combustible/i,
	},
	{
		category: "Salud",
		re: /farmacia|cruz verde|salcobrand|ahumada|cl[ií]nica|doctor|m[eé]dico/i,
	},
	{
		category: "Servicios",
		re: /enel|aguas|internet|movistar|entel|wom|claro|metrogas|servicio/i,
	},
	{ category: "Ocio", re: /cine|netflix|spotify|steam|bar|pub|evento/i },
];

export function parseBancoChileEmail(rawInput, options = {}) {
	const raw = String(rawInput == null ? "" : rawInput);
	const subject = normalizeEmailText(
		options.subject == null ? "" : options.subject,
	);
	const text = normalizeEmailText(raw);
	const amount = extractAmount(text);
	const occurredAt = extractDate(text);
	const kind = inferKind(text, subject);
	const direction = inferDirection(text, kind);
	const counterparty = extractCounterparty(text);
	const description = extractDescription(text, counterparty, kind);
	const category = suggestCategory(
		`${counterparty == null ? "" : counterparty} ${description == null ? "" : description}`,
	);
	const extractedSourceId = extractTransactionId(text);
	const sourceId = extractedSourceId || stableSourceId(`${subject}\n${text}`);

	const missing = [];
	if (amount == null) missing.push("amount");
	if (occurredAt == null) missing.push("occurredAt");
	if (kind === "unknown") missing.push("kind");

	const confidence = Math.max(
		0.2,
		1 - missing.length * 0.22 - (counterparty ? 0 : 0.12),
	);

	return {
		source: "manual_email_paste",
		sourceId,
		occurredAt,
		amount,
		currency: "CLP",
		direction,
		kind,
		counterparty,
		description,
		category,
		confidence: Number(confidence.toFixed(2)),
		status: missing.length === 0 ? "detected" : "needs_review",
		rawPreview: redactSensitive(
			subject ? `Asunto: ${subject}\n${text}` : text,
		).slice(0, 600),
		missing,
	};
}

export function normalizeEmailText(raw) {
	return decodeHtmlEntities(String(raw))
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/td>|<\/th>|<\/p>|<\/div>|<\/tr>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/\r/g, "\n")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function decodeHtmlEntities(value) {
	if (value === null || value === undefined) return value;
	return String(value)
		.replace(/&nbsp;/gi, " ")
		.replace(/&#160;/gi, " ")
		.replace(/&#xA0;/gi, " ")
		.replace(/&[a-zA-Z]+;|&#\d+;|&#x[\da-fA-F]+;/g, decodeHtmlEntity);
}

function decodeHtmlEntity(entity) {
	if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
		return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
	}
	if (entity.startsWith("&#")) {
		return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
	}

	const named = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		aacute: "á",
		eacute: "é",
		iacute: "í",
		oacute: "ó",
		uacute: "ú",
		ntilde: "ñ",
		Aacute: "Á",
		Eacute: "É",
		Iacute: "Í",
		Oacute: "Ó",
		Uacute: "Ú",
		Ntilde: "Ñ",
		uuml: "ü",
		Uuml: "Ü",
	};
	return named[entity.slice(1, -1)] || entity;
}

function extractAmount(text) {
	const fieldValue = getFieldValue(text, [
		"Monto",
		"Importe",
		"Valor",
		"Total",
	]);
	if (fieldValue) {
		const parsed = parseClpAmount(fieldValue);
		if (parsed != null) return parsed;
	}

	const labeled = [
		/(?:monto|importe|valor|total)\s*:?\s*\$?\s*([\d.]+)(?:,\d+)?/i,
		/\$\s*([\d.]+)(?:,\d+)?\s*(?:clp|pesos)?/i,
	];

	for (const re of labeled) {
		const match = text.match(re);
		if (match) return parseClpAmount(match[1]);
	}

	return null;
}

function parseClpAmount(value) {
	const normalized = String(value).replace(/\./g, "").replace(/[^\d]/g, "");
	if (!normalized) return null;
	return Number(normalized);
}

function extractDate(text) {
	const spanishDate = text.match(
		/(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)?\s*(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i,
	);
	if (spanishDate) {
		const [, dd, monthName, yyyy, hh = "00", min = "00"] = spanishDate;
		const mm = monthNumber(monthName);
		if (mm) return toIsoLocal(yyyy, mm, dd, hh, min);
	}

	const patterns = [
		/(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
		/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/,
	];

	for (const re of patterns) {
		const match = text.match(re);
		if (!match) continue;

		if (re === patterns[0]) {
			const [, dd, mm, yyyy, hh = "00", min = "00"] = match;
			return toIsoLocal(yyyy, mm, dd, hh, min);
		}

		const [, yyyy, mm, dd, hh = "00", min = "00"] = match;
		return toIsoLocal(yyyy, mm, dd, hh, min);
	}

	return null;
}

function toIsoLocal(yyyy, mm, dd, hh, min) {
	return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:${min.padStart(2, "0")}:00`;
}

function monthNumber(monthName) {
	const months = {
		enero: "01",
		febrero: "02",
		marzo: "03",
		abril: "04",
		mayo: "05",
		junio: "06",
		julio: "07",
		agosto: "08",
		septiembre: "09",
		octubre: "10",
		noviembre: "11",
		diciembre: "12",
	};
	return months[normalizeForCompare(monthName)];
}

function inferKind(text, subject = "") {
	const combined = `${subject}\n${text}`;
	if (
		/compra|cargo en cuenta|tarjeta|d[eé]bito|cr[eé]dito|pos|webpay/i.test(
			combined,
		)
	)
		return "purchase";
	if (isExplicitIncomingTransfer(combined)) return "income";
	if (isExplicitOutgoingTransfer(combined)) return "transfer";
	if (/transferencia/i.test(combined)) return "transfer";
	if (/pago/i.test(combined)) return "payment";
	return "unknown";
}

function inferDirection(text, kind) {
	if (kind === "purchase" || kind === "payment") return "outflow";
	if (isExplicitIncomingTransfer(text)) return "inflow";
	if (isExplicitOutgoingTransfer(text)) return "outflow";
	if (kind === "income") return "inflow";
	return "outflow";
}

function isExplicitOutgoingTransfer(text) {
	return /has realizado una transferencia|usted ha efectuado una transferencia|ha efectuado una transferencia de fondos a (?!tu cuenta)|transferencia a terceros|comprobante de transferencia|cargo en cuenta/i.test(
		text,
	);
}

function isExplicitIncomingTransfer(text) {
	return /nuestro\(a\) cliente\s+.+?\s+ha efectuado una transferencia[\s\S]*?a tu cuenta|transferencia de fondos a tu cuenta|transferencia recibida|has recibido[\s\S]*?transferencia|recibiste[\s\S]*?transferencia|abono recibido|dep[oó]sito recibido/i.test(
		text,
	);
}

function extractCounterparty(text) {
	const purchaseMerchant = extractPurchaseChargeMerchant(text);
	if (purchaseMerchant) return purchaseMerchant;

	const outgoingTransferCounterparty =
		extractOutgoingTransferCounterparty(text);
	if (outgoingTransferCounterparty) return outgoingTransferCounterparty;

	const incomingTransferCounterparty =
		extractIncomingTransferCounterparty(text);
	if (incomingTransferCounterparty) return incomingTransferCounterparty;

	const fieldValue = getFieldValue(text, [
		"Nombre y Apellido",
		"Nombre",
		"Destinatario",
		"Beneficiario",
		"Desde",
		"Origen",
		"Remitente",
		"Comercio",
		"Establecimiento",
	]);
	if (fieldValue && !isInvalidCounterparty(fieldValue))
		return cleanValue(fieldValue);

	const patterns = [
		/(?:destinatario|beneficiario|comercio|establecimiento|desde|origen|remitente)[ \t]*:?[ \t]*([^\n]+)/i,
		/(?:a|para)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .'-]{3,80})/,
		/(?:desde|de)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .'-]{3,80})/,
	];

	for (const re of patterns) {
		const match = text.match(re);
		if (!match) continue;
		if (isInvalidCounterparty(match[1])) continue;
		return cleanValue(match[1]);
	}

	return null;
}

function extractDescription(text, counterparty, kind) {
	const fieldValue = getFieldValue(text, [
		"Mensaje",
		"Asunto",
		"Descripción",
		"Descripcion",
		"Glosa",
		"Comentario",
	]);
	if (fieldValue) return cleanValue(fieldValue);

	const subjectMatch = text.match(
		/(?:asunto|descripci[oó]n|glosa|comentario)\s*:?\s*([^\n]+)/i,
	);
	const subject = subjectMatch ? subjectMatch[1] : null;
	if (subject) return cleanValue(subject);
	if (counterparty) return `${labelForKind(kind)} ${counterparty}`;
	return labelForKind(kind);
}

function extractPurchaseChargeMerchant(text) {
	const match = text.match(
		/se ha realizado una compra por\s+\$?\s*[\d.]+(?:,\d+)?\s+con cargo a\s+Cuenta\s+[*\d]+\s+en\s+(.+?)\s+el\s+\d{1,2}[/-]\d{1,2}[/-]\d{4}/i,
	);
	return match ? cleanValue(match[1]) : null;
}

function extractOutgoingTransferCounterparty(text) {
	if (!isExplicitOutgoingTransfer(text)) return null;
	const destinationName = getSectionFieldValue(
		text,
		["Destino", "Datos del Destinatario"],
		["Nombre y Apellido", "Destinatario", "Beneficiario", "Nombre"],
	);
	if (!destinationName || isInvalidCounterparty(destinationName)) return null;
	return cleanValue(destinationName);
}

function extractIncomingTransferCounterparty(text) {
	if (!isExplicitIncomingTransfer(text)) return null;
	const senderName = extractIncomingTransferSender(text);
	if (senderName && !isInvalidCounterparty(senderName)) return senderName;

	const originName = getSectionFieldValue(
		text,
		["Origen"],
		["Nombre y Apellido", "Remitente", "Desde", "Origen"],
	);
	if (!originName || isInvalidCounterparty(originName)) return null;
	return cleanValue(originName);
}

function extractIncomingTransferSender(text) {
	const match = text.match(
		/nuestro\(a\) cliente\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .'-]{3,80})\s+ha efectuado una transferencia/i,
	);
	return match ? cleanValue(match[1]) : null;
}

function labelForKind(kind) {
	return (
		{
			transfer: "Transferencia",
			payment: "Pago",
			purchase: "Compra",
			income: "Abono",
			unknown: "Movimiento",
		}[kind] || "Movimiento"
	);
}

function cleanValue(value) {
	return String(value)
		.replace(/\s{2,}/g, " ")
		.replace(/(?:rut|cuenta|banco|monto|fecha)\s*:.*$/i, "")
		.replace(/[.;,]+$/g, "")
		.trim()
		.slice(0, 120);
}

function suggestCategory(text) {
	for (const rule of CATEGORY_RULES) {
		if (rule.re.test(text)) return rule.category;
	}
	return null;
}

function getFieldValue(text, labels) {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const normalizedLabels = labels.map(normalizeForCompare);

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const normalizedLine = normalizeForCompare(line).replace(/:$/, "");
		const labelIndex = normalizedLabels.indexOf(normalizedLine);
		if (labelIndex === -1) continue;

		const inlineValue = line
			.slice(labels[labelIndex].length)
			.replace(/^\s*:?\s*/, "")
			.trim();
		if (inlineValue) return inlineValue;

		for (let next = index + 1; next < lines.length; next += 1) {
			const nextLine = lines[next];
			const normalizedNext = normalizeForCompare(nextLine).replace(/:$/, "");
			if (normalizedLabels.includes(normalizedNext)) continue;
			if (isLikelyLabelLine(nextLine)) return null;
			return nextLine;
		}
	}

	return null;
}

function getSectionFieldValue(text, sectionLabels, fieldLabels) {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const normalizedSectionLabels = sectionLabels.map(normalizeForCompare);
	const normalizedFieldLabels = fieldLabels.map(normalizeForCompare);
	const sectionStops = new Set([
		"origen",
		"destino",
		"datos del destinatario",
		"datos de la transferencia",
		"monto",
		"mensaje",
		"fecha y hora",
		"transaccion",
		"transacción",
		"id",
	]);

	for (let index = 0; index < lines.length; index += 1) {
		const normalizedLine = normalizeForCompare(lines[index]).replace(/:$/, "");
		if (!normalizedSectionLabels.includes(normalizedLine)) continue;

		for (let next = index + 1; next < lines.length; next += 1) {
			const currentLine = lines[next];
			const normalizedCurrent = normalizeForCompare(currentLine).replace(
				/:$/,
				"",
			);

			if (next > index + 1 && sectionStops.has(normalizedCurrent)) break;

			const fieldIndex = normalizedFieldLabels.indexOf(normalizedCurrent);
			if (fieldIndex === -1) continue;

			const inlineValue = currentLine
				.slice(fieldLabels[fieldIndex].length)
				.replace(/^\s*:?\s*/, "")
				.trim();
			if (inlineValue && !isInvalidCounterparty(inlineValue)) {
				return inlineValue;
			}

			for (
				let valueIndex = next + 1;
				valueIndex < lines.length;
				valueIndex += 1
			) {
				const valueLine = lines[valueIndex];
				const normalizedValue = normalizeForCompare(valueLine).replace(
					/:$/,
					"",
				);
				if (sectionStops.has(normalizedValue)) return null;
				if (normalizedFieldLabels.includes(normalizedValue)) break;
				if (isLikelyLabelLine(valueLine)) return null;
				if (isInvalidCounterparty(valueLine)) return null;
				return valueLine;
			}
		}
	}

	return null;
}

function extractTransactionId(text) {
	const value = getFieldValue(text, [
		"Transacción",
		"Transaccion",
		"ID",
		"Número de comprobante",
		"Numero de comprobante",
	]);
	if (!value) return null;
	const match = value.match(/[A-Z0-9_]{10,}/i);
	const id = match ? match[0] : null;
	return id ? `banco-chile:${id}` : null;
}

function redactSensitive(text) {
	return text
		.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
		.replace(/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/g, "[rut]")
		.replace(/\b\d{7,8}-[\dkK]\b/g, "[rut]")
		.replace(/\b\d{2}-\d{3}-\d{5}-\d{2}\b/g, "[cuenta]")
		.replace(/Cuenta\s+\*+\d+/gi, "Cuenta [cuenta]");
}

function isLikelyLabelLine(line) {
	const normalized = normalizeForCompare(line).replace(/:$/, "");
	return [
		"origen",
		"destino",
		"datos del destinatario",
		"datos de la transferencia",
		"tipo de cuenta",
		"n de cuenta",
		"rut",
		"banco",
		"email",
		"mail",
		"monto",
		"mensaje",
		"fecha y hora",
		"transaccion",
		"transacción",
		"id",
	].includes(normalized);
}

function isInvalidCounterparty(value) {
	const normalized = normalizeForCompare(value).replace(/:$/, "");
	return [
		"tipo de cuenta",
		"n de cuenta",
		"no de cuenta",
		"numero de cuenta",
		"rut",
		"banco",
		"email",
		"mail",
		"monto",
		"mensaje",
		"fecha y hora",
		"transaccion",
		"transacción",
		"id",
		"cuenta corriente",
		"cuenta vista",
	].includes(normalized);
}

function normalizeForCompare(value) {
	return String(value)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

function stableSourceId(text) {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").slice(0, 4000);
	return createHash("sha256").update(normalized).digest("hex");
}

export function formatClp(amount) {
	return amount == null ? "Sin monto" : CLP_FORMAT.format(amount);
}
