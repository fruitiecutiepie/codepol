"""Application-wide configuration constants."""

VERSION: str = "1.0.0"
DEBUG: bool = True
MAX_RETRIES: int = 5
TIMEOUT_MS: int = 3000
APP_NAME: str = "myapp"
DEFAULT_PORT: int = 8080
LOG_LEVEL: str = "INFO"
ENABLE_CACHE: bool = False
SECRET_KEY: str = "change-me"
DATABASE_URL: str = "sqlite:///db.sqlite3"
