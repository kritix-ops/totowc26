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
  preview: string;
  heading: string;
  questionLabel: string;
  body: string;
  buttonText: string;
  englishParagraph: string;
  footer: string;
  // Real data props - questionHe is bolded inside the body block.
  questionHe: string;
  duelUrl: string;
};

export function DuelJoinedEmail({
  preview,
  heading,
  questionLabel,
  body,
  buttonText,
  englishParagraph,
  footer,
  questionHe,
  duelUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>
            {questionLabel} <strong>{questionHe}</strong>
          </Text>
          <Text style={styles.paragraph}>{body}</Text>

          <Section style={styles.buttonWrap}>
            <Link href={duelUrl} style={styles.button}>
              {buttonText}
            </Link>
          </Section>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>{englishParagraph}</Text>

          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DuelJoinedEmail;
