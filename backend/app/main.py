"""
Application entry point compatibility shim for app.main:app.
Imports the FastAPI app defined in backend/main.py.
"""

import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from main import app  # noqa: F401, E402

