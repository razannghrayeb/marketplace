"""Thin wrapper module to expose DualDetector from dual-model-yolo.py
under a valid Python import name.

Usage
-----
    from dual_model_yolo import DualDetector
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


def _load_impl() -> ModuleType:
    """Dynamically load the implementation from dual-model-yolo.py.

    This keeps the original file (with a hyphen in the name) as the
    single source of truth while providing a clean import path for
    application code and services.
    """

    impl_path = Path(__file__).with_name("dual-model-yolo.py")
    spec = importlib.util.spec_from_file_location("dual_model_yolo_impl", impl_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load implementation module from {impl_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[arg-type]
    return module


_impl = _load_impl()

# Re-export DualDetector for callers
DualDetector = _impl.DualDetector  # type: ignore[attr-defined]

__all__ = ["DualDetector"]
