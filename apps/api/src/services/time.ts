import { Temporal } from "@js-temporal/polyfill";

/**
 * Timestamp storage remains UTC. These helpers are the narrow boundary where a
 * user's IANA time zone is used to turn a local planning date/time into an
 * instant (or to render an instant back to a local wall time).
 */
export class LocalTimeResolutionError extends Error {}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function canonicalTimeZone(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: value,
  }).resolvedOptions().timeZone;
}

export function isValidCalendarDate(value: string): boolean {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalDateTime(value: string): boolean {
  try {
    Temporal.PlainDateTime.from(value);
    return true;
  } catch {
    return false;
  }
}

export function utcFromLocalDateTime(
  localDateTime: string,
  timeZone: string,
): string {
  try {
    const local = Temporal.PlainDateTime.from(localDateTime);
    return Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: local.year,
        month: local.month,
        day: local.day,
        hour: local.hour,
        minute: local.minute,
        second: local.second,
        millisecond: local.millisecond,
      },
      // Do not silently move a commitment across a daylight-saving gap or
      // choose one of two repeated wall times without the user's knowledge.
      { disambiguation: "reject" },
    )
      .toInstant()
      .toString();
  } catch {
    throw new LocalTimeResolutionError(
      "That local time is unavailable or ambiguous in the selected time zone. Choose another time around the daylight-saving transition.",
    );
  }
}

export function localDateTimeFromUtc(
  instant: string,
  timeZone: string,
): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

export function localDateFromUtc(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

export function nextCalendarDate(date: string): string {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}
