# Manual QA — pre-WC2026 launch checklist

**Date:** 2026-06-06
**Owner:** Yoav
**Target window:** עד 2026-06-11 (כניסת המונדיאל) — בערב 10/6 הכי טוב לסיים שלב ה‑smoke
**Last QA agent run:** `_qa-reports/2026-06-06-1349/` — 0C/0H/0M/0L

## למה תוכנית ידנית בנוסף ל‑qa-agent

הסוכן האוטומטי כבר מכסה את הזרימה הפונקציונלית בכרומיום סינתטי. מה שהוא **לא יכול** לבדוק (וזה מה שהתוכנית הזאת מטרגטת):

- **מכשיר אמיתי** (iPhone שלך, אנדרואיד של חבר), לא דפדפן מולטינוקוס headless
- **מיילים אמיתיים** מגיעים ל‑inbox האמיתי, לא לטסט-מסכון
- **תחושת מהירות** על סלולר (4G/5G/Wi-Fi)
- **PWA install** ו‑service worker
- **משתמש‑מול‑משתמש**: דו-קרב שאתה פותח ומשתמש אחר באמת מצטרף
- **תאימות דפדפן**: Safari iOS/macOS, Firefox, Edge
- **אסתטיקה ותחושה**: צבעים, ספייסינג, טיפוגרפיה — דברים שמודל לא יודע לדרג
- **אינטראקציה ידנית**: ניסיון לשבור משהו בכוונה

---

## אסטרטגיה: 3 שלבים

| שלב | משך | מתי | מטרה |
|---|---|---|---|
| 1. Smoke | 30 דק' | עכשיו | "הכל עומד" — gates קריטיים |
| 2. Deep dive | 2-3 שעות | 7-9 ביוני | כל מאפיין, כל ויואפורט, כל edge |
| 3. Pre-flight | 30 דק' | 10/6 בערב | רשת ביטחון לפני 11/6 |

---

## שלב 0 — Pre-flight (לפני שמתחילים)

- [ ] לוודא שאתה על הסביבה הנכונה. סנדבוקס לפיתוח, פרוד לבדיקה סופית
- [ ] לפתוח devtools console (F12) ולהשאיר פתוח בכל הריצה — אם משהו זורק `[pageerror]` או `[console error]` שאינו `#419` (recoverable), זה ממצא
- [ ] לוודא שיש לך 2 משתמשים זמינים בפרוד: שלך + לפחות חבר אחד שמסכים להיות בית-טסט
- [ ] להפעיל network throttling ל‑"Fast 3G" באחת הריצות לפחות — אם משהו "תקוע" שם, סלולרים זה תקוע בפועל
- [ ] לרשום על דף נפרד כל ממצא — אל תסמוך על הזיכרון

---

## שלב 1 — Smoke (30 דק')

ה‑gates הקריטיים. אם אחד מהם נופל, **אסור** לפתוח רישום למשתמשים אמיתיים.

### Auth & signup
- [ ] **/he/signup** — מילוי טופס תקין → "תודה על ההרשמה, חכה לאישור" → המייל ל‑`yoav@kritix.io` מגיע תוך 60 שניות עם פרטי הנרשם
- [ ] **/he/admin/signups** (כמנהל) → רשימת בקשות → אישור → המשתמש מקבל מייל "אושרת"
- [ ] **/he/login** עם הסיסמה החדשה → נכנס נקי, מוביל ל‑`/he` עם ה‑bank pill מוצג
- [ ] לוגאאוט מהתפריט → מוביל ל‑`/he/login` בלי error
- [ ] ניסיון להגיע ל‑`/he/bets` בלי להתחבר → redirect ל‑login

### Match picks (הימור על משחק)
- [ ] **/he/bets** → רשימת 48 משחקי שלב הבתים מוצגת (12 בתים × 4 כל אחד? — לבדוק שהמספר הגיוני)
- [ ] לוחצים על משחק → טופס הימור עם 1X2 + תוצאה מספרית + "שמור"
- [ ] שמירת הימור: כפתור מציג "שומר..." → "הימור נשמר" → ה‑bank pill בהדר יורד בהתאם
- [ ] ניווט הלוך-חזור ל‑`/he/bets` → המשחק מציג "נשמר" persistent
- [ ] עריכת הימור קיים: שינוי הניחוש → "שמור" שוב → ה‑bank pill לא משתנה (אותו stake)

