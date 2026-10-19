import { oneSlip } from "./intents";

// What people call things (spec step 88): "my phone bill" is Verizon Wireless, "the gym" is
// Planet Fitness. A word the person typed matches a name when the name has it, one of its
// everyday words below, or (for longer words) the word with one letter slipped.

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  phone: ["verizon", "wireless", "mobile", "t-mobile", "at&t", "sprint", "cricket", "phone"],
  cell: ["verizon", "wireless", "mobile", "t-mobile", "at&t", "sprint", "cricket", "phone"],
  internet: ["comcast", "xfinity", "spectrum", "cox", "fios", "internet"],
  wifi: ["comcast", "xfinity", "spectrum", "cox", "fios", "internet"],
  cable: ["comcast", "xfinity", "spectrum", "cox", "fios", "cable"],
  tv: ["comcast", "xfinity", "spectrum", "directv", "dish", "tv"],
  gym: ["fitness", "gym", "crossfit", "equinox", "ymca"],
  music: ["spotify", "pandora", "tidal", "apple music", "music"],
  streaming: ["netflix", "hulu", "peacock", "paramount", "disney", "max", "streaming"],
  insurance: ["geico", "progressive", "allstate", "state farm", "insurance"],
  mortgage: ["mortgage"],
  loan: ["loan", "mortgage", "nelnet", "navient", "financial"],
  student: ["nelnet", "navient", "sallie", "student"],
  electric: ["pg&e", "edison", "electric", "energy", "power"],
  power: ["pg&e", "edison", "electric", "energy", "power"],
  utilities: ["pg&e", "edison", "electric", "energy", "water", "gas"],
  news: ["times", "journal", "post", "news"],
  newspaper: ["times", "journal", "post", "news"],
};

// The words that matter in what the person typed.
export function wordsOf(target: string): string[] {
  return target
    .toLowerCase()
    .split(/[^a-z0-9+&'-]+/)
    .filter((w) => w.length >= 2);
}

export function wordMatches(word: string, haystack: string): boolean {
  const text = haystack.toLowerCase();
  if (text.includes(word)) return true;
  if (SYNONYMS[word]?.some((s) => text.includes(s))) return true;
  return (
    word.length >= 4 && text.split(/[^a-z0-9+&'-]+/).some((t) => t.length >= 4 && oneSlip(word, t))
  );
}

// Every word matches.
export const nameMatches = (target: string, haystack: string) => {
  const words = wordsOf(target);
  return words.length > 0 && words.every((w) => wordMatches(w, haystack));
};
