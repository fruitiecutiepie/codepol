"""Standalone script – imports from myapp package."""

from myapp.models.user import User
from myapp.config import VERSION
from myapp import models


def main():
    user = User(1, "Alice")
    print(user.greet())
    print("version:", VERSION)
    return user


if __name__ == "__main__":
    main()
