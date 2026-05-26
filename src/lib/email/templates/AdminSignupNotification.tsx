import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { palette, styles } from "../styles";

type Props = {
  displayName: string;
  phone: string;
  email: string;
  adminUrl: string;
};

export function AdminSignupNotification({
  displayName,
  phone,
  email,
  adminUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{`בקשת הרשמה חדשה - ${displayName}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>בקשת הרשמה חדשה</Heading>
          <Text style={styles.paragraph}>
            מישהו ביקש להצטרף לטוטו מונדיאל. הפרטים שהוגשו:
          </Text>

          <Section>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>שם:</span>
              {displayName}
            </Text>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>טלפון:</span>
              <Link href={`tel:${phone}`} style={{ color: palette.primary }}>
                {phone}
              </Link>
            </Text>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>מייל:</span>
              <Link href={`mailto:${email}`} style={{ color: palette.primary }}>
                {email}
              </Link>
            </Text>
          </Section>

          <Section style={styles.buttonWrap}>
            <Link href={adminUrl} style={styles.button}>
              לאישור הבקשה
            </Link>
          </Section>

          <Text style={styles.footer}>טוטו מונדיאל · הודעת מערכת</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default AdminSignupNotification;
