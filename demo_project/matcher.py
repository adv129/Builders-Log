"""StudyMatch — core matching logic (prototype)."""

from itertools import combinations


def overlap_score(a, b):
    """Score two builders by shared goals + overlapping availability slots."""
    shared_goals = set(a["goals"]) & set(b["goals"])
    shared_slots = set(a["availability"]) & set(b["availability"])
    if not shared_slots:
        return 0  # no point matching people who can never meet
    return len(shared_goals) * 2 + len(shared_slots)


def make_groups(builders, size=3):
    """Greedy: pair the highest-scoring builders first, then fill groups.

    TODO: this is O(n^2) and greedy — breaks down past ~30 builders and
    sometimes strands one person in a group of 1. Need a real assignment pass.
    """
    scored = sorted(
        combinations(builders, 2),
        key=lambda pair: overlap_score(*pair),
        reverse=True,
    )
    groups = []
    seen = set()
    for a, b in scored:
        if a["id"] in seen or b["id"] in seen:
            continue
        groups.append([a, b])
        seen.add(a["id"])
        seen.add(b["id"])
    return groups

# patch: handle odd-one-out
