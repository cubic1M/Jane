// A year, or one figure group of a year, that Jane has no confirmed figures for (Tax T1, T32b).
// Kept apart from index.ts so a year file can build an awaited group without importing the index.
export class NoTaxParamsError extends Error {
  // `group` is set when the year is supported but one group of it is awaited (not yet published by
  // its source): everything else of the year prices normally, only a read of that group fails.
  constructor(
    readonly year: number,
    readonly jurisdiction: "US" | "CA",
    readonly group?: string,
  ) {
    super(
      group
        ? `No ${jurisdiction} ${group} figures for ${year} yet (awaited)`
        : `No ${jurisdiction} tax figures for ${year}`,
    );
    this.name = "NoTaxParamsError";
  }
}
