"""Field 10: eight hackathon-style team bots (2-3 hours of work with an AI assistant each)."""
BOTS = {
    "f10_chen": ("sng.field10.bots", "Chen"),
    "f10_montecarlo": ("sng.field10.bots", "MonteCarlo"),
    "f10_pushfold": ("sng.field10.bots", "PushFold"),
    "f10_llm_rules": ("sng.field10.bots", "LlmRules"),
    "f10_aggro": ("sng.field10.bots", "Aggro"),
    "f10_passive": ("sng.field10.bots", "Passive"),
    "f10_tag_simple": ("sng.field10.bots", "TagSimple"),
    "f10_exploit_lite": ("sng.field10.bots", "ExploitLite"),
}

FIELDS = {"field10": [(name, 1.0) for name in BOTS]}
