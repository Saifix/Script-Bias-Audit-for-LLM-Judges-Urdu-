"""Code-made verdicts that feed the plain-language summary."""
from app.playground import facts_text, judge_facts


def r(kind, cond, **kw):
    return {"kind": kind, "judge": "j", "condition": cond, **kw}


def test_verdicts():
    same = [r("pointwise", "urdu_script", answer="correct", score=9), r("pointwise", "roman_translit", answer="correct", score=8),
            r("comprehension", "urdu_script", choice=1, correct=True), r("comprehension", "roman_translit", choice=1, correct=True),
            r("pairwise", "roman_translit", answer="correct", order="AB", winner="tie"),
            r("pairwise", "roman_translit", answer="correct", order="BA", winner="tie")]
    f = judge_facts(same, ["urdu_script", "roman_translit"], {"j": "Judge J"})["j"]
    assert f["verdict"] == "same across scripts" and f["pairwise"] == {"roman_translit": ["tie"]}

    biased = [r("pointwise", "urdu_script", answer="wrong", score=4), r("pointwise", "roman_translit", answer="wrong", score=8),
              r("pairwise", "roman_translit", answer="wrong", order="AB", winner="urdu_script"),
              r("pairwise", "roman_translit", answer="wrong", order="BA", winner="urdu_script")]
    f = judge_facts(biased, ["urdu_script", "roman_translit"], {"j": "Judge J"})["j"]
    assert f["verdict"] == "changes with script"
    assert f["score_changes"] == [{"answer": "wrong", "version": "roman_translit", "change": 4}]
    assert f["prefers"] == ["urdu_script"]
    text = facts_text({"j": f})
    assert "Roman Urdu 8" in text and "prefers Urdu script" in text

    position = [r("pairwise", "english", answer="correct", order="AB", winner="english"),
                r("pairwise", "english", answer="correct", order="BA", winner="urdu_script")]
    f = judge_facts(position, ["urdu_script", "english"], {"j": "Judge J"})["j"]
    assert f["pairwise"] == {"english": ["depends on order"]} and f["verdict"] == "same across scripts"
