// Shared inline style atoms for all transactional email templates.
//
// Why inline styles only: email clients (Gmail, Outlook, Apple Mail) strip
// <style> blocks and many ignore CSS classes. Inline styles are the only
// approach that renders consistently across every major client.
//
// Palette mirrors the app's Material-You scheme (see src/app/globals.css)
// so a Toto Mundial email feels visually continuous with the web app.

export const palette = {
  background: "#fff8f5",
  surface: "#ffffff",
  surfaceMuted: "#fcebe2",
  primary: "#a13217",
  onPrimary: "#ffffff",
  text: "#221a15",
  textMuted: "#58413c",
  outline: "#8c716b",
  outlineSoft: "#dfc0b8",
} as const;

export const styles = {
  body: {
    backgroundColor: palette.background,
    margin: 0,
    padding: 0,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    color: palette.text,
  },
  container: {
    backgroundColor: palette.surface,
    margin: "32px auto",
    padding: "32px 28px",
    maxWidth: "520px",
    borderRadius: "12px",
    border: `1px solid ${palette.outlineSoft}`,
  },
  heading: {
    color: palette.text,
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: 700,
    margin: "0 0 12px 0",
  },
  paragraph: {
    color: palette.text,
    fontSize: "16px",
    lineHeight: "24px",
    margin: "0 0 16px 0",
  },
  muted: {
    color: palette.textMuted,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0 0 12px 0",
  },
  button: {
    backgroundColor: palette.primary,
    color: palette.onPrimary,
    padding: "14px 28px",
    borderRadius: "999px",
    fontSize: "16px",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-block",
  },
  buttonWrap: {
    textAlign: "center" as const,
    margin: "24px 0",
  },
  fallbackLink: {
    color: palette.primary,
    fontSize: "13px",
    lineHeight: "18px",
    wordBreak: "break-all" as const,
    margin: "0 0 16px 0",
  },
  divider: {
    borderColor: palette.outlineSoft,
    margin: "20px 0",
  },
  footer: {
    color: palette.textMuted,
    fontSize: "12px",
    lineHeight: "18px",
    textAlign: "center" as const,
    margin: "24px 0 0 0",
  },
  // Property-value tile used in the admin notification email.
  fieldRow: {
    margin: "0 0 10px 0",
    fontSize: "15px",
    lineHeight: "22px",
  },
  fieldLabel: {
    color: palette.textMuted,
    fontWeight: 600,
    marginInlineEnd: "8px",
  },
} as const;