### Bank
- [ ] **/he/me/bank** → יתרה התחלתית מוצגת ("בנק התחלתי +X")
- [ ] אחרי ה‑bet מהשלב הקודם — שורה חדשה מציגה את הסכום שננעל
- [ ] המספר ב‑pill הדר זהה לסיכום ב‑/he/me/bank (לא drift)

### Tournament outrights + Group bets
- [ ] **/he/bets/tournament** → מציג tabs ו‑placeholder "עוד אין הימורי טורניר פתוחים" כל עוד האדמין לא פרסם
- [ ] כשהאדמין מפרסם הימור טורניר (מ‑`/he/admin/bets/tournament`) → הוא נראה ב‑`/he/bets/tournament` מיד אחרי refresh
- [ ] **/he/bets/groups** — אותו דבר עם דירוגי בתים

### Duels
- [ ] **/he/duels/new** → בחר "משחק" → "בחר משחק" dropdown עובד → ממלא שאלה+כלל → wager → "פתח דו-קרב" → המעבר ל‑`/he/duels/[id]`
- [ ] במסך פתיחת דו-קרב, ה‑deadline hint מציג טקסט נכון לסוג (match/יום/טורניר) — הקופי הזה תוקן ב‑`227db81`, ראוי לוודא ידנית בכל 3 הסוגים
- [ ] משתמש שני (חבר טסט) → /he/duels → רואה את הדו-קרב פתוח → "הצטרף" עם תשובה נגדית → ה‑duel עובר למצב joined
- [ ] שני המשתמשים רואים את ה‑duel בלשונית "שלי" אצלם

### Critical observability
- [ ] בכל מסך — devtools → Console — אין שגיאות אדומות שלא #419
- [ ] בכל מסך — devtools → Network — אין 500/404 רנדומליים מבקשות JS/CSS/API

### Settings
- [ ] **/he/profile** → "התנתק" עובד
- [ ] **/he/admin/settings** (אם אתה אדמין) → מוודאים שכל הסוויצ'ים הקריטיים במצב הנכון לפני פתיחת ה‑pool: deadline minutes, stake amounts, max duel stake, signup pause

**Pass gate**: אם 100% מהבדיקות בשלב הזה ירוקות, אתה רשאי לפתוח את הסביבה למשתמשים אמיתיים. אם משהו נופל, לתקן ולחזור.

---

## שלב 2 — Deep dive (2-3 שעות, פרוס על 2-3 ערבים)

### A. Auth perimeter — כל ה‑edges

- [ ] /he/signup — שם של תו אחד → validation לא נותן להגיש
- [ ] /he/signup — אימייל לא תקין → validation לא נותן להגיש
- [ ] /he/signup — טלפון לא תקני (אותיות, מספרים מועטים) → validation
- [ ] /he/signup — הגשה כפולה של אותו אימייל → הודעת שגיאה הגיונית (לא 500)
- [ ] /he/signup honeypot field — לא נראה לעין אבל קיים ב‑DOM (לבדוק עם devtools)
- [ ] /he/login עם אימייל לא קיים → הודעת שגיאה
- [ ] /he/login עם סיסמה שגויה → הודעת שגיאה, לא חושף "המשתמש קיים אבל הסיסמה שגויה"
- [ ] /he/login עם משתמש שעוד לא אושר → הודעה "ממתין לאישור"
- [ ] /he/forgot-password (אם קיים) → אימייל איפוס מגיע
- [ ] /he/set-password → סיסמה חדשה תופסת, כניסה חוזרת עובדת
- [ ] לעבור מ‑/he/login עם session פעיל → redirect ל‑`/he` במקום הצגת טופס
- [ ] ל‑f5 על `/he/bets` כשמחובר → השעת ה‑sandbox banner ושאר חמישית-שניות הדבר העובד
- [ ] לוגאאוט במכשיר A → באמת איבד session גם במכשיר B (multi-device session)

### B. ניהול הימורים (live bets) — כל הזרימות

