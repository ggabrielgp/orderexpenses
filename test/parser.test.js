import test from "node:test";
import assert from "node:assert/strict";
import { parseBancoChileEmail } from "../src/parser.js";

test("parses a Banco de Chile transfer email text", () => {
	const parsed = parseBancoChileEmail(`
    Banco de Chile
    Comprobante de transferencia
    Fecha: 15/05/2026 14:22
    Monto: $25.000
    Destinatario: Persona Ejemplo
    Descripción: almuerzo compartido
  `);

	assert.equal(parsed.amount, 25000);
	assert.equal(parsed.occurredAt, "2026-05-15T14:22:00");
	assert.equal(parsed.kind, "transfer");
	assert.equal(parsed.direction, "outflow");
	assert.equal(parsed.counterparty, "Persona Ejemplo");
	assert.equal(parsed.description, "almuerzo compartido");
	assert.equal(parsed.status, "detected");
});

test("parses a purchase and suggests category", () => {
	const parsed = parseBancoChileEmail(`
    Aviso de compra con tarjeta
    Fecha: 16/05/2026
    Comercio: Supermercado Lider
    Monto: $41.990
  `);

	assert.equal(parsed.amount, 41990);
	assert.equal(parsed.kind, "purchase");
	assert.equal(parsed.category, "Comida");
});

test("marks incomplete email as needs review", () => {
	const parsed = parseBancoChileEmail("Banco de Chile aviso sin monto claro");

	assert.equal(parsed.status, "needs_review");
	assert.ok(parsed.missing.includes("amount"));
});

test("parses Banco de Chile transfer HTML table format", () => {
	const parsed = parseBancoChileEmail(`
		<td>Comprobante de Transferencia a terceros</td>
		<td>Nombre y Apellido</td><td>Persona Destino</td>
		<td>Rut</td><td>12345678-9</td>
		<td>Banco</td><td>Mercado Pago</td>
		<td>Email</td><td>persona@example.com</td>
		<td>Monto</td><td>$2.500</td>
		<td>Mensaje</td><td></td>
		<p>Fecha y Hora:</p>
		<p>miércoles 13 de mayo de 2026 14:12</p>
		<p>Transacción</p>
		<p>TEFMBCO2605131411304953826250</p>
	`);

	assert.equal(parsed.amount, 2500);
	assert.equal(parsed.occurredAt, "2026-05-13T14:12:00");
	assert.equal(parsed.kind, "transfer");
	assert.equal(parsed.direction, "outflow");
	assert.equal(parsed.counterparty, "Persona Destino");
	assert.equal(parsed.description, "Transferencia Persona Destino");
	assert.equal(parsed.sourceId, "banco-chile:TEFMBCO2605131411304953826250");
	assert.equal(parsed.status, "detected");
	assert.match(parsed.rawPreview, /\[email\]/);
	assert.match(parsed.rawPreview, /\[rut\]/);
});

test("parses Banco de Chile account charge purchase email", () => {
	const parsed = parseBancoChileEmail(
		`
		Te informamos que se ha realizado una compra por $30.000 con cargo a Cuenta ****0905 en ORTOFUNCION SPA el 15/05/2026 19:15.
		Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.
		Este mensaje ha sido enviado a persona@example.com con información exclusiva para clientes del banco.
	`,
		{ subject: "Cargo en Cuenta" },
	);

	assert.equal(parsed.amount, 30000);
	assert.equal(parsed.occurredAt, "2026-05-15T19:15:00");
	assert.equal(parsed.kind, "purchase");
	assert.equal(parsed.direction, "outflow");
	assert.equal(parsed.counterparty, "ORTOFUNCION SPA");
	assert.equal(parsed.description, "Compra ORTOFUNCION SPA");
	assert.equal(parsed.status, "detected");
	assert.match(parsed.rawPreview, /Asunto: Cargo en Cuenta/);
	assert.match(parsed.rawPreview, /Cuenta \[cuenta\]/);
	assert.match(parsed.rawPreview, /\[email\]/);
});

test("uses Banco de Chile subject as kind signal", () => {
	const parsed = parseBancoChileEmail("Monto: $1.000\nFecha: 15/05/2026", {
		subject: "Cargo en Cuenta",
	});

	assert.equal(parsed.kind, "purchase");
	assert.equal(parsed.status, "detected");
});

