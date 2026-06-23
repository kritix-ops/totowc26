# משחק בוטל / נדחה — שליטת אדמין

תאריך: 2026-06-22
סטטוס: ממתין לאישור לפני מימוש

## רקע והבעיה

תרחיש אמיתי שצף ערב לפני משחק: משחק (צרפת מול עיראק) בסכנת ביטול בגלל
מזג אוויר. המארגנים לא יכלו להבטיח שהמשחק ישוחק. למערכת היום אין שום דרך
לטפל בזה.

מצב קיים בקוד:
- `matchStatusEnum` הוא רק `scheduled` / `live` / `final`
  (`src/db/schema.ts:35-39`). אין `postponed`, אין `canceled`.
- כש-API מדווח ביטול (`CANC`/`ABD`/`SUSP`/`INT`) הסנכרון מחזיר `no_change`
  ולא נוגע בשורה (`src/lib/api-football.ts:525-533`). `PST` (נדחה) ממופה
  ל-`scheduled`.
- `match_bets` (ניחוש משחק) מקבל ניקוד רק כש-`status='final'` עם תוצאה
  (`src/lib/sync.ts:570-700`). משחק שבוטל נתקע לנצח עם `pointsEarned=null`,
  בלי שליטה ובלי סימון למשתמש.
- לייבים (`custom_bets`) כבר חזקים: סטטוסים `draft/open/locked/graded/
  reversed/cancelled`, וכבר קיימות `voidCustomBet` (ביטול + החזר לכולם עם
  audit) ו-`cancelCustomBet` (`src/app/[lang]/admin/bets/actions.ts`).
- אין עמוד אדמין לניהול משחק בודד. הקרוב ביותר הוא `/admin/deadlines`
  שמעדכן `lockAtOverride` בלבד.
- הרשאות אדמין: רק `liveBets` / `tournamentBets` / `tournamentOdds`
  (`src/db/schema.ts:107-111`). אין הרשאת "matches".

## מחקר עולם ההימורים (לעיגון ההחלטות)

- משחק שבוטל לפני פתיחה: כל ההימורים מבוטלים (void) והכסף חוזר. ברירת מחדל.
- ניצחון טכני / walkover / forfeit: בדרך כלל void להימורים. ב-FIFA נרשם
  3-0 טכני, וב-2026 קבוצה שגורמת לביטול מפסידה טכנית.
- משחק שנדחה: כלל ה-48 שעות. תוך 48 שעות ההימורים בתוקף, מעבר לכך void.

מקורות: Betfair, OddsJam, FanDuel, SkyBet, Wikipedia (2026 WC controversies).

## מטרות

1. אדמין יכול לסמן משחק כ"נדחה" או "בוטל" לפני/אחרי הבעיטה.
2. נדחה = מצב pending. אין ניקוד, אין נגיעה בשום דבר. כשהאדמין יודע מועד
   חדש הוא מעדכן ותהליך ההימור חוזר.
3. בוטל = מצב pending ללא ניקוד, עם תפריט פתרונות שהאדמין בוחר מתוכו:
   void+החזר / תוצאה טכנית / חלוקת נקודות. עד שנבחר פתרון — אין ניקוד.
4. הכל מתועד (audit), מאובטח, וברור למשתמש הקצה.

## החלטות מוצר שנסגרו עם המשתמש

1. **קנס risk mode בביטול**: מתבטל תמיד. בכל ביטול (גם void וגם תוצאה
   טכנית) אף שחקן לא נקנס. ההיגיון: אי אפשר היה לחזות ביטול.
2. **לייבים בביטול**: ביטול והחזר אוטומטי לכולם. כל הלייבים בעלי
   `scope='match'` על המשחק עוברים void+החזר אוטומטית.
3. **דחייה**: ניחושים קיימים נשמרים ונפתחים לעריכה עד הדדליין החדש.

## הגישה שנבחרה

### מודל נתונים

