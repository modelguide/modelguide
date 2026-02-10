/**
 * Pure scoring computation helpers.
 * Extracted from analytics.service for testability.
 */

export interface SessionMetricsRow {
  total: number;
  active: number;
  completed: number;
  abandoned: number;
  avgDuration: number | null;
}

export interface FeedbackMetricsRow {
  csatScore: number | null;
  supportScore: number | null;
  customerCount: number;
  supportCount: number;
}

export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Compute a rate, returning 0 when total is 0 to avoid division by zero. */
export function computeRate(
  count: number,
  total: number,
  decimals = 4,
): number {
  return total > 0 ? roundTo(count / total, decimals) : 0;
}

/**
 * Normalise a score from the database.
 * DB returns null when there are no matching rows (via NULLIF),
 * but also returns 0.0 when all feedback is negative.
 * We coerce truthy values to a rounded number and null/0 to null.
 *
 * NOTE: This means a genuine 0% score (all negative) is returned as null,
 * which is the current production behaviour.
 */
export function normaliseScore(
  raw: number | null,
  decimals = 4,
): number | null {
  return raw ? roundTo(Number(raw), decimals) : null;
}

export interface RawTrendRow {
  date: unknown;
  value: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

/** Format raw DB trend rows into API-ready trend points. */
export function formatTrendRows(
  rows: RawTrendRow[],
  precision: number,
): TrendPoint[] {
  return rows.map((r) => ({
    date: new Date(r.date as string).toISOString(),
    value:
      precision > 0 ? roundTo(Number(r.value), precision) : Number(r.value),
  }));
}

/** Build the full scoring portion of a summary result from raw DB rows. */
export function computeSummaryScores(
  sessionRow: SessionMetricsRow,
  feedbackRow: FeedbackMetricsRow,
) {
  const total = sessionRow.total;

  return {
    resolution_rate: computeRate(sessionRow.completed, total),
    abandonment_rate: computeRate(sessionRow.abandoned, total),
    avg_duration_seconds: sessionRow.avgDuration
      ? roundTo(Number(sessionRow.avgDuration), 2)
      : null,
    csat_score: normaliseScore(feedbackRow.csatScore),
    support_evaluation_score: normaliseScore(feedbackRow.supportScore),
    feedback_count: {
      customer: feedbackRow.customerCount,
      support: feedbackRow.supportCount,
    },
  };
}
