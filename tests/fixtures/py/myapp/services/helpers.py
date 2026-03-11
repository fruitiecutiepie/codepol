"""Helpers – lambdas, comprehensions (list/dict/set/generator)."""


double = lambda x: x * 2

transform = lambda items: [double(i) for i in items]


def squares(n):
    return [x * x for x in range(n)]


def name_lengths(names):
    return {name: len(name) for name in names}


def unique_initials(names):
    return {name[0] for name in names if name}


def lazy_values(items):
    return sum(val for val in items if val > 0)


def process_batch(items):
    results = []
    for item in items:
        results.append(double(item))
    return results
