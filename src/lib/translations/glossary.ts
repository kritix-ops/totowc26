// Football term glossary. Every event type, stat label, position name,
// and tournament concept that surfaces from API-Football into the user
// UI is translated through this map. Static dictionary so the terms are
// version-controlled, type-safe, and reviewable in code review.
//
// Add a new term by adding an entry to TERMS below. The key is the
// canonical machine name (snake_case); the value carries Hebrew + English
// labels. Keep entries grouped by section comments — keeps the file
// browsable as it grows.
//
// Lookup at the call site: `t(locale, "yellow_card")` from
// ./index.ts. The TermKey union below makes typos a compile error.

const TERMS = {
  // ─── Match events ──────────────────────────────────────────────────
  goal:               { he: "שער",                  en: "Goal" },
  own_goal:           { he: "שער עצמי",             en: "Own goal" },
  penalty:            { he: "פנדל",                 en: "Penalty" },
  penalty_scored:     { he: "פנדל הובקע",           en: "Penalty scored" },
  penalty_missed:     { he: "פנדל הוחמץ",           en: "Penalty missed" },
  penalty_saved:      { he: "פנדל נהדף",            en: "Penalty saved" },
  penalty_shootout:   { he: "דו-קרב פנדלים",        en: "Penalty shootout" },
  free_kick:          { he: "בעיטה חופשית",         en: "Free kick" },
  throw_in:           { he: "כדור חוץ",             en: "Throw-in" },
  corner:             { he: "קרן",                  en: "Corner" },
  offside:            { he: "נבדל",                 en: "Offside" },
  foul:               { he: "עבירה",                en: "Foul" },
  yellow_card:        { he: "כרטיס צהוב",           en: "Yellow card" },
  red_card:           { he: "כרטיס אדום",           en: "Red card" },
  second_yellow:      { he: "צהוב שני",             en: "Second yellow" },
  substitution:       { he: "חילוף",                en: "Substitution" },
  substitution_in:    { he: "נכנס במקום",           en: "Sub in" },
  substitution_out:   { he: "יצא במקום",            en: "Sub out" },
  var_review:         { he: "בדיקת VAR",            en: "VAR review" },
  var_overturn:       { he: "החלטה התהפכה ב-VAR",   en: "VAR overturn" },
  injury:             { he: "פציעה",                en: "Injury" },
  injury_time:        { he: "זמן פציעות",           en: "Injury time" },
  goal_kick:          { he: "בעיטת שער",            en: "Goal kick" },
  drop_ball:          { he: "כדור נופל",            en: "Drop ball" },

  // ─── Match phases ──────────────────────────────────────────────────
  kickoff:            { he: "פתיחת המשחק",          en: "Kickoff" },
  halftime:           { he: "מחצית",                en: "Halftime" },
  full_time:          { he: "סיום המשחק",           en: "Full time" },
  extra_time:         { he: "הארכה",                en: "Extra time" },
  first_half:         { he: "מחצית ראשונה",         en: "First half" },
  second_half:        { he: "מחצית שנייה",          en: "Second half" },
  stoppage_time:      { he: "זמן הוספה",            en: "Stoppage time" },

  // ─── Shot types ────────────────────────────────────────────────────
  header:             { he: "כדור ראש",             en: "Header" },
  volley:             { he: "וולה",                 en: "Volley" },
  half_volley:        { he: "חצי וולה",             en: "Half-volley" },
  bicycle_kick:       { he: "בעיטת מספריים",        en: "Bicycle kick" },
  tap_in:             { he: "טאפ-אין",              en: "Tap-in" },
  long_range:         { he: "בעיטה ממרחק",          en: "Long-range shot" },
  curling_shot:       { he: "בעיטה מסובבת",         en: "Curling shot" },
  one_two:            { he: "מסירה והחזרה",         en: "One-two" },
  woodwork:           { he: "מסגרת",                en: "Woodwork" },
  post:               { he: "קורה",                 en: "Post" },
  crossbar:           { he: "קורה עליונה",          en: "Crossbar" },

  // ─── Player positions ──────────────────────────────────────────────
  goalkeeper:         { he: "שוער",                 en: "Goalkeeper" },
  defender:           { he: "מגן",                  en: "Defender" },
  midfielder:         { he: "קשר",                  en: "Midfielder" },
  forward:            { he: "חלוץ",                 en: "Forward" },
  center_back:        { he: "בלם",                  en: "Center back" },
  left_back:          { he: "מגן שמאלי",            en: "Left back" },
  right_back:         { he: "מגן ימני",             en: "Right back" },
  wing_back:          { he: "מגן מתקפה",            en: "Wing back" },
  defensive_midfielder: { he: "קשר הגנתי",          en: "Defensive midfielder" },
  central_midfielder: { he: "קשר מרכזי",            en: "Central midfielder" },
  attacking_midfielder: { he: "קשר התקפי",          en: "Attacking midfielder" },
  left_winger:        { he: "אגף שמאל",             en: "Left winger" },
  right_winger:       { he: "אגף ימין",             en: "Right winger" },
  striker:            { he: "חוד",                  en: "Striker" },
  center_forward:     { he: "חלוץ מרכזי",           en: "Center forward" },

  // ─── Match statistics ──────────────────────────────────────────────
  shots:              { he: "בעיטות",               en: "Shots" },
  shots_on_target:    { he: "בעיטות למסגרת",        en: "Shots on target" },
  shots_off_target:   { he: "בעיטות החטאה",         en: "Shots off target" },
  blocked_shots:      { he: "בעיטות חסומות",        en: "Blocked shots" },
  xg:                 { he: "xG (שערים צפויים)",    en: "xG (expected goals)" },
  xa:                 { he: "xA (בישולים צפויים)",  en: "xA (expected assists)" },
  goals_total:        { he: "סך הכל שערים",         en: "Total goals" },
  assists:            { he: "בישולים",              en: "Assists" },
  big_chances:        { he: "הזדמנויות גדולות",     en: "Big chances" },
  big_chances_missed: { he: "הזדמנויות שהוחמצו",    en: "Big chances missed" },

  // ─── Passing statistics ────────────────────────────────────────────
  passes_total:       { he: "סך הכל מסירות",        en: "Total passes" },
  completed_passes:   { he: "מסירות מדויקות",       en: "Completed passes" },
  pass_accuracy:      { he: "דיוק מסירה",           en: "Pass accuracy" },
  key_passes:         { he: "מסירות מפתח",          en: "Key passes" },
  through_balls:      { he: "מסירות חודרות",        en: "Through balls" },
  long_balls:         { he: "מסירות ארוכות",        en: "Long balls" },
  crosses:            { he: "הרמות",                en: "Crosses" },
  accurate_crosses:   { he: "הרמות מדויקות",        en: "Accurate crosses" },
  chances_created:    { he: "הזדמנויות שנוצרו",     en: "Chances created" },

  // ─── Defensive statistics ──────────────────────────────────────────
  tackles:            { he: "ניתוקים",              en: "Tackles" },
  tackles_won:        { he: "ניתוקים שהצליחו",      en: "Tackles won" },
  interceptions:      { he: "יירוטים",              en: "Interceptions" },
  clearances:         { he: "סילוקים",              en: "Clearances" },
  blocks:             { he: "חסימות",               en: "Blocks" },
  recoveries:         { he: "כדורים מוחזרים",       en: "Ball recoveries" },
  errors_leading_to_goal: { he: "טעות שהובילה לשער", en: "Error leading to goal" },

  // ─── Goalkeeper statistics ─────────────────────────────────────────
  saves:              { he: "הצלות",                en: "Saves" },
  punches:            { he: "אגרופים",              en: "Punches" },
  high_claims:        { he: "תפיסות גבוהות",        en: "High claims" },
  goals_conceded:     { he: "שערים שספג",           en: "Goals conceded" },
  clean_sheet:        { he: "רשת נקייה",            en: "Clean sheet" },

  // ─── Dribbling / 1v1 ───────────────────────────────────────────────
  dribbles_attempted: { he: "ניסיונות דריבל",       en: "Dribbles attempted" },
  dribbles_completed: { he: "דריבלים מוצלחים",      en: "Dribbles completed" },
  dribbled_past:      { he: "נעקף",                 en: "Dribbled past" },
  duels:              { he: "דו-קרבים",             en: "Duels" },
  duels_won:          { he: "דו-קרבים שניצחו",      en: "Duels won" },
  aerials_won:        { he: "ניצחונות באוויר",      en: "Aerials won" },
  ground_duels_won:   { he: "ניצחונות על הקרקע",    en: "Ground duels won" },

  // ─── Fouls and discipline ──────────────────────────────────────────
  fouls_won:          { he: "עבירות שספג",          en: "Fouls won" },
  fouls_committed:    { he: "עבירות שביצע",         en: "Fouls committed" },
  offsides_caught:    { he: "פעמים בנבדל",          en: "Times caught offside" },
  cards_total:        { he: "כרטיסים",              en: "Cards" },

  // ─── Physical / running ────────────────────────────────────────────
  distance_covered:   { he: "מרחק שעבר",            en: "Distance covered" },
  sprints:            { he: "ספרינטים",             en: "Sprints" },
  top_speed:          { he: "מהירות שיא",           en: "Top speed" },
  intense_runs:       { he: "ריצות אינטנסיביות",    en: "Intense runs" },

  // ─── Possession ────────────────────────────────────────────────────
  possession_pct:     { he: "אחוז החזקה",           en: "Possession %" },
  possession_lost:    { he: "אובדן כדור",           en: "Possession lost" },
  possession_won:     { he: "השגת כדור",            en: "Possession won" },
  touches:            { he: "נגיעות",               en: "Touches" },
  touches_in_box:     { he: "נגיעות ברחבת היריב",   en: "Touches in opponent box" },
  ball_carries:       { he: "הולכת כדור",           en: "Ball carries" },

  // ─── Match outcomes and milestones ─────────────────────────────────
  opening_goal:       { he: "שער פתיחה",            en: "Opening goal" },
  equalizer:          { he: "שער שוויון",           en: "Equalizer" },
  comeback:           { he: "קאמבק",                en: "Comeback" },
  brace:              { he: "צמד",                  en: "Brace" },
  hat_trick:          { he: "שלישייה",              en: "Hat-trick" },
  poker:              { he: "פוקר (4 שערים)",       en: "Poker (4 goals)" },
  rout:               { he: "מפלה",                 en: "Rout" },
  draw:               { he: "תיקו",                 en: "Draw" },
  win:                { he: "ניצחון",               en: "Win" },
  loss:               { he: "הפסד",                 en: "Loss" },

  // ─── Tournament awards / honours ───────────────────────────────────
  golden_boot:        { he: "מלך השערים",           en: "Golden Boot" },
  golden_ball:        { he: "כדור הזהב",            en: "Golden Ball" },
  golden_glove:       { he: "הכפפה הזהובה",         en: "Golden Glove" },
  best_young_player:  { he: "השחקן הצעיר הטוב ביותר", en: "Best Young Player" },
  fair_play_award:    { he: "פרס פייר-פליי",        en: "Fair Play Award" },
  team_of_tournament: { he: "נבחרת הטורניר",        en: "Team of the Tournament" },
  champion:           { he: "זוכה",                 en: "Champion" },
  runner_up:          { he: "סגן אלוף",             en: "Runner-up" },
  third_place:        { he: "מקום שלישי",           en: "Third place" },
  fourth_place:       { he: "מקום רביעי",           en: "Fourth place" },

  // ─── Tournament structure ──────────────────────────────────────────
  group_stage:        { he: "שלב הבתים",            en: "Group stage" },
  round_of_32:        { he: "שלב 1/16",             en: "Round of 32" },
  round_of_16:        { he: "שלב 1/8",              en: "Round of 16" },
  quarter_final:      { he: "רבע גמר",              en: "Quarter-final" },
  semi_final:         { he: "חצי גמר",              en: "Semi-final" },
  final:              { he: "גמר",                  en: "Final" },
  third_place_match:  { he: "משחק מקום שלישי",      en: "Third-place match" },
  knockout:           { he: "שלב הנוקאאוט",         en: "Knockout stage" },
} as const;

// Stable public type. Every component that calls `t()` receives a
// compile-time-checked key, so a typo (e.g. `t(locale, "yellow_cardx")`)
// fails the build instead of silently rendering the key string at runtime.
export type TermKey = keyof typeof TERMS;

export { TERMS };
