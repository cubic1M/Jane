import { describe, expect, it } from "vitest";
import { NO_DATES_OR_AMOUNTS, readCsvFile } from "./csv-source";
import { PICK_COLUMNS } from "./messages";

// The wrong file picked on /import (debug 3, 11-16): a contacts list got "Pick which column is
// which", offering "First Name (Ana)" and "Phone (555-0101)" as the date and the amount. No choice
// could read it, so the picker led nowhere. A file with nothing that reads as a date and an
// amount says it isn't a statement; a statement in an unknown layout still gets the picker.

const read = (name: string, text: string) => readCsvFile({ name, text });

describe("a file with no dates or amounts", () => {
  it("says it isn't a statement instead of asking which column is which", () => {
    const result = read(
      "contacts.csv",
      "First Name,Last Name,Phone,Email\nAna,Diaz,555-0101,ana@example.test\nBo,Lee,555-0102,bo@example.test\n",
    );
    expect(result).toMatchObject({ ok: false, error: NO_DATES_OR_AMOUNTS, reason: "not_csv" });
    expect(result.ok || result.choices).toBeFalsy();
  });

  it("says so for dates with no amounts, as a class schedule has", () => {
    const result = read(
      "schedule.csv",
      "Course,Room,Starts\nECON 101,Hall A,09/02/2026\nMATH 54,Evans 10,09/03/2026\n",
    );
    expect(result).toMatchObject({ ok: false, error: NO_DATES_OR_AMOUNTS });
  });

  it("still offers the picker for a statement in a layout Jane doesn't know", () => {
    const result = read(
      "euro.csv",
      "Buchungstag;Verwendungszweck;Betrag\n01.10.2026;Miete;-1.200,00\n05.10.2026;Gehalt;2.900,00\n",
    );
    expect(result).toMatchObject({ ok: false, error: PICK_COLUMNS, reason: "unknown_format" });
    expect(result.ok || result.choices).toBeTruthy();
    const plain = read(
      "credit-union.csv",
      "When,What,How much\n10/01/2026,RENT,-1200.00\n10/05/2026,PAYROLL,2900.00\n",
    );
    expect(plain).toMatchObject({ ok: false, error: PICK_COLUMNS });
  });
});