- [ ] בכל הימור — סכום ה‑stake שיורד מהבנק נכון (לפי settings)
- [ ] ניסיון לשמור הימור על משחק שעבר 5 דקות לפני kickoff → button מנוטרל / שגיאה ברורה
- [ ] שינוי הימור עד דקה לפני ה‑5-min cap → עדיין עובד; אחרי → נחסם
- [ ] משחק שסומן כ‑locked מהאדמין דרך admin/deadlines → נחסם גם אם הוא רחוק מהקיק-אוף
- [ ] "תפתיע אותי" (אם זמין) → מציע ערכים סבירים, לא הימור על משחק שעבר את ה‑deadline
- [ ] ה‑surprise me **לא** דורס הימור קיים בלי אישור (per memory: "user bets are SACRED")
- [ ] ב‑/he/bets/live/[date] — כשאדמין מפרסם הימור יום, הוא נראה מיד; כל-עוד לא — empty state

### C. Tournament outrights — כל סוג

(תלוי בקטגוריות שהאדמין מפרסם — בלי כאלה, רק לאמת empty state)

- [ ] **שופט/מנצח/וכו'** — לבחור אופציה, אישור, רישום ב‑/he/me/bank עם stake=0 (לפי memory: tournament bets are free)
- [ ] **closest number** (טוטל גולים/אדומים) — לבדוק שה‑range buckets נכונים אחרי המיגרציה ש‑`scripts/one-off/notify-range-conversion.mjs` כיסה
- [ ] לבדוק את הקופי בעברית של כל קטגוריה (מקצוען Hebrew → לוודא שאין "[object Object]" או חוסר תרגום)

### D. Duels — כל הזרימות

- [ ] פתיחת duel סוג "משחק" → deadline נכון (1 שעה לפני kickoff או X שעות, המוקדם)
- [ ] פתיחת duel סוג "יום משחקים" → deadline נכון (1 שעה לפני המשחק הראשון של היום)
- [ ] פתיחת duel סוג "טורניר" → deadline = X שעות מעכשיו בלבד
- [ ] auto-grade toggle (רק על match scope) → מציג את האפשרויות סטטסים+קומפרטור+סף
- [ ] live scenarios preview — מציג נכון "תרוויח +X / תפסיד -Y"
- [ ] גודל stake מעל מקסימום → button disabled
- [ ] אחרי 24h של duels-per-user → "הגעת למקסימום היומי" (אם זה הגיוני לטעון)
- [ ] משתמש מצטרף → מקבל הודעה (push? mail?) שדו-קרב נפתח על משהו שמעניין אותו (אם זה מופעל)
- [ ] גם הפותח וגם המצטרף רואים את הסטטוס "joined" אחרי הצטרפות
- [ ] ביטול duel לפני הצטרפות (מהפותח) → stake חוזר לבנק
- [ ] hand-grade by admin (כשהדו-קרב נסגר) → המנצח מקבל את הניצחון בבנק, המפסיד נשאר עם -stake

### E. Bank & points

- [ ] בכל פעולה (bet / unbet / duel open / duel join / duel win / duel lose / settlement) — ה‑bank pill מתעדכן מיד (לא דורש refresh)
- [ ] /he/me/bank → היסטוריית עסקאות מציגה כל פעולה בסדר כרונולוגי, עם תאריך IL נכון
- [ ] יתרה התחלתית + כל ה‑+/- = יתרה נוכחית (לוודא חישובית בעיניים על 3-5 שורות)
- [ ] עסקאות in-flight (duel פתוח שעוד לא הוכרע) → מוצגות בנפרד או בסיכום, כדי שהמשתמש יראה כמה "נעול" וכמה זמין
- [ ] לפי memory: "total points = available to bet" — לוודא שאין הפרש מטעה ב‑UI

### F. Leaderboard

