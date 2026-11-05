from sng.ours.switch import IcmSwitch as _Switch


def BOT():
    return _Switch(start="b", back_share=0.22, switch_min=15, f9_min_left=6)
