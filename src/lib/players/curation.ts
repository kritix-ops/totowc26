// Curated ordering for the player picker. Two sources:
//
//   STAR_PLAYER_API_IDS: hand-picked globally-recognised players whose
//   api_football_id is verified to exist in our players table. Used to
//   surface superstars at the very top of the picker. Order in the
//   array = display order (Messi before any other Argentine, Mbappé
//   before any other French player, etc.).
//
//   TEAM_RANK: pragmatic strength ordering across all 48 WC 2026
//   teams. Drives sort within non-star rows. Lower number = stronger
//   team = appears earlier in the picker. Hand-set to reflect WC
//   2026 favourites, historical performance, and global recognition.
//   Tweak freely as the tournament narrative shifts.
//
// All ids verified against the live players table on 2026-05-28.

const STAR_PLAYER_API_IDS: ReadonlyArray<number> = [
  // Argentina
  154,    // Lionel Andrés Messi
  6009,   // Julián Álvarez

  // Brazil
  762,    // Vinícius Júnior
  1496,   // Raphinha (Raphael Dias Belloli)
  276,    // Neymar Jr
  280,    // Alisson Becker
  617,    // Ederson
  747,    // Casemiro
  127769, // Gabriel Martinelli
  22224,  // Gabriel Magalhães
  377122, // Endrick

  // France
  278,    // Kylian Mbappé
  153,    // Ousmane Dembélé
  22221,  // Mike Maignan
  1271,   // Aurélien Tchouaméni
  1145,   // Ibrahima Konaté

  // England
  129718, // Jude Bellingham
  631,    // Phil Foden
  626,    // John Stones
  2932,   // Jordan Pickford
  909,    // Marcus Rashford

  // Spain
  386828, // Lamine Yamal
  1323,   // Dani Olmo

  // Germany
  203224, // Florian Wirtz
  502,    // Joshua Kimmich
  2285,   // Antonio Rüdiger

  // Portugal
  1485,   // Bruno Fernandes
  855,    // João Cancelo
  583,    // João Félix

  // Netherlands
  290,    // Virgil van Dijk
  247,    // Cody Gakpo

  // Belgium
  629,    // Kevin De Bruyne
  730,    // Thibaut Courtois
  907,    // Romelu Lukaku
  162714, // Amadou Onana

  // Norway
  1100,   // Erling Haaland

  // Egypt
  306,    // Mohamed Salah

  // Morocco
  9,      // Achraf Hakimi

  // South Korea
  186,    // Son Heung-Min

  // Croatia
  754,    // Luka Modrić

  // Austria
  505,    // David Alaba

  // Algeria
  635,    // Riyad Mahrez
];

// Map for O(1) star lookup with rank preserved.
export const STAR_PLAYER_RANK: ReadonlyMap<number, number> = new Map(
  STAR_PLAYER_API_IDS.map((id, idx) => [id, idx]),
);

// Pragmatic WC 2026 team ranking. Lower = stronger / more central to
// the tournament narrative. Used as the tie-breaker after stars and
// before alphabetical sort.
export const TEAM_RANK: ReadonlyMap<string, number> = new Map([
  // Tier 1 — favourites
  ["BRA",  1],
  ["ARG",  2],
  ["FRA",  3],
  ["ENG",  4],
  ["ESP",  5],

  // Tier 2 — strong contenders
  ["GER",  6],
  ["POR",  7],
  ["NED",  8],
  ["BEL",  9],

  // Tier 3 — capable, recent semis / WC presence
  ["CRO", 10],
  ["MAR", 11],
  ["URY", 12],
  ["MEX", 13],
  ["USA", 14],
  ["JPN", 15],

  // Tier 4 — mid-Europe + Asia top
  ["SUI", 16],
  ["NOR", 17],
  ["AUT", 18],
  ["KOR", 19],
  ["COL", 20],

  // Tier 5 — Africa heavyweights
  ["EGY", 21],
  ["SEN", 22],
  ["CIV", 23],
  ["ALG", 24],
  ["GHA", 25],

  // Tier 6 — mid-pack
  ["IRN", 26],
  ["JOR", 27],
  ["KSA", 28],
  ["ECU", 29],
  ["PAR", 30],
  ["AUS", 31],
  ["CAN", 32],

  // Tier 7 — long shots
  ["NZL", 33],
  ["RSA", 34],
  ["COD", 35],
  ["CPV", 36],
  ["SCO", 37],
  ["SWE", 38],
  ["TUR", 39],
  ["TUN", 40],
  ["CZE", 41],
  ["BIH", 42],
  ["UZB", 43],
  ["HAI", 44],
  ["QAT", 45],
  ["PAN", 46],
  ["IRQ", 47],
  ["CUW", 48],
]);