- [ ] /he/leaderboard → tab "כללי" מוצג עם דירוג נכון לפי נקודות
- [ ] tab-ים אחרים (לפי שלב/קטגוריה) → מוצגים נכון או "טרם נפתח"
- [ ] משתמש "אני" מודגש בשורה שלו
- [ ] הצגת tied players (אם יש) — שהדירוג עקבי (X#1, X#1, Y#3) או (X#1, X#2, Y#3) — לפחות שאין באג של "1,2,3,3,5"

### G. News / tournament info

- [ ] /he/tournament?tab=news → קופי טעון מ‑RSS feeds (Walla, Ynet)
- [ ] לבדוק שכל פריט news פותח את הקישור המקורי החיצוני בטאב חדש
- [ ] תאריכים על כרטיסי news — בעברית, IL timezone
- [ ] אם RSS feed מת — הודעה ברורה, לא קריסה

### H. Admin tools (אתה כמנהל)

- [ ] /he/admin → לוח ראשי מציג סטטוס כללי (משתמשים, הימורים, בעיות)
- [ ] /he/admin/signups → רשימת בקשות הרשמה → אישור/דחיה עובד, מייל נשלח, סטטוס מתעדכן
- [ ] /he/admin/bets/tournament → ליצור הימור טורניר, לפרסם, להחביא, לעדכן
- [ ] /he/admin/bets/groups → דירוג בית — אותו flow
- [ ] /he/admin/bets/live → לפרסם הימורי יום ספציפיים למשחק/יום
- [ ] /he/admin/deadlines → כל deadline ספציפי משחק / משחק-יום
- [ ] /he/admin/scoring → להזין תוצאה אמיתית של משחק שהסתיים → מערכת מציינת נקודות לכל מי שניחש נכון
- [ ] /he/admin/users → לראות משתמש, להפעיל "view as" → לראות את ה‑UI שלו
- [ ] /he/admin/content → לראות את כל ה‑override-ים של copy
- [ ] /he/admin/settings → לוודא ערכים יציבים: stake-main, scoring-exact, scoring-outcome, deadline-minutes
- [ ] /he/admin/sandbox (אם בסביבת sandbox) → 3 הכפתורים: push settings (column diff), push code (GitHub merge), refresh sandbox from prod
- [ ] לדחוף settings מ‑sandbox ל‑prod → לוודא שערכים העברו ושלא נדרסה כל מילה של משתמש (per memory: user bets sacred — refresh sandbox refreshes operational tables only)

### I. Mail & notifications

- [ ] ההרשמה החדשה → מייל ל‑`yoav@kritix.io` עם הפרטים
- [ ] אישור משתמש → מייל למשתמש שאושר
- [ ] reject משתמש → מייל (אם קונפיגרציה אומרת לשלוח)
- [ ] duel חדש נפתח → אם יש פוש/מייל, מגיע לכל המשתמשים הזכאים
- [ ] duel נסגר עם תוצאה → המנצח מקבל מייל / push (אם מופעל)
- [ ] תזכורות יומיומיות (אם יש cron) → מגיעות בשעה הצפויה, נוסחאות עברית נכונה
- [ ] לבדוק שהמיילים מגיעים מ‑`noreply@kritix.io` עם Reply-To `yoav@kritix.io` (לפי memory)
- [ ] לפתוח מייל ולוודא ניתן ללחוץ על CTAs ולחזור לאפליקציה

---

## שלב 3 — Cross-cutting (משולב עם שלב 2)

### Responsive — 5 viewport-ים

לכל מסך מרכזי (/he, /he/bets, /he/bets/[matchId], /he/me/bank, /he/duels, /he/admin):
- [ ] 360 × 800 (iPhone SE) — אין horizontal scroll, אין clipping, tap targets ≥44×44
- [ ] 414 × 896 (iPhone Pro) — אותו דבר
- [ ] 768 × 1024 (iPad) — bottom nav או top nav לפי breakpoint, ללא overlap
- [ ] 1024 × 768 (iPad landscape) — תקלות layout במעבר מ-portrait
- [ ] 1440 × 900 (desktop) — top nav מלא, אין bottom nav

### RTL / Hebrew specifics

- [ ] כל הטקסטים בעברית RTL נכון; אין LTR-bleed
- [ ] מספרים, ציונים, אחוזים — `dir="ltr"` או `bidi-ltr` בתוך טקסט עברי
- [ ] תאריכים — שעון IL, פורמט "יום ה׳, 11 ביוני, 22:00" (אחיד ל‑7 ימי השבוע, כולל שבת)
- [ ] אייקונים שיש להם זוגות (◀ / ▶ chevron) — מתהפכים נכון ב‑RTL
- [ ] טפסים — placeholder ועמודות RTL נכון; ה‑input dir צריך להיות auto/ltr על שדות מספריים

### Browser compatibility

- [ ] **Chrome מק/Windows** (האחרון) — baseline שלך
- [ ] **Safari macOS** — כתב טאבים, focus rings, dvh vs vh במודאלים
- [ ] **Firefox** — flexbox quirks
- [ ] **Edge** — בעיקרון Chromium, פספוס תכופים נדיר
- [ ] **iPhone Safari אמיתי** — autoplay, autofocus, scroll bouncing, install-as-PWA
- [ ] **Android Chrome אמיתי** — back button behavior, PWA install banner

### PWA

- [ ] manifest.webmanifest טוען בלי 404
- [ ] icons בכל הגדלים נראים
- [ ] באייפון "add to home screen" → אייקון יפה, splash screen מהונדס, פותח full-screen בלי URL bar
- [ ] באנדרואיד "install app" → אותו דבר
- [ ] service worker רשום (devtools → Application → Service Workers)

### Performance feel

- [ ] Lighthouse mobile, /he → Performance ≥ 80, Accessibility ≥ 95
- [ ] FCP ≤ 1.5s על Fast 3G
- [ ] בלחיצה על כל הימור — ה‑transitional state ("שומר") מופיע תוך 100ms, לא יותר
- [ ] navigation בין /he/bets ↔ /he → instant feel (prefetch עובד)
- [ ] ה‑bank pill לא "קופץ" אחרי טעינה — skeleton ב‑Suspense משאיר את ה‑slot

---

## שלב 4 — Pre-flight (10/6 בערב, לפני 11/6 צהריים)

### Final go/no-go

- [ ] `pnpm qa-agent all` על פרוד — לוודא 0C/0H
- [ ] manual smoke (שלב 1 כאן) על פרוד — 100% ירוק
- [ ] לוודא שכל המשתמשים אושרו ושלא יש תקועים ב‑pending
- [ ] לוודא ש‑settings פרוד מסונכרן עם sandbox (`/he/admin/sandbox` push settings)
- [ ] לוודא שה‑fixtures של 48 משחקי שלב הבתים סנכרון מ‑API-Football (per memory: league=1, season=2026 — לא 15)
- [ ] לוודא ש‑deadline שלב הבתים פנימי טוב (5 דק לפני kickoff per match)
- [ ] לבדוק שאין error spike בלוגים של Vercel ב‑24 שעות האחרונות
- [ ] לבדוק שיש cron job פעיל לעדכון תוצאות מ‑API-Football
- [ ] להכריז לחברים "אנחנו עולים, פתוחים להרשמות" עם הקישור לפרוד

### Rollback plan

אם משהו קריטי נופל אחרי הפתיחה (משתמשים אמיתיים בפנים):
- [ ] לדעת איך לעצור הרשמות חדשות (`signup_pause` setting? או `/he/admin/settings`)
- [ ] לדעת איך לחזור לקומיט קודם בפרוד (Vercel rollback מ‑dashboard, ולא git push --force)
- [ ] לדעת איפה הלוגים של ה‑sandbox-to-prod push (אם פעלת לפני שעה והוא הביא משהו לא רצוי)

---

## איך לרשום ממצא

לכל בעיה שאתה מוצא, רשום:
1. **מסך/URL**: `/he/bets/...`
2. **תיאור קצר**: "כפתור שמור לא מגיב במשחק 4 של בית G"
3. **שחזור**: שלבים מינימליים לראות שוב
4. **viewport + browser**: "iPhone 13 Safari" / "Desktop Chrome 1440"
5. **devtools console**: copy-paste של שגיאות אם יש
6. **screenshot**: שמור ב‑`_screenshots/` עם תאריך

אחרי הסשן, עבור על הרשימה ותסווג: critical / high / medium / low. הקריטיים נכנסים לקומיט תיקון לפני 11/6, השאר לאחר-מועד.

---

## מקצוען-טיפס

- אל תבדוק "אם זה עובד" — נסה **לשבור** את זה. תקליק כפול מהיר, תרענן באמצע שמירה, תיכנס מטאב אחד, התנתק מטאב שני, נסה לעבוד עם offline אחרי שטענת.
- כל פעם שאתה רואה empty state — שאל "האם זה נכון שזה ריק עכשיו, או שמשהו לא נטען?"
- כל ויואפורט שאתה לא בודק = משתמש שעלול לראות חוויה שבורה ב‑11/6 בערב במונדיאל.
