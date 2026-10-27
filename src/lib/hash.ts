import { createHash } from "node:crypto";

// What a link token is stored as: its SHA-256 in hex, so the database never holds a working link.
export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

// A stand-in's roll for a request, 0 to 9: the same every time for the same id, so a simulated
// company or lender gives one answer however often it's asked.
export const rollOf = (id: string): number => createHash("sha256").update(id).digest()[0] % 10;
