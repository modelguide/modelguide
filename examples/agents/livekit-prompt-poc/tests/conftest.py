"""Pytest config — make src/ importable like the production buildpro example."""

import sys
from pathlib import Path

# Put `src/` on sys.path so tests can `import mg_profile` without packaging.
SRC_DIR = Path(__file__).parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
