// What the upload says about a file before the person has picked its columns. Its own module so
// the import form (a client component) can tell this first step from a real error without
// loading the CSV parser.
export const PICK_COLUMNS =
  "Jane doesn't know this bank's layout yet. Pick which column is which below.";
