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
  preview: string;
  heading: string;
  body: string;
  buttonText: string;
  fallbackHint: string;
  footer: string;
  // Recovery link from Supabase admin.generateLink({ type: "recovery", ... }).
  // Stays a real prop (not a copy slot) - the URL is per-recipient and
  // must never be admin-editable.
  recoveryUrl: string;
};

export function UserApprovalEmail({
  preview,
  heading,
  body,
  buttonText,
  fallbackHint,
  footer,
  recoveryUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>{body}</Text>

          <Section style={styles.buttonWrap}>
            <Link href={recoveryUrl} style={styles.button}>
              {buttonText}
            </Link>
          </Section>

          <Hr style={styles.divider} />

          <Text style={styles.muted}>{fallbackHint}</Text>
          <Text style={styles.fallbackLink}>{recoveryUrl}</Text>

          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default UserApprovalEmail;
