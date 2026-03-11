"""Base model with decorators."""


class BaseModel:
    _table_name = "base"

    def __init__(self, id: int):
        self._id = id

    @property
    def id(self):
        return self._id

    @staticmethod
    def create_table():
        return f"CREATE TABLE {BaseModel._table_name}"

    def save(self):
        return True


def validate_id(id_value: int) -> bool:
    if id_value < 0:
        raise ValueError("id must be non-negative")
    return True
