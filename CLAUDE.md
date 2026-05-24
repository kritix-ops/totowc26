@AGENTS.md

# Project rules

## Responsive is a hard requirement, not a nice-to-have

Every screen, component, and interaction must work flawlessly on mobile.
This is the highest-traffic surface for a friends pool app (people checking
scores from their phone at a bar or on the couch), so mobile is the
primary canvas, not the fallback.

Concrete rules:
- Design and build mobile-first. Start with the smallest viewport and
  layer up breakpoints (`sm:`, `md:`, `lg:`). Never the reverse.
- Touch targets are at least 44x44px. Pills, chips, icon buttons all
  must meet this even on the smallest viewport.
- Test every change at 360px, 414px, 768px, 1024px, and 1440px before
  declaring it done. Take screenshots if the change is visual.
- No horizontal scroll on any viewport unless intentional (carousels).
  Watch for fixed widths, long Hebrew strings, raw phone numbers, and
  flexbox children that refuse to shrink.
- The mobile bottom nav covers the lower 80px. Always pad the bottom of
  `main` with `pb-24` so content does not hide beneath it. Use
  `pb-[env(safe-area-inset-bottom)]` where the nav itself is fixed.
- Sticky headers and bottom nav must respect iOS safe areas.
- Modals, sheets, and popovers must be full-width on mobile and never
  exceed `100dvh`. Use `dvh`, not `vh`, to handle the iOS URL bar.
- Tables turn into stacked cards under `md`. Never let a table cause
  horizontal scroll on mobile.
- Forms use a single column under `md`. Inputs are at least 48px tall
  with `font-size: 16px` to prevent iOS Safari zoom on focus.
- Carousels (horizontal scroll containers) must have `snap-x snap-mandatory`
  and a visible affordance that more content exists.
- Hover-only interactions are forbidden. Anything reachable by hover
  must also be reachable by tap.
- Images use `next/image` with `sizes` set per viewport so mobile users
  do not download desktop-sized assets.

When you finish a screen, the verification checklist is:
1. Open it at 360px width. Read every label. No clipping, no overlap.
2. Tap every interactive element with a finger-sized target.
3. Scroll the full page. Nothing fixed obscures content.
4. Switch to landscape on a phone-sized viewport. Still usable.

If any of these fail, the screen is not done.
