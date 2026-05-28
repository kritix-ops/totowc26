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

// All copy comes pre-rendered from the sender (which reads it from the
// admin-editable dictionary via getEmailCopy + interpolate). The
// template is purely layout - no business logic, no slot substitution.

type Props = {
  preview: string;
  heading: string;
  body1: string;
  body2: string;
  footer: string;
};

export function UserSignupConfirmation({
  preview,
  heading,
  body1,
  body2,
  footer,
}: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>{body1}</Text>
          <Text style={styles.paragraph}>{body2}</Text>
          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default UserSignupConfirmation;
