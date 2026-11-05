/**
 * Casts that cannot throw. Staging columns are text written by upstream
 * feeds, and every data page awaits the queries that read them, so one row
 * holding "N/A" or "2026-02-30" must read as an absent value — never as a
 * failed query that takes the portal down (audit 5 Nov 2026; the 26 Oct
 * outage was this class of fault).
 *
 * `expr` is always a column or expression from this codebase, never input.
 */

/** A decimal number, or NULL. */
export const sqlNum = (expr: string): string =>
  `(CASE WHEN ${expr} ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' THEN trim(${expr})::float8 END)`;

/** A real calendar date written YYYY-MM-DD, or NULL. 2026-02-30 is NULL. */
export const sqlDate = (expr: string): string =>
  `(CASE WHEN ${expr} ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
      CASE WHEN substr(${expr}, 9, 2)::int <= extract(day from make_date(substr(${expr}, 1, 4)::int, substr(${expr}, 6, 2)::int, 1) + interval '1 month - 1 day')
           THEN (${expr})::date END END)`;

/** Excel serial day number (the curated feed's date format) to a date, or NULL. */
export const sqlExcelDate = (expr: string): string =>
  `(to_timestamp((${sqlNum(expr)} - 25569) * 86400)::date)`;
