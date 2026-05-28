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
  preview: string;
  heading: string;
  costLabel: string;
  winLabel: string;
  lockedLabel: string;
  buttonText: string;
  englishParagraph: string;
  footer: string;
  // Real data - rendered inside the layout, never copy-editable.
  questionHe: string;
  gradingRuleHe: string;
  stake: number;
  payout: number;
  lockAtLabel: string;
  betUrl: string;
};

export function BetLockReminderEmail({
  preview,
  heading,
  costLabel,
  winLabel,
  lockedLabel,
  buttonText,
  englishParagraph,
  footer,
  questionHe,
  gradingRuleHe,
  stake,
  payout,
  lockAtLabel,
  betUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>
            <strong>{questionHe}</strong>
          </Text>
          <Text style={styles.muted}>{gradingRuleHe}</Text>
          <Text style={styles.fieldRow}>
            <span style={styles.fieldLabel}>{costLabel}</span>
            <strong>{stake}</strong>
            <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
            <span style={styles.fieldLabel}>{winLabel}</span>
            <strong>{payout}</strong>
            <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
            <span style={styles.fieldLabel}>{lockedLabel}</span>
            <strong>{lockAtLabel}</strong>
          </Text>

          <Section style={styles.buttonWrap}>
            <Link href={betUrl} style={styles.button}>
              {buttonText}
            </Link>
          </Section>

          <Text style={styles.fallbackLink}>{betUrl}</Text>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>{englishParagraph}</Text>

          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default BetLockReminderEmail;
