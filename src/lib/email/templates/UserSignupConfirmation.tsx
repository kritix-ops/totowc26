import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "react-email";
import { styles } from "../styles";

type Props = {
  displayName: string;
};

export function UserSignupConfirmation({ displayName }: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>קיבלנו את בקשתך לטוטו מונדיאל</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>שלום {displayName} 👋</Heading>
          <Text style={styles.paragraph}>
            קיבלנו את הבקשה שלך להצטרף לטוטו מונדיאל. הבקשה ממתינה עכשיו לאישור
            של מנהל הקבוצה — נחזור אליך במייל ברגע שתאושר.
          </Text>
          <Text style={styles.paragraph}>
            אין צורך לעשות שום דבר נוסף בינתיים. אם הגעת לכאן בטעות, אפשר להתעלם
            מהמייל הזה.
          </Text>
          <Text style={styles.footer}>טוטו מונדיאל · בהצלחה</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default UserSignupConfirmation;
