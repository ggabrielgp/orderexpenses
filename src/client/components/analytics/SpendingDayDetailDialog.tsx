import { useEffect, type ReactNode, type RefObject } from "react";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";

/** One shared day presentation: inline on desktop, native focus-trapped detail on mobile. */
export function SpendingDayDetailDialog({ dialogRef, isOpen, onClose, children }: {
 dialogRef: RefObject<HTMLDialogElement | null>;
 isOpen: boolean;
 onClose: () => void;
 children: ReactNode;
}) {
 useEffect(() => {
  const dialog = dialogRef.current;
  syncNativeModalDialog(dialog, isOpen);
  return () => syncNativeModalDialog(dialog, false);
 }, [dialogRef, isOpen]);
 const close = () => {
  syncNativeModalDialog(dialogRef.current, false);
  onClose();
 };
 return (
  <dialog
   ref={dialogRef}
   className="react-spending-day-dialog"
   aria-label="Detalle de gastos del día"
   onCancel={(event) => { event.preventDefault(); close(); }}
   onClose={() => { if (!dialogRef.current?.open) onClose(); }}
  >
   <div className="react-spending-day-dialog-actions">
    <button type="button" className="secondary" onClick={close} autoFocus>Cerrar</button>
   </div>
   {children}
  </dialog>
 );
}
