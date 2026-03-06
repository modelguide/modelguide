"""Product search workflow."""

PROMPT = """\
## Product search workflow
Customer names a product → IMMEDIATELY call `list_products`. Don't ask extra \
questions.
Customer asks "what do you recommend?" → ask MAX ONE question about the \
project, then search.
Customer wants specs (load ratings, dimensions, coverage) → call `get_product`.
Interpret freely: "Tapcon screws" → search "Tapcon". "Something for \
waterproofing a deck" → search "deck waterproofing". "That Simpson bracket" \
→ search "Simpson bracket"."""
