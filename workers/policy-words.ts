/**
 * VRIP-09's vocabulary. Data only — no logic, no regexes over message text.
 *
 * This file is expected to grow; the detector is not. Every entry here is
 * normalised by `policy.ts` at module load, so entries may be written in their
 * natural spelling (including Devanagari) and still compare equal to whatever a
 * student types. Adding a Latin transliteration AND the Devanagari spelling is
 * correct and not redundant: the transliterator is deterministic, not faithful,
 * so `मादरचोद` and `madarchod` do not fold to the same string.
 *
 * Severity lives in `SEVERITY`, keyed by category, never on the word. That is
 * what lets a word move between lists without any branch changing, and it is
 * what makes "a count word next to a target becomes block" one rule rather than
 * one rule per word.
 */

export type Category = "profanity" | "slur" | "sexual" | "accusation";

export const TERMS: Record<Category, readonly string[]> = {
  /**
   * The normal register of the room. Alone this is counted and nothing else —
   * blocking it would make V Rooms feel like a school intranet, which is the
   * one thing it cannot afford (VRIP-09).
   */
  profanity: [
    "bc",
    "bkl",
    "bsdk",
    "bhosdk",
    "bhosdike",
    "bhosadike",
    "bhosda",
    "bhosdi",
    "bhosadi",
    "mkc",
    "mkb",
    "mc",
    "madarchod",
    "madarchood",
    "madrchod",
    "madarjaat",
    "behenchod",
    "bhenchod",
    "bhainchod",
    "benchod",
    "bahenchod",
    "chutiya",
    "chutiye",
    "chutya",
    "chodu",
    "chutmarike",
    "gandu",
    "gaandu",
    "gand",
    "gaand",
    "gandfat",
    "lund",
    "lawda",
    "lauda",
    "lodu",
    "randi",
    "harami",
    "haramkhor",
    "kutiya",
    "jhaant",
    "jhant",
    "tatti",
    "chinaal",
    "bhadwa",
    "bhadve",
    "saala",
    "zavadya",
    "jhavadya",
    "aaicha ghoo",
    "bhikarchot",
    "fuck",
    "fucking",
    "fucker",
    "motherfucker",
    "bitch",
    "bastard",
    "asshole",
    "dickhead",
    "cunt",
    "मादरचोद",
    "भोसडीके",
    "चूतिया",
    "गांडू",
    "रंडी",
    "हरामी",
    "भेनचोद",
    "बहनचोद",
    "लंड",
    "झवाड्या",
  ],

  /**
   * Caste, communal and racial abuse. Blocked whether or not it names anyone,
   * because the target is the group and it is always present.
   */
  slur: [
    "chamar",
    "bhangi",
    "chuhra",
    "katua",
    "landya",
    "chinki",
    "dhed",
    "nigger",
    "faggot",
    "retard",
    "tranny",
  ],

  /** Blocked once it is aimed at somebody; counted otherwise. */
  sexual: [
    "rape",
    "raped",
    "rapist",
    "molest",
    "molested",
    "nudes",
    "nude",
    "nangi",
    "nanga",
    "horny",
    "boobs",
    "chuchi",
    "sexy",
    "randi khana",
    "chod dunga",
    "gaand mar",
  ],

  /**
   * The case with no profanity in it at all: a named person and an allegation.
   * Alone these are ordinary words and score nothing — "the exam was a scam" is
   * not an incident. Next to a named target they are the defamation that
   * actually endangers VOSS, so they block.
   */
  accusation: [
    "bribe",
    "bribes",
    "bribery",
    "ghoos",
    "harass",
    "harasses",
    "harassed",
    "harassment",
    "harasser",
    "molests",
    "corrupt",
    "corruption",
    "cheat",
    "cheats",
    "cheated",
    "cheating",
    "cheater",
    "casteist",
    "racist",
    "sexist",
    "fraud",
    "scam",
    "scammer",
    "pervert",
    "creep",
    "creepy",
    "stalker",
    "stalking",
    "predator",
    "favouritism",
    "favoritism",
    "paid him",
    "paid her",
  ],
};

/**
 * Words that, near an ambiguous term, mean it was not abuse.
 *
 * Only the short forms need this. "because" never needs a guard because it
 * tokenises as one word and never equals `bc`; "MC" genuinely does mean the
 * compere at every campus fest, and that is worth one list.
 */
