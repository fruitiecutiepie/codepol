"""Plugin loader – dotted absolute imports, star import."""

from myapp.services.auth import authenticate
from myapp.services.helpers import *


async def load_plugin(name: str):
    ok = await authenticate("plugin_" + name)
    if not ok:
        raise RuntimeError("auth failed for plugin " + name)
    return {"name": name, "squares": squares(10)}
