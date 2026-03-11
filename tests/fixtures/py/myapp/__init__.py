"""myapp package – re-exports selected names via __all__."""

from myapp.config import VERSION
from myapp.models import User

__all__ = ["VERSION", "User"]
