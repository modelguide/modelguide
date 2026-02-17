#!/usr/bin/env python3
"""CLI for analyzing ModelGuide eval experiment results."""

import argparse
import json
import os
import sys
from pathlib import Path


def find_results_dir(experiment_name: str) -> Path:
    """Find the most recent results directory for an experiment."""
    results_base = Path(__file__).parent.parent / "results"
    if not results_base.exists():
        print(f"Results directory not found: {results_base}", file=sys.stderr)
        sys.exit(1)

    matching = sorted(
        [d for d in results_base.iterdir() if d.is_dir() and experiment_name in d.name],
        reverse=True,
    )

    if not matching:
        print(f"No results found for experiment: {experiment_name}", file=sys.stderr)
        sys.exit(1)

    return matching[0]


def load_summary(results_dir: Path) -> dict:
    """Load summary.json from results directory."""
    summary_path = results_dir / "summary.json"
    if not summary_path.exists():
        print(f"summary.json not found in {results_dir}", file=sys.stderr)
        sys.exit(1)

    with open(summary_path) as f:
        return json.load(f)


def print_summary(summary: dict) -> None:
    """Print a formatted summary of experiment results."""
    print(f"\n{'='*60}")
    print(f"Experiment: {summary['experiment']}")
    print(f"Description: {summary.get('description', 'N/A')}")
    print(f"Period: {summary['startedAt']} -> {summary['endedAt']}")
    print(f"{'='*60}\n")

    for config_name, config_data in summary["configs"].items():
        print(f"--- {config_name} ---")
        metrics = config_data.get("aggregateMetrics", {})
        for metric, value in metrics.items():
            if isinstance(value, float):
                if 0 < value < 1:
                    print(f"  {metric}: {value*100:.1f}%")
                else:
                    print(f"  {metric}: {value:.3f}")
            else:
                print(f"  {metric}: {value}")
        print()

    if "verifier_delta" in summary and summary["verifier_delta"]:
        print("--- Verifier Delta (B - A) ---")
        for metric, value in summary["verifier_delta"].items():
            sign = "+" if value >= 0 else ""
            if abs(value) < 1:
                print(f"  {metric}: {sign}{value*100:.1f}pp")
            else:
                print(f"  {metric}: {sign}{value:.3f}")
        print()


def analyze_verifier_log(results_dir: Path) -> None:
    """Analyze verifier log entries."""
    log_path = results_dir / "verifier-log.json"
    if not log_path.exists():
        print("No verifier log found.")
        return

    with open(log_path) as f:
        logs = json.load(f)

    if not logs:
        print("Verifier log is empty.")
        return

    print(f"\n--- Verifier Log Analysis ({len(logs)} entries) ---")

    # Count by rule
    rule_counts: dict[str, dict[str, int]] = {}
    for entry in logs:
        rule_id = entry["ruleId"]
        if rule_id not in rule_counts:
            rule_counts[rule_id] = {"passed": 0, "failed": 0}
        if entry["passed"]:
            rule_counts[rule_id]["passed"] += 1
        else:
            rule_counts[rule_id]["failed"] += 1

    for rule_id, counts in sorted(rule_counts.items()):
        total = counts["passed"] + counts["failed"]
        fail_rate = counts["failed"] / total * 100 if total > 0 else 0
        print(f"  {rule_id}: {counts['failed']}/{total} failures ({fail_rate:.0f}%)")

    print()


def main():
    parser = argparse.ArgumentParser(description="Analyze ModelGuide eval results")
    parser.add_argument("--experiment", required=True, help="Experiment name")
    parser.add_argument("--verbose", action="store_true", help="Show detailed output")
    args = parser.parse_args()

    results_dir = find_results_dir(args.experiment)
    print(f"Loading results from: {results_dir}")

    summary = load_summary(results_dir)
    print_summary(summary)
    analyze_verifier_log(results_dir)


if __name__ == "__main__":
    main()
