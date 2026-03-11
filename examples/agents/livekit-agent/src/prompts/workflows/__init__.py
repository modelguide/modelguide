"""Auto-load all workflow prompts from this directory.

To add a new workflow: create a .py file with a PROMPT string variable.
It will be picked up automatically.
"""

import importlib
import pkgutil
from pathlib import Path


def load_all() -> list[str]:
    """Return PROMPT strings from all modules in this package."""
    prompts = []
    package_path = str(Path(__file__).parent)
    for _, module_name, _ in pkgutil.iter_modules([package_path]):
        module = importlib.import_module(f".{module_name}", package=__name__)
        if hasattr(module, "PROMPT"):
            prompts.append(module.PROMPT)
    return prompts