1. הרחבת `matchStatusEnum` בשני ערכים: `postponed`, `canceled`.
   מיגרציה נפרדת משלה (pg לא מאפשר שימוש בערך enum חדש באותה טרנזקציה
   שמוסיפה אותו). פורמט קיים בריפו:
   `ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'postponed';`

2. עמודות חדשות ב-`matches`:
   - `cancelResolution` enum nullable: `void` | `awarded` | `split`.
     מתמלא רק כשמשחק `canceled` ונפתר.
   - `cancelResolutionConfig` jsonb nullable: לתוצאה טכנית
     `{ home: number, away: number }`, לחלוקה `{ points: number }`,
     ל-void `null`.
   - `statusChangedAt` timestamp nullable: מתי שונה הסטטוס ידנית
     (להבחנה מ-`finalizedAt`).

3. טבלת audit חדשה `match_status_audit` (מקבילה ל-`bet_grading_audit`,
   append-only, REVOKE UPDATE/DELETE):
   `id, matchId, action (postpone|cancel|resolve|reschedule|reopen),
   previousStatus, newStatus, payload jsonb, reason text (>=3),
   performedBy, performedAt`.

### צד הסנכרון (הגנה)

- `mapApiFootballStatus`: כבר מחזיר `no_change` ל-`CANC/ABD/SUSP/INT`,
  לכן לא ידרוס סטטוס ידני. אבל `PST→scheduled` *כן* ידרוס `postponed`
  ידני. תיקון: ב-upsert ב-`src/lib/sync.ts` להוסיף הגנה שאם הסטטוס הנוכחי
  הוא `postponed` או `canceled` — הסנכרון לא משנה אותו (no_change אפקטיבי).
- כשהסנכרון מזהה `CANC/ABD` הוא ירשום דגל "ממתין לאדמין" (התראה/לוג
  ניתן-לחיפוש) במקום להחליט לבד. האדמין מחליט.

### צד הניקוד (`scoreFinalMatches` ב-`src/lib/sync.ts`)

הרחבה לטיפול במשחקים שבוטלו ונפתרו (בנוסף ל-`final`):
- `canceled` + `cancelResolution=null` (pending): לא לגרד כלום. השארת
  `pointsEarned=null`. "אין ניקוד עד הודעה חדשה".
- `canceled` + `void`: כל `match_bets` מקבל `pointsEarned=0`,
  `wasExact=false`, `wasCorrectOutcome=false`, `locked=true`. **בלי קנס**
  גם אם risk mode דלוק. ניטרלי לחלוטין.
- `canceled` + `awarded`: גירוד מול הציון הטכני (`config.home/away`) עם
  אותו היגיון exact/outcome, אבל ניחוש שגוי = 0 ולא קנס.
- `canceled` + `split`: `pointsEarned=config.points` לכולם,
  `wasExact/wasCorrectOutcome=false`, `locked=true`.
- `postponed`: לא לגרד. אין שינוי.

חשוב: כל המסלולים אידמפוטנטיים — לא לגעת בשורות שכבר `pointsEarned`
לא-null (אלא בריוורס מפורש).

### קסקייד לייבים

בעת ביטול משחק (לא משנה איזה פתרון): void+החזר אוטומטי לכל
`custom_bets` עם `scope='match'` ו-`matchId` של המשחק, שאינם כבר
`graded/cancelled`. שימוש חוזר בלוגיקת `voidCustomBet` (החזר לכל ה-picks
דרך `pointsEarned=stakePaid`, audit, התראת feed). מבוטל פעם אחת, עם
שמירה מפני החזר כפול.

### זרימת דחייה (postponed)

1. אדמין מסמן `postponed` + סיבה. הסטטוס נשמר, audit נכתב.
2. ניחושי משחק קיימים נשמרים (לא נמחקים, לא ננעלים, לא נגרדים).
3. לייבים: picking כבר חסום אוטומטית כי `write-core` דורש
   `status='scheduled'`. picks קיימים נשארים pending (לא void — דחייה
   זמנית). לא נוגעים בהם.
