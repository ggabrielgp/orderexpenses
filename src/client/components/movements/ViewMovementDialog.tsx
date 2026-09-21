import { useEffect, useRef } from "react";
import { getSpendingChartKindLabel } from "../analytics/spendingChart";
import { syncNativeModalDialog } from "./CreateManualExpenseDialog";
import type {
	EditableRecognizedExpenseMovement,
	RecognizedExpenseMovement,
} from "./manualExpense";

/**
 * Read-only detail for one recognized movement.
 *
 * Legacy opened the same information for any row it could render, editable or not
 * (`public/app.js:1900-1963`). Keeping the read surface complete independently of the mutation
 * surface is the point: a movement without a usable id or a parseable original date still has a date,
 * a counterparty, a kind, a category, an amount, a status and a source worth showing, and hiding all
 * of that behind a missing edit target would be a lie of omission. The actions are therefore additive:
 * Editar and Eliminar appear only when the caller passes the editable record the table already
 * resolved, and the dialog never builds a target of its own.
 *
 * The field projection is a pure function so the exact lines the modal states are provable without a
 * DOM, the same reason the edit and create flows keep their decisions outside the component.
 */

export type MovementDetailField = {
	label: string;
	value: string;
};

const STATUS_LABELS: Record<string, string> = {
	manual: "Manual",
	edited: "Editado",
	detected: "Detectado",
	needs_review: "Requiere revisión",
};

/** Spanish label for a stored status; an unknown value is shown as-is rather than dropped. */
export function getMovementStatusLabel(status: unknown): string | null {
	if (typeof status !== "string" || !status.trim()) return null;
	const key = status.trim();
	return STATUS_LABELS[key] ?? key;
}

/** Local CLP formatting for the read-only amount; the table has its own copy and neither is shared. */
export function formatDetailAmount(amount: number): string {
	const formatted = new Intl.NumberFormat("es-CL", {
		style: "currency",
		currency: "CLP",
		maximumFractionDigits: 0,
	}).format(Math.abs(amount));
	return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * The exact lines the detail modal states, in order. A field the projection does not carry is absent
 * from the list instead of rendered as a placeholder, so the modal can never claim a status or a
 * source the movement does not have.
 */
export function getMovementDetailFields(
	movement: RecognizedExpenseMovement,
): MovementDetailField[] {
	const fields: MovementDetailField[] = [{ label: "Fecha y hora", value: formatMovementMoment(movement) }];
	fields.push({ label: "Comercio o persona", value: movement.counterparty });
	const description =
		typeof movement.description === "string" ? movement.description.trim() : "";
	if (description && description !== movement.counterparty) {
		fields.push({ label: "Descripción", value: description });
	}
	fields.push({ label: "Tipo", value: getSpendingChartKindLabel(movement.kind) });
	fields.push({ label: "Categoría", value: movement.category });
	fields.push({ label: "Monto", value: formatDetailAmount(movement.amount) });
	const statusLabel = getMovementStatusLabel(movement.status);
	if (statusLabel !== null) fields.push({ label: "Estado", value: statusLabel });
	if (typeof movement.source === "string" && movement.source.trim()) {
		fields.push({ label: "Origen", value: movement.source.trim() });
	}
	return fields;
}

/** Date plus the time of day only when the stored value carried one; a date-only row invents no hour. */
function formatMovementMoment(movement: RecognizedExpenseMovement): string {
	const time =
		movement.hasTime && typeof movement.occurredAt === "string"
			? movement.occurredAt.slice(11, 16)
			: "";
	return time ? `${movement.date} ${time}` : movement.date;
}

export interface ViewMovementDialogProps {
	/** The movement whose detail is shown; `null` renders nothing and keeps the dialog closed. */
	movement: RecognizedExpenseMovement | null;
	/** Editable record for this row, or `null`/absent when it has no valid mutation target. */
	editableMovement?: EditableRecognizedExpenseMovement | null;
	/** Dismiss intent. It never sends a request and never re-opens the detail by itself. */
	onClose: () => void;
	/** Opens the existing edit flow for an editable movement. */
	onEdit?: (movement: EditableRecognizedExpenseMovement) => void;
	/** Opens the existing removal flow for an editable movement. */
	onRemove?: (movement: EditableRecognizedExpenseMovement) => void;
}

/**
 * Presentational native `<dialog>` for the read-only detail. It reuses `syncNativeModalDialog`, so it
 * gets the same focus trap, `Esc` handling and inert backdrop as the create, edit and removal dialogs.
 *
 * The editable record is a separate prop on purpose: a row without one renders the same detail with no
 * actions, which is what makes "viewable but not mutable" a property of the markup rather than of a
 * condition this component would have to re-derive.
 */
export function ViewMovementDialog({
	movement,
	editableMovement,
	onClose,
	onEdit,
	onRemove,
}: ViewMovementDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const isOpen = movement !== null;

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	if (!movement) return null;

	const fields = getMovementDetailFields(movement);
	const canEdit = Boolean(editableMovement && onEdit);
	const canRemove = Boolean(editableMovement && onRemove);
	const isEditable = editableMovement !== null && editableMovement !== undefined;

	return (
		<dialog
			ref={dialogRef}
			className="react-view-movement-dialog"
			aria-labelledby="react-view-movement-title"
			onClose={onClose}
		>
			<h2 id="react-view-movement-title">Detalle del movimiento</h2>
			<dl className="react-view-movement-fields">
				{fields.map((field) => (
					<div key={field.label} className="react-view-movement-field">
						<dt>{field.label}</dt>
						<dd>{field.value}</dd>
					</div>
				))}
			</dl>
			{!isEditable && (
				<p className="react-view-movement-read-only">
					Este movimiento no tiene identificación o fecha válida, por lo que solo puede verse.
				</p>
			)}
			<div className="react-shell-actions">
				<button type="button" className="secondary" onClick={onClose}>
					Cerrar
				</button>
				{/* The existing edit and removal dialogs stay the only mutation surfaces: the detail only
				    forwards the editable record the table already resolved. */}
				{canEdit && editableMovement && (
					<button
						type="button"
						className="secondary react-movement-action"
						onClick={() => onEdit?.(editableMovement)}
					>
						Editar
					</button>
				)}
				{canRemove && editableMovement && (
					<button
						type="button"
						className="secondary react-movement-action"
						onClick={() => onRemove?.(editableMovement)}
					>
						Eliminar
					</button>
				)}
			</div>
		</dialog>
	);
}
