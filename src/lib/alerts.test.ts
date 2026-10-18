import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DEFAULT_ALERT_DELIVERY } from "@/config/alerts";
import { renderAlertEmail } from "./alert-email";
import { alertPrefs, withoutAlertEmails } from "./alerts";

describe("alertPrefs", () => {
  it("uses the defaults for anything not saved", () => {
    expect(alertPrefs({})).toEqual(DEFAULT_ALERT_DELIVERY);
    expect(alertPrefs(null)).toEqual(DEFAULT_ALERT_DELIVERY);
    expect(alertPrefs("nonsense")).toEqual(DEFAULT_ALERT_DELIVERY);
  });

  it("keeps the person's choices and ignores unknown values", () => {
    const prefs = alertPrefs({ large_charge: "off", fee_charged: "off", low_balance: "loud" });
    expect(prefs.large_charge).toBe("off");
    expect(prefs.fee_charged).toBe("off");
    expect(prefs.low_balance).toBe(DEFAULT_ALERT_DELIVERY.low_balance);
  });

  it("only lets urgent alerts be emailed right away", () => {
    const prefs = alertPrefs({ new_subscription: "email", duplicate_charge: "email" });
    expect(prefs.new_subscription).toBe("app");
    expect(prefs.duplicate_charge).toBe("email");
  });
});

describe("withoutAlertEmails", () => {
  it("turns every email preference into in-app, leaving off as off", () => {
    const prefs = withoutAlertEmails(alertPrefs({ low_balance: "off" }));
    expect(Object.values(prefs)).not.toContain("email");
    expect(prefs.low_balance).toBe("off");
    expect(prefs.large_charge).toBe("app");
  });
});

describe("renderAlertEmail", () => {
  const links = {
    alerts: "https://app.example/alerts",
    settings: "https://app.example/settings#alerts",
    unsubscribe: "https://app.example/unsubscribe?token=t&what=alerts",
  };

  it("puts the alert in the subject and both bodies, with a way to stop", () => {
    const email = renderAlertEmail(
      { type: "large_charge", title: "$1,200.00 at <Best> Electronics", body: "On your card." },
      links,
    );
    expect(email.subject).toBe("Unusually large charge: $1,200.00 at <Best> Electronics");
    expect(email.text).toContain("On your card.");
    expect(email.text).toContain(links.unsubscribe);
    expect(email.html).toContain("&lt;Best&gt;");
    expect(email.html).not.toContain("<Best>");
    expect(email.html).toContain("Stop alert emails");
  });
});