4. אדמין קובע מועד חדש: מעדכן `kickoffAt`, מחזיר `status='scheduled'`,
   audit. דדליין ניחוש המשחק מחושב מחדש מ-`kickoffAt` החדש; `match_bets`
   נשארים פתוחים לעריכה (`locked=false`). לייבים בעלי `scope='match'`:
   נחשב מחדש את ה-`lockAt` שלהם יחסית ל-kickoff החדש (אחרת lockAt ישן
   בעבר ינעל אותם). פירוט מימוש: לעבור על הלייבים הפתוחים של המשחק
   ולהזיז lockAt.

### צד אדמין (UI)

משטח חדש לניהול סטטוס משחק. אופציה: route חדש `/admin/matches` (רשימת
משחקים עם פעולות סטטוס) + `/admin/matches/[id]`, או הוספת הפעולות לעמוד
`/admin/deadlines` הקיים שכבר טוען משחקים. המלצה: route חדש ייעודי
`/admin/matches` כדי לא לעמיס על דף הדדליינים.

פעולות:
- "סמן כנדחה" (דורש סיבה).
- "קבע מועד חדש" (בורר תאריך/שעה) — מופיע על משחק נדחה.
- "סמן כבוטל" (דורש סיבה) → המשחק עובר ל-pending.
- בורר פתרון לביטול: void / תוצאה טכנית (קלט ציון בית/חוץ) / חלוקה (קלט
  נקודות). באנר "ממתין להחלטה — אין ניקוד" עד בחירה.
- אפשרות "החזר להחלטה" (reopen) למקרה טעות, עם audit.

### צד משתמש (UI)

- תווית על כרטיס המשחק: "נדחה" (ענבר) / "בוטל" (אפור). מועד חדש מוצג אם נקבע.
- ניחוש על משחק void: "בוטל — הוחזר", ניטרלי.
- ניחוש על תוצאה טכנית: הצגת הציון הטכני עם סימון "תוצאה טכנית".
- mobile-first לפי כללי הפרויקט: בדיקה ב-360/414/768/1024/1440,
  touch targets 44px, בלי גלילה אופקית.

## חלופות שנדחו

1. **טיפול ברמת ההימור בלבד (בלי סטטוס משחק)**: להישען רק על
   `voidCustomBet` הקיים ולא לגעת בסטטוס המשחק. נדחה — לא פותר את ניחוש
   המשחק (`match_bets`) שנתקע ללא ניקוד, ואין סימון למשתמש.
2. **עמודות דגל מקבילות במקום ערכי enum** (`isCanceled`, `isPostponed`
   בוליאני). נדחה — יוצר מצב כפול שיכול לסתור את `status`. ערך enum יחיד
   הוא מקור אמת אחד.
3. **אוטומציה מלאה מה-API** (לבטל אוטומטית כשה-API אומר CANC). נדחה —
   המשתמש רוצה שליטה ידנית מפורשת, וה-API לא אמין לתרחיש הזה.
4. **void בלבד, בלי תוצאה טכנית/חלוקה**. נדחה — המשתמש ביקש מפורשות את כל
   האופציות.

## אבטחה (rule 13)

- כל הפעולות תחת **אדמין מלא** (לא אופרטור `liveBets` המצומצם), כי ביטול
  משפיע על ניקוד כל המשתמשים, לא רק לייבים. בדיקת הרשאה בכניסת כל server
  action.
- סיבה חובה (>=3 תווים) לכל שינוי סטטוס, נשמרת ב-audit בלתי-משתנה.
- Fail closed: config פתרון לא תקין (ציון שלילי, נקודות לא-מספר) → דחייה.
- אידמפוטנטיות והגנה מפני החזר כפול (לא לבטל לייב שכבר cancelled, לא לגרד
  שורה שכבר גורדה).
- ולידציה בגבול: כל קלט מספרי (ציון טכני, נקודות חלוקה) מאומת טיפוס וטווח.

