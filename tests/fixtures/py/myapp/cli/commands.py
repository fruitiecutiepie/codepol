"""CLI commands – relative imports across packages, for-loop variables."""

from ..config import DEBUG, APP_NAME
from ..models.user import User


def run_command(args):
    for arg in args:
        if arg == "--debug" and DEBUG:
            print("debug mode enabled for " + APP_NAME)


def list_users(user_data):
    users = []
    for name, uid in user_data:
        user = User(uid, name)
        users.append(user)
    return users
