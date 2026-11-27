import { describe, expect, it, vi } from "vitest";
import { SignwellError } from "./api";
import { signwellConnector } from "./connector";

// CodeRabbit sweep part 4 (P4-O23): SignWell's event hash covers the event's type and time, not
// the document, so a signed delivery is only a nudge: the document is read again from SignWell
// (Event Hash Verification, developers.signwell.com) and its own state decides.

const DOC = "a692e1ce-9929-4541-adc7-61932bab39d3";
const delivered = {
  eventId: "document_completed:1:x",
  externalRef: DOC,
  outcome: "done" as const,
  note: "You signed the letter.",
};
const confirmWith = (status: string) => {
  const get = vi.fn().mockResolvedValue({ id: DOC, status });
  return { get, confirm: signwellConnector({ get } as never).webhook!.confirm! };
};

describe("a delivery is confirmed against SignWell's own record of the document", () => {
  it("does not count a 'completed' delivery for a document SignWell says is still out", async () => {
    const { get, confirm } = confirmWith("Sent");
    const confirmed = await confirm(delivered);
    expect(get).toHaveBeenCalledWith(DOC);
    expect(confirmed.outcome).toBe("info");
  });

  it("counts it when SignWell says completed, and ends it when SignWell says declined", async () => {
    expect((await confirmWith("Completed").confirm(delivered)).outcome).toBe("done");
    expect((await confirmWith("Declined").confirm({ ...delivered, outcome: "info" })).outcome).toBe(
      "failed",
    );
  });

  it("refuses the delivery when SignWell cannot be asked, so it is sent again", async () => {
    const get = vi.fn().mockRejectedValue(new SignwellError(500, "REFUSED"));
    const { confirm } = { confirm: signwellConnector({ get } as never).webhook!.confirm! };
    await expect(confirm(delivered)).rejects.toThrow();
  });
});