## תצפיתיות (rule 14)

לוגים ממורחבים עם namespace וערכים:
- `[match status]` שינויי סטטוס: `{ matchId, from, to, by }`.
- `[match cancel]` ביטול ובחירת פתרון: `{ matchId, resolution, config }`.
- `[match postpone]` / `[match reschedule]`: `{ matchId, oldKickoff, newKickoff }`.
- `[match resolve]` גירוד לאחר ביטול: `{ matchId, resolution, betsScored,
  liveBetsVoided }`.
- `[score canceled]` בתוך `scoreFinalMatches`: כמה ניחושים עודכנו ואיך.

## הגדרות (rule 15)

- הגדרה אופציונלית `cancelSplitDefaultPoints` (ברירת מחדל לכמות נקודות
  בחלוקה), כדי שלא נצטרך להקליד כל פעם. ברירת מחדל ריקה/0.
- ברירת המחדל של פתרון ביטול נשארת בחירת אדמין מפורשת (לא הגדרה), לפי
  בקשת המשתמש לתפריט בכל מקרה.
- לא נחשף כהגדרה: ביטול הקנס בביטול (תמיד דלוק, לא ניתן לכיבוי).

## בדיקות (rule 18)

יחידה (Vitest, לפי הסטאק הקיים — לאמת בזמן מימוש):
- ניקוד void: כולם 0, אין קנס גם כש-risk mode דלוק.
- ניקוד תוצאה טכנית: גירוד מול הציון הטכני, ניחוש שגוי = 0 (לא קנס),
  ניחוש מדויק/כיוון נכון מקבל את הנקודות הרגילות.
- ניקוד חלוקה: כולם מקבלים את אותה כמות.
- pending: `canceled` בלי resolution לא מגרד כלום.
- הגנת סנכרון: `PST` מה-API לא הופך `postponed` ידני ל-`scheduled`.
- קסקייד: ביטול משחק עושה void+החזר לכל לייב `scope='match'`, בלי החזר כפול.
- דחייה+מועד חדש: סטטוס חוזר ל-`scheduled`, ניחושים נשמרים וניתנים
  לעריכה, lockAt של לייבים מחושב מחדש.
- אידמפוטנטיות: הרצה חוזרת של הניקוד על משחק שבוטל ונפתר לא משנה כלום.

מחוץ לטווח הבדיקות האוטומטיות: רינדור UI ויזואלי (ייבדק ידנית בנקודות
breakpoint).

## שאלות פתוחות / לאמת בזמן מימוש

1. מיקום משטח האדמין: route חדש `/admin/matches` מול הרחבת `/admin/deadlines`.
   המלצה: route חדש.
2. האם להוסיף הרשאה ייעודית חדשה (`matchStatus`) או לדרוש אדמין מלא.
   המלצה: אדמין מלא בלבד, בלי הרשאה חדשה.
3. פרטי מימוש הזזת `lockAt` של לייבים בעת reschedule (יחסית/אבסולוטית).
4. אימות פריימוורק הבדיקות הקיים (Vitest?) לפני כתיבת הטסטים.

## רצף מימוש מוצע

1. מיגרציות: ערכי enum (קובץ נפרד), עמודות `matches`, טבלת
   `match_status_audit`.
2. עדכון `src/db/schema.ts` בהתאם.
3. הגנת סנכרון (לא לדרוס סטטוס ידני) + דגל אדמין על CANC/ABD.
4. הרחבת `scoreFinalMatches` לארבעת מסלולי הביטול + postponed.
5. קסקייד void ללייבים בעת ביטול.
6. server actions: postpone / cancel / resolve / reschedule / reopen
   (עם הרשאה, סיבה, audit, לוגים).
7. UI אדמין: `/admin/matches`.
8. UI משתמש: תוויות + הצגת ניחוש מבוטל/טכני.
9. הגדרת `cancelSplitDefaultPoints`.
10. בדיקות יחידה + QA ידני ב-breakpoints.