export const GUARDS: Record<string, readonly string[]> = {
  mc: [
    "compere",
    "emcee",
    "anchor",
    "anchoring",
    "host",
    "hosted",
    "hosting",
    "stage",
    "fest",
    "event",
    "mic",
    "ceremony",
  ],
  // `bcc` is not listed: it normalises to `bc` itself, so it would be the term
  // rather than a guard on it.
  bc: ["email", "mail", "inbox", "forward", "forwarded", "recipient"],
  sexy: ["looks", "looked", "design", "ui", "font", "car", "bike"],
};

/**
 * Matched case-insensitively against the word before a capitalised name, which
 * is the whole point of the pattern: `Prof Kulkarni` and `prof Kulkarni` name
 * the same person. Apostrophes are stripped before the lookup, so `ma'am` and
 * `maam` are one entry.
 */
export const HONORIFICS: ReadonlySet<string> = new Set([
  "dr",
  "prof",
  "professor",
  "sir",
  "madam",
  "maam",
  "mam",
  "mr",
  "mrs",
  "ms",
  "miss",
  "hod",
  "dean",
  "principal",
  "warden",
]);

/**
 * The same thing said the way it is actually said on this campus: the honorific
 * trails the name. `Kulkarni sir harasses juniors` names a person exactly as
 * precisely as `Prof Kulkarni` does, and only this list sees it.
 */
export const TRAILING_HONORIFICS: ReadonlySet<string> = new Set([
  "sir",
  "maam",
  "mam",
  "madam",
  "ji",
  "hod",
]);

/**
 * Branch codes, matched only in upper case. voss-ask's `reClassSpec` is
 * case-insensitive and therefore reads "is it a good idea" as class `IT-A`;
 * here a division reference is a target that can turn counted profanity into a
 * block, so that false positive is not affordable. Real usage is `CS-A`, `IT-B`.
 */
export const DIVISIONS: readonly string[] = [
  "CS",
  "CSE",
  "IT",
  "ISE",
  "EXTC",
  "ENTC",
  "ECE",
  "EEE",
  "ELEX",
  "MECH",
  "CIVIL",
  "CHEM",
  "AIML",
  "AIDS",
  "AI-DS",
  "BIOTECH",
  "COMPS",
  "INSTRU",
  "MBA",
  "MCA",
];

/**
 * Deterministic, not faithful. Inherent vowels are dropped, so `म क च` folds to
 * `mkc` — which is the abbreviation students actually type — while a whole word
 * folds to a stable string that its Devanagari entry in TERMS folds to as well.
 */
export const DEVANAGARI: Record<string, string> = {
  अ: "a",
  आ: "a",
  इ: "i",
  ई: "i",
  उ: "u",
  ऊ: "u",
  ऋ: "ri",
  ए: "e",
  ऐ: "ai",
  ओ: "o",
  औ: "au",
  "ा": "a",
  "ि": "i",
  "ी": "i",
  "ु": "u",
  "ू": "u",
  "ृ": "ri",
  "ॅ": "e",
  "े": "e",
  "ै": "ai",
  "ॉ": "o",
  "ो": "o",
  "ौ": "au",
  "ं": "n",
  "ँ": "n",
  "ः": "h",
  "्": "",
  "़": "",
  क: "k",
  ख: "kh",
  ग: "g",
  घ: "gh",
  ङ: "n",
  च: "ch",
  छ: "ch",
  ज: "j",
  झ: "jh",
  ञ: "n",
  ट: "t",
  ठ: "th",
  ड: "d",
  ढ: "dh",
  ण: "n",
  त: "t",
  थ: "th",
  द: "d",
  ध: "dh",
  न: "n",
  प: "p",
  फ: "ph",
  ब: "b",
  भ: "bh",
  म: "m",
  य: "y",
  र: "r",
  ल: "l",
  व: "v",
  श: "sh",
  ष: "sh",
  स: "s",
  ह: "h",
  ळ: "l",
  क़: "k",
  ख़: "kh",
  ग़: "g",
  ज़: "z",
  ड़: "r",
  ढ़: "rh",
  फ़: "f",
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};
