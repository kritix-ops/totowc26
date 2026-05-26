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

// Sent to the opener when somebody else joins their open duel. The
// duel is now locked in (status='matched'); the opener can't change
// the question or pull the stake. This email is purely a heads-up so
// the opener knows the clock has started.

type Props = {
  openerName: string;
  joinerName: string;
  questionHe: string;
  questionEn: string;
  stake: number;
  duelUrl: string;
};

export function DuelJoinedEmail({
  openerName,
  joinerName,
  questionHe,
  questionEn,
  stake,
  duelUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>מישהו הצטרף לדו-קרב שלך</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>
            {openerName}, {joinerName} הצטרף לדו-קרב
          </Heading>
          <Text style={styles.paragraph}>
            השאלה: <strong>{questionHe}</strong>
          </Text>
          <Text style={styles.paragraph}>
            הסטייק של {stake} נקודות מכל צד ננעל בבנק עד שהדו-קרב יוכרע. מי
            שצדק לוקח את שניהם.
          </Text>

          <Section style={styles.buttonWrap}>
            <Link href={duelUrl} style={styles.button}>
              פתח את הדו-קרב
            </Link>
          </Section>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>
            English: {joinerName} accepted your duel — &quot;{questionEn}&quot;,{" "}
            {stake} pts per side. Winner takes both stakes.
          </Text>

          <Text style={styles.footer}>טוטו מונדיאל</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DuelJoinedEmail;
