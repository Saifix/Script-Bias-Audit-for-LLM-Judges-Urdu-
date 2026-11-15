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
    ("## Step 1: Understand the task\nAnswer A is in Urdu and answer B in English. Both are correct.\n\n"
     "The final answer is: $\\boxed{TIE}$", "TIE"),
    ("Answer A gives the place; answer B gives it too but in a different script, so they match.\n\n"
     "Therefore, the response should be: **TIE**", "TIE"),
    ("Looking at A first and then at B, B names the correct garrison while A names the wrong town.\n\n"
     "The final answer is: B", "B"),
    ("We compare A with B carefully. **A** is in Urdu script and **B** in Roman Urdu; only A is correct.\n"
     "Final verdict: **A**", "A"),
    # reasoned out but cut off before a verdict: unparseable, never guessed from letters mentioned along the way
    ("## Step 1: Understand the task\nWe need to compare answer A and answer B for the same question and", None),
    # verdict given as a phrase in the last sentence
    ("Answer A is written in English while Answer B is written in Nastaliq script (Urdu). The answers convey the "
     "same information. Therefore, it's a tie.", "TIE"),
    ("Both answers are accurate and directly answer their respective questions based on the information given in "
     "their passages, so they are equally good.", "TIE"),
    ("The answer remains the same as in Answer A (\"Four\"). Therefore, neither is better than the other; they are "
     "equivalent.", "TIE"),
    ("Answer A names the right town but Answer B names a different one, which the passage does not mention. "
     "Therefore, Answer A is better.", "A"),
    ("Both answers mention the garrison in the passage, but only one is precise about it. The better answer is B.", "B"),
    ("Both pick the ability that should be refined first, according to the passage. Therefore, they are tied in "
     "terms of correctness.", "TIE"),
    ("The answers are the same word in two scripts. Since both correctly address the question, they are considered "
     "equal.", "TIE"),
    # no verdict phrase at all: unparseable
    ("Answer A is in Urdu and Answer B in English, matching their passages. The quality and correctness of the "
     "answers are the same.", None),
    # last sentence names a winner AND a tie: ambiguous, unparseable
    ("Both answers mention the garrison in the passage and are close. Answer B is better, though it is nearly a tie.", None),
])
def test_parse_pairwise_long_reasoned_reply(text, expected):
    assert parse_pairwise(text) == expected


def test_judge_options_per_kind_max_tokens():
    from app.config import judge_options
    cfg = {"settings": {"judge_max_tokens": 8},
           "judges": [{"id": "x/judge", "reasoning_off": True, "pairwise_max_tokens": 1024}]}
    assert judge_options(cfg, "x/judge", "pairwise")["max_tokens"] == 1024
    assert judge_options(cfg, "x/judge", "pointwise")["max_tokens"] == 8
    assert judge_options(cfg, "x/judge")["max_tokens"] == 8  # no task kind given: the judge's default
    assert judge_options(cfg, "x/judge", "pairwise")["extra"] == {"reasoning": {"enabled": False}}


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
