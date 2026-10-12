import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Clock3,
  Edit3,
  Globe2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, todayKey } from "@/lib/format";
import type { CalendarEvent, UserPreferences } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";

interface EventDraft {
  title: string;
  startLocal: string;
  endLocal: string;
  isFixed: boolean;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function timePart(localDateTime: string): string {
  return localDateTime.split("T")[1] ?? "";
}

function draftForDate(date: string): EventDraft {
  return {
    title: "",
    startLocal: `${date}T09:00`,
    endLocal: `${date}T10:00`,
    isFixed: true,
  };
}

function eventTimeLabel(event: CalendarEvent): string {
  const startDate = event.startLocal.slice(0, 10);
  const endDate = event.endLocal.slice(0, 10);
  const start = `${formatDate(startDate)} · ${timePart(event.startLocal)}`;
  return startDate === endDate
    ? `${start}–${timePart(event.endLocal)}`
    : `${start} → ${formatDate(endDate)} · ${timePart(event.endLocal)}`;
}

function supportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const zones = intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [];
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([browserZone, "UTC", "Africa/Nairobi", ...zones])].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const [rangeStart, setRangeStart] = useState(() => todayKey());
  const [rangeEnd, setRangeEnd] = useState(() => addDays(todayKey(), 13));
  const [preferenceDraft, setPreferenceDraft] =
    useState<UserPreferences | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft>(() =>
    draftForDate(todayKey()),
  );
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timeZones = useMemo(supportedTimeZones, []);

  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: api.getPreferences,
  });
  const eventsQuery = useQuery({
    queryKey: ["calendar-events", rangeStart, rangeEnd],
    queryFn: () =>
      api.getCalendarEvents({ startDate: rangeStart, endDate: rangeEnd }),
    enabled: Boolean(rangeStart && rangeEnd && rangeEnd >= rangeStart),
  });

  useEffect(() => {
    if (!preferencesQuery.data) return;
    setPreferenceDraft(preferencesQuery.data);
    const localToday = todayKey(preferencesQuery.data.timezone);
    setRangeStart(localToday);
    setRangeEnd(addDays(localToday, 13));
    setEventDraft((current) =>
      editingEventId ? current : draftForDate(localToday),
    );
  }, [preferencesQuery.data, editingEventId]);

  useEffect(() => {
    if (editingEventId || !rangeStart) return;
    setEventDraft((current) => ({
      ...current,
      startLocal: `${rangeStart}T${timePart(current.startLocal) || "09:00"}`,
      endLocal: `${rangeStart}T${timePart(current.endLocal) || "10:00"}`,
    }));
  }, [editingEventId, rangeStart]);

  const updatePreferences = useMutation({
    mutationFn: (input: UserPreferences) => api.updatePreferences(input),
    onSuccess: async (preferences) => {
      setPreferenceDraft(preferences);
      setMessage(
        "Planning preferences saved. New plans will use this schedule.",
      );
      const localToday = todayKey(preferences.timezone);
      setRangeStart(localToday);
      setRangeEnd(addDays(localToday, 13));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["preferences"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  const saveEvent = useMutation({
    mutationFn: (input: EventDraft) =>
      editingEventId
        ? api.updateCalendarEvent(editingEventId, input)
        : api.createCalendarEvent(input),
    onSuccess: async () => {
      setMessage(
        editingEventId
          ? "Commitment updated. Regenerate a draft if its capacity changed."
          : "Commitment saved. Fixed time is now protected in future plan drafts.",
      );
      setEditingEventId(null);
      setEventDraft(draftForDate(rangeStart));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  const deleteEvent = useMutation({
    mutationFn: api.deleteCalendarEvent,
    onSuccess: async () => {
      setMessage("Commitment removed. No historical plan was erased.");
      if (editingEventId) {
        setEditingEventId(null);
        setEventDraft(draftForDate(rangeStart));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  function submitPreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (preferenceDraft) updatePreferences.mutate(preferenceDraft);
  }

  function submitEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    saveEvent.mutate(eventDraft);
  }

  function beginEdit(event: CalendarEvent) {
    setEditingEventId(event.id);
    setEventDraft({
      title: event.title,
      startLocal: event.startLocal,
      endLocal: event.endLocal,
      isFixed: event.isFixed,
    });
    setMessage(null);
  }

  function cancelEdit() {
    setEditingEventId(null);
    setEventDraft(draftForDate(rangeStart));
  }

  const error =
    updatePreferences.error ?? saveEvent.error ?? deleteEvent.error ?? null;
  const isSavingPreferences = updatePreferences.isPending;
  const isSavingEvent = saveEvent.isPending;
  const preferencesDirty = Boolean(
    preferencesQuery.data &&
    Object.entries(preferenceDraft ?? {}).some(
      ([key, value]) =>
        preferencesQuery.data?.[key as keyof UserPreferences] !== value,
    ),
  );

  if (preferencesQuery.isPending) {
    return <LoadingState label="Loading your planning preferences…" />;
  }
  if (preferencesQuery.isError || !preferenceDraft) {
    return (
      <ErrorState
        message={
          preferencesQuery.error?.message ?? "Preferences are unavailable."
        }
        onRetry={() => preferencesQuery.refetch()}
      />
    );
  }

  return (
    <div className="schedule-page page-stack">
      <section className="schedule-hero">
        <div>
          <span className="eyebrow">SCHEDULE & CAPACITY</span>
          <h1>
            Protect the time
            <br />
            <span>real life already owns.</span>
          </h1>
          <p>
            Set the working hours that are true for you, then add fixed
            commitments. FocusAI subtracts only the time you explicitly reserve.
          </p>
        </div>
        <div className="schedule-hero-orbit" aria-hidden="true">
          <CalendarClock size={28} />
          <i />
          <i />
        </div>
      </section>

      {message && (
        <div className="inline-notice success-notice" role="status">
          <Check size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="inline-notice error-notice" role="alert">
          <AlertCircle size={16} /> {error.message}
        </div>
      )}

      <section className="schedule-layout">
        <article className="panel preference-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PLANNING PREFERENCES</span>
              <h2>Your available day</h2>
            </div>
            <Globe2 size={20} className="violet-icon" />
          </div>
          <form className="preference-form" onSubmit={submitPreferences}>
            <label className="field-wide">
              <span>Time zone</span>
              <input
                list="focusai-timezones"
                value={preferenceDraft.timezone}
                onChange={(event) =>
                  setPreferenceDraft((current) =>
                    current
                      ? { ...current, timezone: event.target.value }
                      : current,
                  )
                }
                placeholder="Africa/Nairobi"
                required
              />
              <datalist id="focusai-timezones">
                {timeZones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <small>Use an IANA zone, such as Africa/Nairobi or UTC.</small>
            </label>
            <label>
              <span>Workday starts</span>
              <input
                type="time"
                value={preferenceDraft.workingDayStart}
                onChange={(event) =>
                  setPreferenceDraft((current) =>
                    current
                      ? { ...current, workingDayStart: event.target.value }
                      : current,
                  )
                }
                required
              />
            </label>
            <label>
              <span>Workday ends</span>
              <input
                type="time"
                value={preferenceDraft.workingDayEnd}
                onChange={(event) =>
                  setPreferenceDraft((current) =>
                    current
                      ? { ...current, workingDayEnd: event.target.value }
                      : current,
                  )
                }
                required
              />
            </label>
            <label>
              <span>Transition buffer</span>
              <div className="number-input-row">
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="1"
                  value={preferenceDraft.transitionMinutes}
                  onChange={(event) =>
                    setPreferenceDraft((current) =>
                      current
                        ? {
                            ...current,
                            transitionMinutes: Number(event.target.value),
                          }
                        : current,
                    )
                  }
                  required
                />
                <span>minutes</span>
              </div>
            </label>
            <label>
              <span>Recovery high-load cap</span>
              <div className="number-input-row">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={preferenceDraft.highCognitiveRecoveryCap}
                  onChange={(event) =>
                    setPreferenceDraft((current) =>
                      current
                        ? {
                            ...current,
                            highCognitiveRecoveryCap: Number(
                              event.target.value,
                            ),
                          }
                        : current,
                    )
                  }
                  required
                />
                <span>
                  {Math.round(preferenceDraft.highCognitiveRecoveryCap * 100)}%
                </span>
              </div>
            </label>
            <p className="preference-note field-wide">
              <ShieldCheck size={15} /> Existing commitments keep their actual
              moment; a zone change changes their local display and future
              working-hour calculations.
            </p>
            <button
              className="button button-primary preference-save"
              type="submit"
              disabled={isSavingPreferences}
            >
              <Save size={16} />
              {isSavingPreferences ? "Saving preferences…" : "Save preferences"}
            </button>
          </form>
        </article>

        <article className="panel commitment-form-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {editingEventId ? "EDIT COMMITMENT" : "NEW COMMITMENT"}
              </span>
              <h2>
                {editingEventId
                  ? "Change a commitment"
                  : "Reserve real-world time"}
              </h2>
            </div>
            <Clock3 size={20} className="cyan-icon" />
          </div>
          <form className="commitment-form" onSubmit={submitEvent}>
            <label className="field-wide">
              <span>What is this time for?</span>
              <input
                value={eventDraft.title}
                onChange={(event) =>
                  setEventDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Team check-in, commute, appointment…"
                maxLength={200}
                required
              />
            </label>
            <label>
              <span>Starts in {preferenceDraft.timezone}</span>
              <input
                type="datetime-local"
                value={eventDraft.startLocal}
                onChange={(event) =>
                  setEventDraft((current) => ({
                    ...current,
                    startLocal: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              <span>Ends in {preferenceDraft.timezone}</span>
              <input
                type="datetime-local"
                value={eventDraft.endLocal}
                onChange={(event) =>
                  setEventDraft((current) => ({
                    ...current,
                    endLocal: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="fixed-toggle field-wide">
              <input
                type="checkbox"
                checked={eventDraft.isFixed}
                onChange={(event) =>
                  setEventDraft((current) => ({
                    ...current,
                    isFixed: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>Protect this time in plans</strong>
                <small>
                  Fixed commitments are subtracted from available capacity.
                </small>
              </span>
            </label>
            {preferencesDirty && (
              <p
                className="commitment-preference-warning field-wide"
                role="status"
              >
                Save your time-zone or working-hour changes before saving a
                commitment, so its local time stays unambiguous.
              </p>
            )}
            <div className="commitment-form-actions field-wide">
              <button
                className="button button-primary"
                type="submit"
                disabled={isSavingEvent || preferencesDirty}
              >
                {editingEventId ? <Save size={16} /> : <Plus size={16} />}
                {isSavingEvent
                  ? "Saving commitment…"
                  : editingEventId
                    ? "Save commitment"
                    : "Add commitment"}
              </button>
              {editingEventId && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSavingEvent}
                >
                  <X size={16} /> Cancel edit
                </button>
              )}
            </div>
          </form>
        </article>
      </section>

      <section className="panel schedule-list-card">
        <header className="schedule-list-header">
          <div>
            <span className="eyebrow">COMMITMENT VIEW</span>
            <h2>Time you have made explicit</h2>
          </div>
          <div className="commitment-range" aria-label="Commitment date range">
            <label>
              <span>From</span>
              <input
                type="date"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                min={rangeStart}
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
              />
            </label>
          </div>
        </header>
        <p className="schedule-list-disclosure">
          Showing local times in <strong>{preferenceDraft.timezone}</strong>.
          Fixed items affect only future draft generation; approved plans and
          history stay intact.
        </p>
        {eventsQuery.isPending ? (
          <LoadingState label="Loading commitments…" />
        ) : eventsQuery.isError ? (
          <ErrorState
            message={eventsQuery.error.message}
            onRetry={() => eventsQuery.refetch()}
          />
        ) : eventsQuery.data?.items.length ? (
          <ol className="commitment-list">
            {eventsQuery.data.items.map((event) => (
              <li key={event.id} className="commitment-item">
                <span
                  className={`commitment-kind ${event.isFixed ? "fixed" : "flexible"}`}
                >
                  {event.isFixed ? "Protected" : "Flexible"}
                </span>
                <div className="commitment-main">
                  <h3>{event.title}</h3>
                  <p>{eventTimeLabel(event)}</p>
                </div>
                <div className="commitment-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title={`Edit ${event.title}`}
                    aria-label={`Edit ${event.title}`}
                    onClick={() => beginEdit(event)}
                    disabled={preferencesDirty}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    className="icon-button destructive"
                    type="button"
                    title={`Delete ${event.title}`}
                    aria-label={`Delete ${event.title}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove “${event.title}” from future plan calculations?`,
                        )
                      ) {
                        deleteEvent.mutate(event.id);
                      }
                    }}
                    disabled={deleteEvent.isPending || preferencesDirty}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            eyebrow="NO COMMITMENTS IN THIS RANGE"
            title="Your plan will not invent unavailable time."
            body="Add only the obligations you want the planner to protect. Flexible items remain visible without reducing capacity."
            action={
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  setEditingEventId(null);
                  setEventDraft(draftForDate(rangeStart));
                  document
                    .querySelector<HTMLInputElement>(
                      ".commitment-form input[type='text']",
                    )
                    ?.focus();
                }}
              >
                <Plus size={16} /> Add first commitment
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}
