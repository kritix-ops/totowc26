// One-off notification: emails the 2 users who already placed picks on
// the tournament-total bets that those bets were converted from
// closest-number guesses to 3-range buckets, and shows them the bucket
// that now represents their original guess. Manual run: this file is
// not invoked by any cron or app code path.

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM;
const REPLY_TO = 'yoav@kritix.io';

const recipients = [
  {
    email: 'matannavon7@gmail.com',
    name: 'מתן',
    changes: [
      { question: 'סך השערים במונדיאל', wasNumber: 270, nowRange: '265–295' },
      { question: 'סך הכרטיסים האדומים', wasNumber: 11,  nowRange: '8–13' },
    ],
  },
  {
    email: 'orkorn5@gmail.com',
    name: 'אור',
    changes: [
      { question: 'סך הכרטיסים האדומים', wasNumber: 17, nowRange: 'מעל 13' },
    ],
  },
];

function buildHtml({ name, changes }) {
  const rows = changes.map(c =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e6e1d8;text-align:right">${c.question}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e6e1d8;text-align:center;color:#7a6f5c">${c.wasNumber}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e6e1d8;text-align:center;font-weight:700">${c.nowRange}</td>
    </tr>`
  ).join('');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#fbf6eb;font-family:'Segoe UI',Arial,sans-serif;color:#231a13">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #ece6d9">
    <h1 style="font-size:20px;margin:0 0 12px 0">שלום ${name},</h1>
    <p style="line-height:1.6;margin:0 0 16px 0">
      עדכון קטן על הימור טורניר במונדיאל 2026 שכבר ניחשת בו.
    </p>
    <p style="line-height:1.6;margin:0 0 16px 0">
      ההימור היה במקור ניחוש למספר מדויק. שינינו אותו ל-3 טווחים קבועים, כי לפגוע במספר מדויק על פני 104 משחקים זה כמעט בלתי אפשרי. הניחוש שלך לא הולך לאיבוד: הוא הומר אוטומטית לטווח שמכיל אותו.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <thead>
        <tr style="background:#f3ede0">
          <th style="padding:8px 12px;text-align:right;font-weight:700">הימור</th>
          <th style="padding:8px 12px;text-align:center;font-weight:700;color:#7a6f5c">הניחוש שלך</th>
          <th style="padding:8px 12px;text-align:center;font-weight:700">הטווח שייצג אותך</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="line-height:1.6;margin:0 0 16px 0">
      אם הטווח מתאים לך, אין מה לעשות. אם בא לך לשנות את הבחירה לטווח אחר, אפשר להיכנס לדף הימורי הטורניר עד 28 ביוני 04:55 בבוקר (5 דקות לפני שריקת הפתיחה).
    </p>
    <p style="line-height:1.6;margin:0 0 8px 0">
      <a href="https://toto-mundial.vercel.app/he/bets/tournament" style="display:inline-block;background:#7c3a2e;color:#fff;text-decoration:none;padding:10px 20px;border-radius:24px;font-weight:700">לדף הימורי הטורניר</a>
    </p>
    <p style="line-height:1.6;margin:24px 0 0 0;font-size:13px;color:#7a6f5c">
      שאלות? תענה למייל הזה.
    </p>
    <p style="line-height:1.6;margin:8px 0 0 0;font-size:13px;color:#7a6f5c">— יואב, טוטו מונדיאל</p>
  </div>
</body></html>`;
}

const results = [];
for (const r of recipients) {
  const subject = 'טוטו מונדיאל: הימור הטורניר שלך הומר ל-3 טווחים';
  const html = buildHtml(r);
  const res = await resend.emails.send({
    from: FROM,
    to: r.email,
    replyTo: REPLY_TO,
    subject,
    html,
  });
  results.push({ to: r.email, name: r.name, ok: !res.error, id: res.data?.id ?? null, err: res.error?.message ?? null });
}
console.log(JSON.stringify(results, null, 2));
