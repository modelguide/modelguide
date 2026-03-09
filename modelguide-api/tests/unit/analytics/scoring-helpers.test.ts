/**
 * Unit tests for scoring computation helpers.
 * Tests pure functions without any database dependency.
 */

import { describe, expect, test } from "bun:test";
import {
  computeRate,
  computeSummaryScores,
  formatTrendRows,
  normaliseScore,
  roundTo,
} from "@features/analytics/scoring.helpers";

// ============================================================================
// roundTo
// ============================================================================

describe("roundTo", () => {
  test("rounds to 0 decimal places", () => {
    expect(roundTo(3.7, 0)).toBe(4);
    expect(roundTo(3.2, 0)).toBe(3);
  });

  test("rounds to 2 decimal places", () => {
    expect(roundTo(1.005, 2)).toBe(1);
    // 1.555 in IEEE 754 is 1.55499..., so toFixed(2) rounds down
    expect(roundTo(1.555, 2)).toBe(1.55);
    expect(roundTo(1.556, 2)).toBe(1.56);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  test("rounds to 4 decimal places", () => {
    expect(roundTo(0.33333, 4)).toBe(0.3333);
    expect(roundTo(0.66667, 4)).toBe(0.6667);
    expect(roundTo(1 / 3, 4)).toBe(0.3333);
  });

  test("handles whole numbers", () => {
    expect(roundTo(5, 2)).toBe(5);
    expect(roundTo(0, 4)).toBe(0);
  });

  test("handles negative numbers", () => {
    // Same IEEE 754 behaviour: -1.555 is -1.55499...
    expect(roundTo(-1.555, 2)).toBe(-1.55);
    expect(roundTo(-1.556, 2)).toBe(-1.56);
    expect(roundTo(-0.5, 0)).toBe(-1);
  });

  test("preserves exact values that fit within precision", () => {
    expect(roundTo(0.75, 4)).toBe(0.75);
    expect(roundTo(0.5, 2)).toBe(0.5);
    expect(roundTo(1, 4)).toBe(1);
  });
});

// ============================================================================
// computeRate
// ============================================================================

describe("computeRate", () => {
  test("computes ratio when total > 0", () => {
    expect(computeRate(3, 6)).toBe(0.5);
    expect(computeRate(1, 3)).toBe(0.3333);
    expect(computeRate(2, 3)).toBe(0.6667);
  });

  test("returns 0 when total is 0 (no division by zero)", () => {
    expect(computeRate(0, 0)).toBe(0);
    expect(computeRate(5, 0)).toBe(0);
  });

  test("returns 1 when count equals total", () => {
    expect(computeRate(10, 10)).toBe(1);
    expect(computeRate(1, 1)).toBe(1);
  });

  test("returns 0 when count is 0 and total > 0", () => {
    expect(computeRate(0, 10)).toBe(0);
  });

  test("respects custom decimal precision", () => {
    expect(computeRate(1, 3, 2)).toBe(0.33);
    expect(computeRate(2, 3, 2)).toBe(0.67);
    expect(computeRate(1, 7, 6)).toBe(0.142857);
  });

  test("defaults to 4 decimal places", () => {
    const result = computeRate(1, 6);
    const decimalStr = result.toString().split(".")[1] || "";
    expect(decimalStr.length).toBeLessThanOrEqual(4);
  });
});

// ============================================================================
// normaliseScore
// ============================================================================

describe("normaliseScore", () => {
  test("rounds and returns positive scores", () => {
    expect(normaliseScore(0.75)).toBe(0.75);
    expect(normaliseScore(0.66667)).toBe(0.6667);
    expect(normaliseScore(1.0)).toBe(1);
  });

  test("returns null for null input (no feedback)", () => {
    expect(normaliseScore(null)).toBeNull();
  });

  test("returns 0 for 0 score (all negative feedback)", () => {
    // A genuine 0% score is distinguishable from "no data" (null)
    expect(normaliseScore(0)).toBe(0);
    expect(normaliseScore(0.0)).toBe(0);
  });

  test("respects custom decimal precision", () => {
    expect(normaliseScore(0.66667, 2)).toBe(0.67);
    expect(normaliseScore(0.33333, 6)).toBe(0.33333);
  });

  test("handles very small positive scores (not zero)", () => {
    // A tiny positive score like 0.0001 should not be null
    expect(normaliseScore(0.0001)).toBe(0.0001);
    // The truthiness check is on the raw value, not the rounded result.
    // 0.00001 is truthy, so it passes through roundTo → 0
    expect(normaliseScore(0.00001, 4)).toBe(0);
    // With enough precision, the fractional part is preserved:
    expect(normaliseScore(0.00001, 5)).toBe(0.00001);
  });
});

// ============================================================================
// formatTrendRows
// ============================================================================

describe("formatTrendRows", () => {
  test("formats date strings to ISO format", () => {
    const rows = [{ date: "2024-06-15T00:00:00.000Z", value: 5 }];
    const result = formatTrendRows(rows, 0);

    expect(result).toEqual([{ date: "2024-06-15T00:00:00.000Z", value: 5 }]);
  });

  test("rounds values to specified precision", () => {
    const rows = [
      { date: "2024-06-15", value: 0.66667 },
      { date: "2024-06-16", value: 0.33333 },
    ];

    const result4 = formatTrendRows(rows, 4);
    expect(result4[0].value).toBe(0.6667);
    expect(result4[1].value).toBe(0.3333);

    const result2 = formatTrendRows(rows, 2);
    expect(result2[0].value).toBe(0.67);
    expect(result2[1].value).toBe(0.33);
  });

  test("with precision=0, passes through numeric values without rounding", () => {
    // precision=0 branch uses Number(r.value) directly — designed for
    // integer counts from SQL where rounding is unnecessary
    const rows = [
      { date: "2024-06-15", value: 42 },
      { date: "2024-06-16", value: 7 },
    ];
    const result = formatTrendRows(rows, 0);

    expect(result[0].value).toBe(42);
    expect(result[1].value).toBe(7);
  });

  test("handles empty rows array", () => {
    expect(formatTrendRows([], 4)).toEqual([]);
  });

  test("coerces string values from DB to number", () => {
    // DB sometimes returns numeric strings
    const rows = [{ date: "2024-06-15", value: "0.75" as unknown as number }];
    const result = formatTrendRows(rows, 4);

    expect(result[0].value).toBe(0.75);
    expect(typeof result[0].value).toBe("number");
  });

  test("preserves ordering of rows", () => {
    const rows = [
      { date: "2024-06-15", value: 1 },
      { date: "2024-06-16", value: 2 },
      { date: "2024-06-17", value: 3 },
    ];
    const result = formatTrendRows(rows, 0);

    expect(result.map((r) => r.value)).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// computeSummaryScores
// ============================================================================

describe("computeSummaryScores", () => {
  const baseSessionRow = {
    total: 10,
    active: 2,
    completed: 7,
    abandoned: 1,
    avgDuration: 1800,
  };

  const baseFeedbackRow = {
    csatScore: 0.75,
    supportScore: 0.5,
    customerCount: 8,
    supportCount: 4,
  };

  test("computes all rates correctly", () => {
    const result = computeSummaryScores(baseSessionRow, baseFeedbackRow);

    expect(result.resolution_rate).toBe(0.7);
    expect(result.abandonment_rate).toBe(0.1);
  });

  test("computes avg_duration_seconds from raw duration", () => {
    const result = computeSummaryScores(baseSessionRow, baseFeedbackRow);

    expect(result.avg_duration_seconds).toBe(1800);
  });

  test("returns null avg_duration when raw is null", () => {
    const result = computeSummaryScores(
      { ...baseSessionRow, avgDuration: null },
      baseFeedbackRow,
    );

    expect(result.avg_duration_seconds).toBeNull();
  });

  test("passes through CSAT and support scores via normaliseScore", () => {
    const result = computeSummaryScores(baseSessionRow, baseFeedbackRow);

    expect(result.csat_score).toBe(0.75);
    expect(result.support_evaluation_score).toBe(0.5);
  });

  test("returns null scores when feedback is null", () => {
    const result = computeSummaryScores(baseSessionRow, {
      csatScore: null,
      supportScore: null,
      customerCount: 0,
      supportCount: 0,
    });

    expect(result.csat_score).toBeNull();
    expect(result.support_evaluation_score).toBeNull();
  });

  test("returns feedback counts", () => {
    const result = computeSummaryScores(baseSessionRow, baseFeedbackRow);

    expect(result.feedback_count).toEqual({ customer: 8, support: 4 });
  });

  test("handles zero total sessions (no division by zero)", () => {
    const result = computeSummaryScores(
      {
        total: 0,
        active: 0,
        completed: 0,
        abandoned: 0,
        avgDuration: null,
      },
      {
        csatScore: null,
        supportScore: null,
        customerCount: 0,
        supportCount: 0,
      },
    );

    expect(result.resolution_rate).toBe(0);
    expect(result.abandonment_rate).toBe(0);
    expect(result.avg_duration_seconds).toBeNull();
    expect(result.csat_score).toBeNull();
    expect(result.support_evaluation_score).toBeNull();
    expect(result.feedback_count).toEqual({ customer: 0, support: 0 });
  });

  test("rounds avgDuration to 2 decimal places", () => {
    const result = computeSummaryScores(
      { ...baseSessionRow, avgDuration: 1234.5678 },
      baseFeedbackRow,
    );

    expect(result.avg_duration_seconds).toBe(1234.57);
  });

  test("handles 100% resolution rate", () => {
    const result = computeSummaryScores(
      {
        ...baseSessionRow,
        total: 5,
        completed: 5,
        abandoned: 0,
        active: 0,
      },
      baseFeedbackRow,
    );

    expect(result.resolution_rate).toBe(1);
    expect(result.abandonment_rate).toBe(0);
  });

  test("rates are independent of feedback", () => {
    const noFeedback = {
      csatScore: null,
      supportScore: null,
      customerCount: 0,
      supportCount: 0,
    };
    const withFeedback = baseFeedbackRow;

    const resultA = computeSummaryScores(baseSessionRow, noFeedback);
    const resultB = computeSummaryScores(baseSessionRow, withFeedback);

    expect(resultA.resolution_rate).toBe(resultB.resolution_rate);
    expect(resultA.abandonment_rate).toBe(resultB.abandonment_rate);
  });

  test("handles DB returning string for avgDuration", () => {
    // Postgres sometimes returns numeric as string
    const result = computeSummaryScores(
      { ...baseSessionRow, avgDuration: "1800.123" as unknown as number },
      baseFeedbackRow,
    );

    expect(result.avg_duration_seconds).toBe(1800.12);
  });

  test("handles DB returning string for csatScore", () => {
    const result = computeSummaryScores(baseSessionRow, {
      ...baseFeedbackRow,
      csatScore: "0.6667" as unknown as number,
    });

    expect(result.csat_score).toBe(0.6667);
  });
});
