import pytest

from app.judges import parse_choice, parse_numbered, parse_pairwise, parse_score, render


@pytest.mark.parametrize("text,expected", [
    ("8", 8), ("Score: 8/10", 8), ("8.", 8), (" 10 ", 10), ("7.5", 7.5), ("**9**", 9),
    ("I'd rate it 6 out of 10", 6), ("۸", 8), ("Rating: 3/10.", 3),
    ("", None), (None, None), ("N/A", None), ("0", None), ("11", None), ("The answer is good", None),
])
def test_parse_score(text, expected):
    assert parse_score(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("A", "A"), ("B", "B"), ("TIE", "TIE"), ("tie", "TIE"), ("**A**", "A"), ("B.", "B"),
    ("Answer A", "A"), ("Answer B is better", "B"), ("A is better than B", "A"), ("It's a tie.", "TIE"),
    ("", None), (None, None), ("Neither", None),
])
def test_parse_pairwise(text, expected):
    assert parse_pairwise(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("2", 2), ("Option 3", 3), ("4.", 4), ("(C)", 3), ("۱", 1), ("5", None), ("", None),
])
def test_parse_choice(text, expected):
    assert parse_choice(text) == expected


def test_parse_numbered():
    assert parse_numbered("1. a\n2) b\n3. c\n4. d") == ["a", "b", "c", "d"]
    assert parse_numbered("Here you go:\n1. a\n2. b\n3. c\n4. d\nDone") == ["a", "b", "c", "d"]
    assert parse_numbered("1. a\n2. b\n3. c") is None


def test_render_is_single_pass():
    # braces inside an input must not be substituted again
    p = render("pointwise", passage="{answer}", question="q", answer="ans", rubric="")
    assert "{answer}" in p and "ans" in p
