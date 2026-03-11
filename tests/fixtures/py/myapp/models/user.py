"""User model – multiple inheritance, nested class, *args/**kwargs."""

from .base import BaseModel


class Serializable:
    def to_dict(self):
        return vars(self)


class User(BaseModel, Serializable):
    class Meta:
        table_name = "users"
        ordering = ["name"]

    def __init__(self, id: int, name: str, *args, **kwargs):
        super().__init__(id)
        self.name = name
        self.extra_args = args
        self.extra_kwargs = kwargs

    def greet(self):
        return "Hello, " + self.name
