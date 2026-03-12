"""Prompt eval for the reorder workflow.

Saves MCP responses as fixtures (first run), then replays them on subsequent
runs so only the LLM call is live. Scores each turn against assertions.

Usage:
  cd examples/agents/pipecat-agent
  .venv/bin/python tests/eval_reorder.py              # uses cached fixtures
  REFRESH_FIXTURES=1 .venv/bin/python tests/eval_reorder.py  # re-fetch from MCP
  LLM_MODEL=gpt-4.1 .venv/bin/python tests/eval_reorder.py  # test different model

Fixtures are saved to tests/fixtures/ and checked into git so evals run
without MCP access.
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_DIR = _THIS_DIR.parent
sys.path.insert(0, str(_PROJECT_DIR / "src"))

from dotenv import load_dotenv
load_dotenv(_PROJECT_DIR / ".env")

from openai import AsyncOpenAI, RateLimitError

import config
import tools
from tools import TOOL_SCHEMAS, TOOL_NAME_MAP, _transform_args, _extract_cart_id
from prompts import build_system_prompt

logging.basicConfig(level=logging.WARNING, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("eval")

FIXTURES_DIR = _THIS_DIR / "fixtures"
FIXTURES_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Test scenario
# ---------------------------------------------------------------------------

SCENARIO = {
    "name": "reorder_tile_broken_on_job",
    "description": "Customer has a broken tile, wants to reorder from history",
    "turns": [
        {
            "user": "Hi, my tile's broken on job and I need to order the same one.",
            "expect_tools": [],  # LLM may call look_up_order_history here or say fill line first
            "assertions": [
                ("starts_lookup_or_asks", lambda r: any(w in r.lower() for w in [
                    "pull up", "check", "order", "look", "got it", "what", "tile",
                ])),
                ("no_grout_mentioned", lambda r: "grout" not in r.lower() and "mapei" not in r.lower()),
            ],
        },
        {
            "user": "Which one was delivered to four eight one one Greenway?",
            "expect_tools": [],  # may call look_up_order_history if not done yet
            "assertions": [
                ("correct_date_january", lambda r: "january" in r.lower() or "jan" in r.lower()),
                ("not_pietra_for_greenway", lambda r: "pietra" not in r.lower() and "bernini" not in r.lower()),
            ],
        },
        {
            "user": "Yes, set up the same order.",
            "expect_tools": [],  # should create_cart and/or list_products
            "assertions": [
                ("acknowledges_action", lambda r: any(w in r.lower() for w in [
                    "got it", "on it", "sure", "setting", "cart", "adding", "order", "cases",
                ])),
            ],
        },
        {
            "user": "I also need some Mapei grout, same as last time.",
            "expect_tools": [],
            "assertions": [
                ("acknowledges_grout", lambda r: any(w in r.lower() for w in [
                    "grout", "mapei", "added", "bag", "fifty ninety",
                ])),
            ],
        },
        {
            "user": "Can you send the order summary to my email?",
            "expect_tools": [],
            "assertions": [
                ("confirms_email", lambda r: any(w in r.lower() for w in [
                    "sent", "sending", "email", "done", "sure", "will do",
                ])),
            ],
        },
        {
            "user": "No, that's all. Thanks.",
            "expect_tools": [],
            "assertions": [
                ("sign_off", lambda r: any(w in r.lower() for w in [
                    "luck", "job", "good", "take care", "alright",
                ])),
                ("no_help_offer", lambda r: "anything else" not in r.lower() and "help you" not in r.lower()),
            ],
        },
    ],
}


# ---------------------------------------------------------------------------
# Fixture management — cache MCP responses
# ---------------------------------------------------------------------------

_fixture_cache: dict[str, str] = {}


def _fixture_key(tool_name: str, args: dict) -> str:
    """Deterministic key for a tool call (excludes session_id for stability)."""
    stable_args = {k: v for k, v in args.items() if k != "session_id"}
    args_sorted = json.dumps(stable_args, sort_keys=True, default=str)
    return f"{tool_name}__{hash(args_sorted) & 0xFFFFFFFF:08x}"


def load_fixtures():
    """Load all cached fixtures from disk."""
    for f in FIXTURES_DIR.glob("*.json"):
        _fixture_cache[f.stem] = f.read_text()


def save_fixture(key: str, result: str):
    """Save a tool response to disk."""
    (FIXTURES_DIR / f"{key}.json").write_text(result)
    _fixture_cache[key] = result


def _find_fixture(tool_name: str, tool_args: dict) -> str | None:
    """Find fixture by exact key, then fall back to tool-name prefix match."""
    key = _fixture_key(tool_name, tool_args)
    if key in _fixture_cache:
        return _fixture_cache[key]
    # Fallback: any fixture for same tool name (handles arg variation between runs)
    for k, v in _fixture_cache.items():
        if k.startswith(f"{tool_name}__"):
            return v
    return None


async def execute_tool(tool_name: str, tool_args: dict, session_id: str) -> str:
    """Execute tool — from fixture if available, otherwise live MCP."""
    refresh = os.getenv("REFRESH_FIXTURES", "")

    if not refresh:
        cached = _find_fixture(tool_name, tool_args)
        if cached:
            result = json.loads(cached)
            _extract_cart_id(tool_name, result)
            return cached

    # Live call
    import mg_client
    mcp_name = TOOL_NAME_MAP.get(tool_name)
    if not mcp_name:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    mcp_args = _transform_args(tool_name, {**tool_args})
    try:
        result = await mg_client.call_tool(mcp_name, mcp_args, session_id)
        _extract_cart_id(tool_name, result)
        result_str = json.dumps(result)
        save_fixture(_fixture_key(tool_name, tool_args), result_str)
        return result_str
    except Exception as e:
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# LLM call with rate-limit retry
# ---------------------------------------------------------------------------


async def llm_call(client, **kwargs):
    """Chat completion with automatic rate-limit retry."""
    for attempt in range(5):
        try:
            return await client.chat.completions.create(**kwargs)
        except RateLimitError as e:
            wait = min(2 ** attempt, 30)
            # Parse wait hint from error if available
            msg = str(e)
            if "Please try again in" in msg:
                import re as _re
                m = _re.search(r"try again in ([\d.]+)", msg)
                if m:
                    wait = max(float(m.group(1)), 1.0)
            logger.warning("Rate limited, waiting %.1fs (attempt %d)", wait, attempt + 1)
            await asyncio.sleep(wait)
    raise RuntimeError("Rate limit not resolved after retries")


# ---------------------------------------------------------------------------
# Eval runner
# ---------------------------------------------------------------------------


async def run_eval():
    config.validate()
    tools._active_cart_id = None
    load_fixtures()

    model = os.getenv("LLM_MODEL", "gpt-4.1-mini")
    client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    num_runs = int(os.getenv("EVAL_RUNS", "1"))

    # Create a real session for MCP calls (needed when fixtures aren't cached)
    import mg_client
    needs_live = not _fixture_cache or os.getenv("REFRESH_FIXTURES")
    if needs_live:
        session_id = await mg_client.create_session(config.USER_EMAIL)
        logger.warning("Created live session for fixture fetch: %s", session_id)
    else:
        session_id = "eval-session"

    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)

    print(f"\n{'='*70}")
    print(f"  EVAL: {SCENARIO['name']} (model: {model}, runs: {num_runs})")
    print(f"  {SCENARIO['description']}")
    print(f"{'='*70}")

    all_results = []

    for run_idx in range(num_runs):
        tools._active_cart_id = None
        messages = [{"role": "system", "content": system_prompt}]

        # Trigger greeting
        messages.append({"role": "user", "content": "(User joins the call)"})
        resp = await llm_call(client, model=model, messages=messages, tools=TOOL_SCHEMAS)
        messages.append(resp.choices[0].message.model_dump(exclude_none=True))

        run_results = []
        total_latency = 0

        for turn_idx, turn in enumerate(SCENARIO["turns"]):
            messages.append({"role": "user", "content": turn["user"]})
            tool_calls_made = []
            agent_response = ""

            # LLM loop
            start = time.monotonic()
            for _ in range(8):
                resp = await llm_call(
                    client, model=model, messages=messages, tools=TOOL_SCHEMAS,
                )
                msg = resp.choices[0].message
                messages.append(msg.model_dump(exclude_none=True))

                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        fn_name = tc.function.name
                        fn_args = json.loads(tc.function.arguments)
                        tool_calls_made.append(fn_name)
                        result_str = await execute_tool(fn_name, fn_args, session_id)
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_str,
                        })
                    if msg.content:
                        agent_response += msg.content + " "
                else:
                    if msg.content:
                        agent_response += msg.content
                    break

            latency_ms = int((time.monotonic() - start) * 1000)
            total_latency += latency_ms

            # Score assertions
            assertion_results = {}
            for name, check in turn.get("assertions", []):
                try:
                    passed = check(agent_response)
                except Exception:
                    passed = False
                assertion_results[name] = passed

            # Check expected tools (soft check — order doesn't matter)
            expected = set(turn.get("expect_tools", []))
            actual = set(tool_calls_made)
            tools_match = expected.issubset(actual)

            all_passed = all(assertion_results.values()) and tools_match
            status = "PASS" if all_passed else "FAIL"

            run_results.append({
                "turn": turn_idx + 1,
                "status": status,
                "latency_ms": latency_ms,
                "tools_expected": list(expected),
                "tools_actual": tool_calls_made,
                "tools_match": tools_match,
                "assertions": assertion_results,
                "response": agent_response.strip(),
            })

        all_results.append(run_results)

        # Print run results
        if num_runs > 1:
            print(f"\n--- Run {run_idx + 1}/{num_runs} ---")

        for r in run_results:
            status_icon = "+" if r["status"] == "PASS" else "x"
            print(f"\n  [{status_icon}] Turn {r['turn']} ({r['latency_ms']}ms)")
            print(f"      Agent: {r['response'][:120]}{'...' if len(r['response']) > 120 else ''}")
            if r["tools_actual"]:
                print(f"      Tools: {', '.join(r['tools_actual'])}")
            if not r["tools_match"]:
                print(f"      MISSING TOOLS: {set(r['tools_expected']) - set(r['tools_actual'])}")
            for name, passed in r["assertions"].items():
                if not passed:
                    print(f"      FAILED: {name}")

    # Summary across runs
    print(f"\n{'='*70}")
    total_turns = len(SCENARIO["turns"])
    total_checks = sum(
        len(t.get("assertions", [])) + 1  # +1 for tool check
        for t in SCENARIO["turns"]
    )

    if num_runs == 1:
        passed = sum(1 for r in all_results[0] if r["status"] == "PASS")
        print(f"  RESULT: {passed}/{total_turns} turns passed")
    else:
        pass_rates = []
        for run_results in all_results:
            passed = sum(1 for r in run_results if r["status"] == "PASS")
            pass_rates.append(passed / total_turns)
        avg = sum(pass_rates) / len(pass_rates)
        print(f"  RESULT: {avg:.0%} avg pass rate across {num_runs} runs")
        print(f"  Per-run: {', '.join(f'{r:.0%}' for r in pass_rates)}")

    print(f"  Model: {model}")
    print(f"{'='*70}\n")

    # Exit code for CI
    if num_runs == 1:
        sys.exit(0 if passed == total_turns else 1)


if __name__ == "__main__":
    asyncio.run(run_eval())