test("decodes HTML entities in names and descriptions", () => {
	const parsed = parseBancoChileEmail(`
		Comprobante de Transferencia a terceros
		Fecha: 15/05/2026 14:22
		Monto: $25.000
		Destinatario: Gabriel G&oacute;mez Pe&ntilde;a
		Descripci&oacute;n: caf&eacute; y colaci&oacute;n
	`);

	assert.equal(parsed.counterparty, "Gabriel Gómez Peña");
	assert.equal(parsed.description, "café y colación");
	assert.match(parsed.rawPreview, /Gómez/);
	assert.doesNotMatch(parsed.rawPreview, /&oacute;/);
});

test("keeps purchase charges as expenses even with generic footer copy", () => {
	const parsed = parseBancoChileEmail(
		`
		Te informamos que se ha realizado una compra por $30.000 con cargo a Cuenta ****0905 en ORTOFUNCION SPA el 15/05/2026 19:15.
		Mensaje recibido por clientes del banco.
	`,
		{ subject: "Cargo en Cuenta" },
	);

	assert.equal(parsed.kind, "purchase");
	assert.equal(parsed.direction, "outflow");
});

test("keeps outgoing transfers with abono wording as expenses", () => {
	const parsed = parseBancoChileEmail(
		`
		Banco de Chile
		Comprobante de Transferencia a terceros
		Has realizado una transferencia
		Fecha: 15/05/2026 14:22
		Monto: $25.000
		Destinatario: Persona Ejemplo
		Tipo de transferencia: Abono en cuenta
		Mensaje: almuerzo compartido
	`,
		{ subject: "Comprobante de Transferencia a terceros" },
	);

	assert.equal(parsed.amount, 25000);
	assert.equal(parsed.kind, "transfer");
	assert.equal(parsed.direction, "outflow");
	assert.equal(parsed.counterparty, "Persona Ejemplo");
	assert.equal(parsed.status, "detected");
});

test("parses incoming Banco de Chile transfer as inflow", () => {
	const parsed = parseBancoChileEmail(
		`
		Banco de Chile
		Transferencia recibida
		Fecha: 29/04/2026 09:10
		Monto: $1.200.000
		Desde: Empresa Ejemplo SPA
		Mensaje: sueldo abril
	`,
		{ subject: "Transferencia recibida" },
	);

	assert.equal(parsed.amount, 1200000);
	assert.equal(parsed.occurredAt, "2026-04-29T09:10:00");
	assert.equal(parsed.kind, "income");
	assert.equal(parsed.direction, "inflow");
	assert.equal(parsed.counterparty, "Empresa Ejemplo SPA");
	assert.equal(parsed.status, "detected");
});

test("parses outgoing transfer destination name from HTML sections", () => {
	const parsed = parseBancoChileEmail(`
		<td>Comprobante de Transferencia a terceros</td>
		<td>Te informamos que has realizado una Transferencia a terceros en forma exitosa</td>
		<td>Origen</td>
		<td>Tipo de Cuenta</td><td>Cuenta Corriente</td>
		<td>Nº de Cuenta</td><td>00-160-22209-05</td>
		<td>Destino</td>
		<td>Nombre y Apellido</td><td>Claudia Andrea Zúñiga Nilson</td>
		<td>Rut</td><td>16812356-6</td>
		<td>Tipo de Cuenta</td><td>Cuenta Corriente</td>
		<td>Monto</td><td>$470.250</td>
		<p>Fecha y Hora:</p>
		<p>sábado 02 de mayo de 2026 09:53</p>
		<p>Transacción</p>
		<p>TEFMBCO2605020953304705556760</p>
	`);

	assert.equal(parsed.amount, 470250);
	assert.equal(parsed.occurredAt, "2026-05-02T09:53:00");
	assert.equal(parsed.kind, "transfer");
	assert.equal(parsed.direction, "outflow");
	assert.equal(parsed.counterparty, "Claudia Andrea Zúñiga Nilson");
	assert.notEqual(parsed.counterparty, "Tipo de Cuenta");
	assert.notEqual(parsed.counterparty, "Cuenta Corriente");
	assert.equal(parsed.sourceId, "banco-chile:TEFMBCO2605020953304705556760");
	assert.equal(parsed.status, "detected");
});
