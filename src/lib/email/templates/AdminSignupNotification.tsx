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
  preview: string;
  heading: string;
  body: string;
  nameLabel: string;
  phoneLabel: string;
  emailLabel: string;
  buttonText: string;
  footer: string;
  // Real recipient data - never copy-editable.
  displayName: string;
  phone: string;
  email: string;
  adminUrl: string;
};

export function AdminSignupNotification({
  preview,
  heading,
  body,
  nameLabel,
  phoneLabel,
  emailLabel,
  buttonText,
  footer,
  displayName,
  phone,
  email,
  adminUrl,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>{body}</Text>

          <Section>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{nameLabel}</span>
              {displayName}
            </Text>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{phoneLabel}</span>
              <Link href={`tel:${phone}`} style={{ color: palette.primary }}>
                {phone}
              </Link>
            </Text>
            <Text style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{emailLabel}</span>
              <Link href={`mailto:${email}`} style={{ color: palette.primary }}>
                {email}
              </Link>
            </Text>
          </Section>

          <Section style={styles.buttonWrap}>
            <Link href={adminUrl} style={styles.button}>
              {buttonText}
            </Link>
          </Section>

          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default AdminSignupNotification;
