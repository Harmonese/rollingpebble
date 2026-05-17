from __future__ import annotations

PYROLLER_RUNTIME_SPEC = "py-roller>=0.6.0,<0.8"
# requests / huggingface_hub use urllib3 for some model metadata calls.
# urllib3 needs PySocks for socks:// proxies; httpx[socks] alone is not enough.
PYROLLER_RUNTIME_SUPPORT_SPECS = ("PySocks>=1.7.1",)
PYROLLER_EVENT_PREFIX = "PYROLLER_EVENT "
