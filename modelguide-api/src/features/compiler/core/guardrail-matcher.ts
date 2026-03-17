/**
 * Guardrail matcher — keyword overlap heuristic.
 *
 * Determines which guardrails apply to each SOP step's scopedPrompt:
 * - Critical: always match all steps
 * - High: match by keyword overlap (>= 2 tokens with prefix matching)
 * - Medium/Low: never match steps (system prompt only)
 *
 * Intentionally naive for Phase 1 POC. Upgrade path: semantic matching
 * via embeddings when keyword heuristic proves insufficient.
 */

import type { SopStep } from "@features/sops/sops.types";
import type { ParsedGuardrail } from "./types";

// ============================================================================
// Stopwords — common English words that add noise to keyword matching
// ============================================================================

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "can",
  "could",
  "must",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "and",
  "or",
  "but",
  "not",
  "no",
  "if",
  "then",
  "else",
  "when",
  "that",
  "this",
  "it",
  "its",
  "they",
  "their",
  "them",
  "we",
  "our",
  "you",
  "your",
  "i",
  "my",
  "me",
  "he",
  "she",
  "her",
  "his",
  "as",
  "all",
  "any",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "just",
  "about",
  "after",
  "also",
  "back",
  "because",
  "before",
  "between",
  "come",
  "down",
  "even",
  "get",
  "give",
  "go",
  "here",
  "how",
  "into",
  "know",
  "like",
  "look",
  "make",
  "new",
  "now",
  "only",
  "out",
  "over",
  "say",
  "still",
  "take",
  "tell",
  "there",
  "these",
  "thing",
  "think",
  "those",
  "through",
  "under",
  "upon",
  "use",
  "want",
  "way",
  "what",
  "where",
  "which",
  "while",
  "who",
  "why",
  "work",
]);

/**
 * Domain-common words that appear across many SOP steps and guardrails
 * but don't carry matching signal. Filtered during guardrail matching
 * to reduce false positives.
 */
const DOMAIN_STOPWORDS = new Set([
  "customer",
  "delivery",
  "email",
  "order",
  "inform",
]);

/**
 * Minimum prefix length for fuzzy token matching.
 * Set to 5 to avoid false positives like "extreme" ↔ "extract" (share "extr").
 */
const MIN_PREFIX_LENGTH = 5;

/** Minimum number of overlapping token pairs for a high-priority match. */
const MIN_OVERLAP_THRESHOLD = 2;

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Tokenize text into unique lowercase keywords.
 * Splits on non-alphanumeric chars, removes stopwords and short tokens.
 */
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  return [...new Set(tokens)];
}

/**
 * Filter domain-common words from tokens for guardrail matching.
 * These words appear too frequently across SOP contexts to be useful
 * as matching signals.
 */
function filterDomainStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !DOMAIN_STOPWORDS.has(t));
}

// ============================================================================
// Token overlap
// ============================================================================

/**
 * Check if two tokens match via shared prefix (min 5 chars).
 * Handles stemming-like matches: "escalate" ↔ "escalation", "promise" ↔ "promises".
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < MIN_PREFIX_LENGTH) return false;
  for (let i = 0; i < MIN_PREFIX_LENGTH; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Count unique overlapping token pairs between two token lists.
 */
export function countOverlap(
  guardrailTokens: string[],
  stepTokens: string[],
): number {
  let count = 0;
  const matched = new Set<number>();

  for (const gt of guardrailTokens) {
    for (let i = 0; i < stepTokens.length; i++) {
      if (!matched.has(i) && tokensMatch(gt, stepTokens[i])) {
        count++;
        matched.add(i);
        break;
      }
    }
  }

  return count;
}

// ============================================================================
// Matcher
// ============================================================================

/**
 * Match guardrails to a specific SOP step.
 *
 * Returns the guardrails that should appear in the step's scopedPrompt:
 * - All critical-priority guardrails (always)
 * - High-priority guardrails with >= 2 keyword overlap tokens
 * - Medium/low are excluded (system prompt only)
 */
export function matchGuardrails(
  step: SopStep,
  guardrails: ParsedGuardrail[],
): ParsedGuardrail[] {
  const matched: ParsedGuardrail[] = [];
  const stepTokens = filterDomainStopwords(tokenize(step.instruction));

  for (const guardrail of guardrails) {
    const { priority } = guardrail.config;

    if (priority === "critical") {
      matched.push(guardrail);
      continue;
    }

    if (priority === "high") {
      const guardrailTokens = filterDomainStopwords(
        tokenize(guardrail.content),
      );
      const overlap = countOverlap(guardrailTokens, stepTokens);
      if (overlap >= MIN_OVERLAP_THRESHOLD) {
        matched.push(guardrail);
      }
    }

    // medium / low — system prompt only, skip
  }

  return matched;
}
