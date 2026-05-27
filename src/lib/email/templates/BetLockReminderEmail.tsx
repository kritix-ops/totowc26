import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { styles } from "../styles";

// Sent to a player N minutes before a custom bet they could still pick
// closes for picks. Only sent once per (bet, user, channel) - the cron
// pass writes a row to bet_reminder_sent on success so the next pass
// skips the user. See _plans/2026-05-28-lock-reminders.md.

type Props = {
  playerName: string;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  stake: number;
  payout: number;
  lockAtLabel: string;     // already-formatted "10:55, 11 ביוני"
  minutesRemaining: number; // approximate; for the headline
  betUrl: string;
};

export function BetLockReminderEmail({
  playerName,
  questionHe,
  questionEn,
  gradingRuleHe,
  gradingRuleEn,
  stake,
  payout,
  lockAtLabel,
  minutesRemaining,
  betUrl,
}: Props) {
  const headlineRemaining = formatRemainingHe(minutesRemaining);
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>תזכורת: הימור נסגר {headlineRemaining}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>
            {playerName}, ההימור נסגר {headlineRemaining}
          </Heading>
          <Text style={styles.paragraph}>
            <strong>{questionHe}</strong>
          </Text>
          <Text style={styles.muted}>{gradingRuleHe}</Text>
          <Text style={styles.fieldRow}>
            <span style={styles.fieldLabel}>עלות:</span>
            <strong>{stake}</strong>
            <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
            <span style={styles.fieldLabel}>זכייה:</span>
            <strong>{payout}</strong>
            <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
            <span style={styles.fieldLabel}>ננעל:</span>
            <strong>{lockAtLabel}</strong>
          </Text>

          <Section style={styles.buttonWrap}>
            <Link href={betUrl} style={styles.button}>
              פתח את ההימור
            </Link>
          </Section>

          <Text style={styles.fallbackLink}>{betUrl}</Text>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>
            English: bet <strong>&quot;{questionEn}&quot;</strong> locks{" "}
            in ~{minutesRemaining} minutes. Stake {stake}, payout {payout}.
            Rule: {gradingRuleEn}. Open: {betUrl}
          </Text>

          <Text style={styles.footer}>טוטו מונדיאל</Text>
        </Container>
      </Body>
    </Html>
  );
}

function formatRemainingHe(minutes: number): string {
  if (minutes <= 0) return "ברגעים אלה";
  if (minutes < 60) return `בעוד ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "בעוד שעה";
  return `בעוד ${hours} שעות`;
}

export default BetLockReminderEmail;
