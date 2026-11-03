"""Field 7: five sit-and-go bots of new styles."""
BOTS = {
    "f7_balanced": ("sng.field7.bots", "Balanced"),
    "f7_bully": ("sng.field7.bots", "Bully"),
    "f7_trickster": ("sng.field7.bots", "Trickster"),
    "f7_hackathon": ("sng.field7.bots", "Hackathon"),
    "f7_profiler": ("sng.field7.bots", "Profiler"),
}

FIELDS = {"field7": [(name, 1.0) for name in BOTS]}
