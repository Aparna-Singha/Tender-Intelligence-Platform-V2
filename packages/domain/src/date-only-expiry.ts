/** PostgreSQL date-only values are represented by a UTC-midnight Date. */
export function dateOnlyExpiryInstant(expiry: Date): Date {
  return new Date(
    Date.UTC(
      expiry.getUTCFullYear(),
      expiry.getUTCMonth(),
      expiry.getUTCDate() + 1,
    ) -
      330 * 60_000,
  );
}

/** India business policy: valid until midnight after the stated calendar date. */
export function isDateOnlyExpired(expiry: Date, checkedAt: Date): boolean {
  return checkedAt >= dateOnlyExpiryInstant(expiry);
}
