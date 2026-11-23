import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { updateFinancialCycle } from "../../api/client";
import type { UpdateFinancialCycleRequest } from "../../api/types";
import { todayInSantiago } from "../analytics/dashboardPace";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { formatIncomeInput } from "../movements/manualExpense";
import { createFinancialCycleSetupPayload } from "../movements/movementSummary";
import { CyclePeriodSummary } from "./CyclePeriodSummary";
import { CyclePresets } from "./CyclePresetsControl";
import { CycleCalendar } from "./FinancialCycleCalendar";
import {
  createCalendarRange,
  getCurrentYearCalendarBounds,
  selectCalendarDate,
  validateCalendarRange,
} from "./cycleCalendar";
import {
  DEFAULT_PAY_DAY,
  resolveCycleOption,
  type CycleOptionChoice,
} from "./cycleOptions";
import { parseCycleIncome } from "./cycleSettings";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";

/** Both rendered pending state and the synchronous submit lock own the dismissal policy. */
export function requestFinancialSetupDismiss(
  lock: { current: boolean },
  isSaving: boolean,
  onDismiss: () => void,
): boolean {
  if (lock.current || isSaving) return false;
  onDismiss();
  return true;
}

export function FinancialCycleSetupForm({ onSaved }: { onSaved: () => void }) {
  // Keep the form mounted while dismissed: reopening retains its draft and validation messages.
  const [isOpen, setIsOpen] = useState(true);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    syncNativeModalDialog(dialogRef.current, isOpen);
  }, [isOpen]);
  // The configured review period for a first setup is the current month: it is the range the form
  // starts on. The calendar's own navigation and selectable bounds are the current year through the
  // current month, so a historical range the default does not cover is still reachable. Both are
  // frozen for the life of the form so a midnight rollover cannot re-anchor either mid-edit.
  const configuredPeriod = useMemo(() => ReviewPeriod.currentMonth().toJSON(), []);
  const calendarBounds = useMemo(() => getCurrentYearCalendarBounds(), []);
  const presetToday = useMemo(() => todayInSantiago(new Date()), []);
  const [startDate, setStartDate] = useState(configuredPeriod.startDate);
  const [endDate, setEndDate] = useState<string>(ReviewPeriod.create(configuredPeriod).visibleEndDate);
  // "¿Cuándo empieza tu período?": the calendar month is the default, so the form is valid without extra
  // input and starts on the same range it always did. The option only decides how the start/end
  // state is filled; validation and the saved payload read that state, as before.
  const [option, setOption] = useState<CycleOptionChoice>("calendar");
  const [payDay, setPayDay] = useState(DEFAULT_PAY_DAY);
  const [incomeValue, setIncomeValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  /** The legacy two-click range: the first click sets the start, the second sets the end. */
  const [awaitingRangeEnd, setAwaitingRangeEnd] = useState(false);
  const calendarRange = { ...createCalendarRange(startDate, endDate), awaitingEnd: awaitingRangeEnd };
  // The date error lives inside the "Otro rango" reveal, which can be scrolled out of view above the
  // sticky footer: bring it next to the field that needs fixing.
  useEffect(() => {
    if (calendarError) {
      dialogRef.current?.querySelector(".react-cycle-calendar-error")?.scrollIntoView({ block: "nearest" });
    }
  }, [calendarError]);
  useEffect(() => {
    if (incomeError) {
      dialogRef.current?.querySelector(".cycle-field-error")?.scrollIntoView({ block: "nearest" });
    }
  }, [incomeError]);

  const handleCalendarSelect = (dateKey: string) => {
    const next = selectCalendarDate(calendarRange, dateKey);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setAwaitingRangeEnd(next.awaitingEnd);
    setCalendarError(null);
  };

  const applyRange = (range: { startDate: string; endDate: string }) => {
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setAwaitingRangeEnd(false);
    setCalendarError(null);
    setError(null);
  };

  const handleOptionChange = (next: CycleOptionChoice) => {
    setOption(next);
    // "Otro rango" keeps the dates already there; the other two put their own range in the state.
    if (next !== "custom") {
      applyRange(resolveCycleOption(next, presetToday, payDay, { startDate, endDate }));
    }
  };

  const handlePayDayChange = (next: number) => {
    setPayDay(next);
    applyRange(resolveCycleOption("payDay", presetToday, next, { startDate, endDate }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current) return;
    setIncomeError(null);
    setError(null);

    // The calendar error is derived here, not rendered on every keystroke: the date half of the
    // validation is stated inline while the income half keeps the form's existing copy.
    const dateValidation = validateCalendarRange(startDate, endDate);
    if (!dateValidation.ok) {
      setCalendarError(dateValidation.message);
      setError("Revisa las fechas del período antes de guardar.");
      return;
    }
    setCalendarError(null);

    let cycle: UpdateFinancialCycleRequest;
    try {
      cycle = createFinancialCycleSetupPayload(startDate, endDate, incomeValue);
    } catch {
      // The dates were just validated, so what is left to fix is the income, shown next to its field.
      setIncomeError("Ingresa un rango de fechas válido y un ingreso en CLP positivo sin decimales, o deja el ingreso en blanco.");
      return;
    }

    saveLock.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await updateFinancialCycle(cycle);
      onSaved();
    } catch {
      saveLock.current = false;
      setError("No se pudo guardar tu período financiero. Inténtalo de nuevo.");
      setIsSaving(false);
    }
  };

  const formatIncomeOnBlur = () => {
    try {
      const incomeAmount = parseCycleIncome(incomeValue);
      if (incomeAmount !== null) setIncomeValue(formatIncomeInput(incomeAmount));
    } catch {
      // Keep the user's value unchanged so it can be corrected.
    }
  };

  return (
    <>
    {!isOpen && (
      <section className="react-financial-state" aria-label="Configuración financiera pendiente">
        <p>Configura tu período para ver el resumen financiero.</p>
        <button type="button" onClick={() => setIsOpen(true)}>Configurar período</button>
      </section>
    )}
    <dialog
      ref={dialogRef}
      className="react-financial-setup-dialog react-financial-state cycle-dialog"
      aria-labelledby="react-financial-setup-title"
      onCancel={(event) => {
        event.preventDefault();
        requestFinancialSetupDismiss(saveLock, isSaving, () => setIsOpen(false));
      }}
      onClose={() => {
        if (!requestFinancialSetupDismiss(saveLock, isSaving, () => setIsOpen(false))) {
          syncNativeModalDialog(dialogRef.current, true);
        }
      }}
    >
      <form className="react-financial-setup-form cycle-form" onSubmit={handleSubmit} aria-busy={isSaving}>
        <div className="cycle-body">
          <div className="cycle-grab" aria-hidden="true" />
          <header>
            <ol className="cycle-steps" aria-label="Pasos para empezar">
              <li className="is-done"><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 1, Conectar, hecho</span></li>
              <li aria-current="step"><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 2, Tu período, paso actual</span></li>
              <li><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 3, Tu medidor</span></li>
            </ol>
            <p className="cycle-kicker">Paso 2 de 3 · Tu período</p>
            <h2 id="react-financial-setup-title" className="cycle-title">¿Cuándo empieza tu período?</h2>
            <p className="cycle-why">Así sabemos cuánto del período pasó y cuánto te queda.</p>
          </header>
          {/* One question, three options; each reveals only what it needs. The date inputs and the
              calendar live in "Otro rango", and every option fills the same start/end state below. */}
          <CyclePresets
            option={option}
            onOptionChange={handleOptionChange}
            payDay={payDay}
            onPayDayChange={handlePayDayChange}
            range={{ startDate, endDate }}
            disabled={isSaving}
            customPane={
              <>
                {/* The calendar augments the text inputs; it never replaces them. It is bounded to the
                    current year through the current month, so any month of the year so far is selectable. */}
                <CycleCalendar
                  bounds={calendarBounds}
                  range={calendarRange}
                  onSelectDate={handleCalendarSelect}
                  disabled={isSaving}
                  error={calendarError}
                />
                <div className="cycle-dates">
                  <label htmlFor="financial-cycle-start-date">
                    <span>Fecha de inicio</span>
                    <input
                      id="financial-cycle-start-date"
                      type="date"
                      value={startDate}
                      onChange={(event) => {
                        setStartDate(event.target.value);
                        setCalendarError(null);
                      }}
                      disabled={isSaving}
                      required
                    />
                  </label>
                  <label htmlFor="financial-cycle-end-date">
                    <span>Fecha de término (inclusive)</span>
                    <input
                      id="financial-cycle-end-date"
                      type="date"
                      value={endDate}
                      onChange={(event) => {
                        setEndDate(event.target.value);
                        setCalendarError(null);
                      }}
                      disabled={isSaving}
                      required
                    />
                  </label>
                </div>
              </>
            }
          />
          <section className="cycle-income">
            <label className="cycle-income-label" htmlFor="financial-cycle-income">
              ¿Cuánto ganas al mes? <span>(opcional)</span>
            </label>
            <div className="cycle-money">
              <span className="cycle-money-unit cycle-money-prefix" aria-hidden="true">$</span>
              <input
                id="financial-cycle-income"
                type="text"
                inputMode="numeric"
                pattern="[0-9.]*"
                autoComplete="off"
                placeholder="Ej: 900.000"
                value={incomeValue}
                onChange={(event) => {
                  setIncomeValue(event.target.value);
                  setIncomeError(null);
                }}
                onBlur={formatIncomeOnBlur}
                disabled={isSaving}
                aria-describedby="financial-cycle-income-help"
                aria-invalid={incomeError !== null}
              />
              <span className="cycle-money-unit cycle-money-suffix" aria-hidden="true">CLP</span>
            </div>
            <p className="cycle-help" id="financial-cycle-income-help">Lo usamos para tu medidor. Puedes agregarlo después.</p>
            {incomeError && <p className="cycle-field-error" role="alert">{incomeError}</p>}
          </section>
        </div>
        <div className="cycle-foot">
          <CyclePeriodSummary startDate={startDate} endDate={endDate} awaitingEnd={awaitingRangeEnd && !endDate} />
          {error && <p className="react-financial-setup-error cycle-foot-error" role="alert">{error}</p>}
          <div className="cycle-actions">
            <button type="button" className="secondary cycle-btn cycle-btn-ghost" disabled={isSaving}
              onClick={() => requestFinancialSetupDismiss(saveLock, isSaving, () => setIsOpen(false))}>
              Cancelar
            </button>
            <button type="submit" className="cycle-btn cycle-btn-primary" disabled={isSaving}>
              {isSaving ? <span className="cycle-spinner" aria-hidden="true" /> : null}
              {isSaving ? "Guardando período financiero..." : "Guardar y ver mi medidor"}
            </button>
          </div>
          <p className="cycle-sr" aria-live="polite">{isSaving ? "Guardando período financiero..." : ""}</p>
        </div>
      </form>
    </dialog>
    </>
  );
}
