/**
 * Handle generation, ported from voss-ask's internal/username.
 *
 * The wordlists are curated lowercase ASCII and are the only thing keeping the
 * output inside [a-z-]; there is no normalisation step. Do not edit a word
 * without checking it against that charset.
 */

const ADJECTIVES = [
  "ancient",
  "bold",
  "brave",
  "breezy",
  "bright",
  "brisk",
  "calm",
  "cheery",
  "chill",
  "clever",
  "cosmic",
  "cosy",
  "crafty",
  "crisp",
  "curious",
  "dapper",
  "deft",
  "eager",
  "fierce",
  "fluffy",
  "fond",
  "frosty",
  "fuzzy",
  "gentle",
  "gilded",
  "glad",
  "grand",
  "happy",
  "hazy",
  "humble",
  "jazzy",
  "jolly",
  "keen",
  "kind",
  "lively",
  "lonely",
  "loyal",
  "lucky",
  "mellow",
  "merry",
  "mighty",
  "mild",
  "misty",
  "modest",
  "neat",
  "nifty",
  "noble",
  "peppy",
  "perky",
  "plucky",
  "polite",
  "proud",
  "quick",
  "quiet",
  "regal",
  "ruddy",
  "sage",
  "salty",
  "scrappy",
  "sharp",
  "silent",
  "silly",
  "sleek",
  "smart",
  "snappy",
  "snug",
  "spry",
  "steady",
  "stout",
  "sturdy",
  "sunny",
  "swift",
  "tame",
  "tidy",
  "tiny",
  "vivid",
  "wise",
  "witty",
  "zealous",
  "zesty",
] as const;

const ANIMALS = [
  "badger",
  "beaver",
  "bison",
  "boar",
  "camel",
  "crane",
  "crow",
  "deer",
  "dove",
  "duck",
  "eagle",
  "falcon",
  "finch",
  "fox",
  "frog",
  "gecko",
  "goat",
  "goose",
  "hawk",
  "heron",
  "ibex",
  "jay",
  "koala",
  "lemur",
  "lion",
  "llama",
  "lynx",
  "magpie",
  "marmot",
  "mink",
  "mole",
  "moth",
  "mule",
  "newt",
  "okapi",
  "orca",
  "oryx",
  "ostrich",
  "otter",
  "owl",
  "panda",
  "panther",
  "parrot",
  "pony",
  "puma",
  "quail",
  "rabbit",
  "ram",
  "rat",
  "raven",
  "ray",
  "robin",
  "salmon",
  "seal",
  "shark",
  "sloth",
  "snail",
  "sparrow",
  "swan",
  "tapir",
  "tiger",
  "toad",
  "trout",
  "turtle",
  "viper",
  "walrus",
  "weasel",
  "whale",
  "wolf",
  "yak",
  "zebra",
] as const;

export const HANDLE_PATTERN = /^[a-z]+-[a-z]+(-\d{4})?$/;

/** Uniform-ish index over crypto randomness, matching voss-ask's randIndex. */
function randIndex(n: number): number {
  if (n <= 0) return 0;
  const buf = new BigUint64Array(1);
  crypto.getRandomValues(buf);
  return Number(buf[0] % BigInt(n));
}

/** `adjective-animal`, 5,680 combinations. */
export function randomHandle(): string {
  return `${ADJECTIVES[randIndex(ADJECTIVES.length)]}-${ANIMALS[randIndex(ANIMALS.length)]}`;
}

/** `adjective-animal-0000`, the collision escape hatch. 56.8M combinations. */
export function randomHandleWithSuffix(): string {
  const suffix = String(randIndex(10_000)).padStart(4, "0");
  return `${randomHandle()}-${suffix}`;
}

/**
 * Candidate for attempt `n` (0-based). voss-ask switches to the numeric suffix
 * on the third consecutive collision; the same threshold applies here.
 */
export function handleCandidate(attempt: number): string {
  return attempt >= 3 ? randomHandleWithSuffix() : randomHandle();
}

export function isValidHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value) && value.length <= 64;
}

export const WORDLIST_SIZES = {
  adjectives: ADJECTIVES.length,
  animals: ANIMALS.length,
} as const;
