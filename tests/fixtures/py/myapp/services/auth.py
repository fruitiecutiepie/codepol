"""Auth service – async funcs, relative imports, with/except."""

from ..models.base import BaseModel
from ..config import SECRET_KEY


async def authenticate(token: str) -> bool:
    try:
        with open("/tmp/auth.log", "a") as log_file:
            log_file.write("auth attempt\n")
        return token == SECRET_KEY
    except FileNotFoundError as err:
        return False


async def refresh_token(old_token: str) -> str:
    if not old_token:
        raise ValueError("empty token")
    return "refreshed_" + old_token


def verify_model(model: BaseModel) -> bool:
    return model.id > 0
