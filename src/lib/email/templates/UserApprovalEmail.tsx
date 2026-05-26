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

type Props = {
  displayName: string;
  // Recovery link from Supabase admin.generateLink({ type: "recovery", ... }).
  // The registrant clicks once and lands on /he/set-password.
  recoveryUrl: string;
};

export function UserApprovalEmail({ displayName, recoveryUrl }: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>אושרת! ברוך הבא לטוטו מונדיאל</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>שלום {displayName}, אושרת!</Heading>
          <Text style={styles.paragraph}>
            הבקשה שלך לטוטו מונדיאל אושרה. לחץ על הכפתור כדי להגדיר סיסמה ולהתחיל
            להמר.
          </Text>

          <Section style={styles.buttonWrap}>
            <Link href={recoveryUrl} style={styles.button}>
              להגדרת סיסמה והתחברות
            </Link>
          </Section>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>אם הכפתור לא עובד, העתק את הקישור הבא:</Text>
          <Text style={styles.fallbackLink}>{recoveryUrl}</Text>

          <Text style={styles.footer}>טוטו מונדיאל · בהצלחה</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default UserApprovalEmail;
