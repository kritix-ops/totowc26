import "server-only";

// The wall-clock helper for server components.
//
// React's `react-hooks/purity` rule flags any direct `Date.now()` call
// in a component body because client-side render functions are meant to
// be pure (otherwise hydration mismatches and unstable React-19 re-render
// behaviour creep in). Server components render once per request, so
// reading the clock there is a different beast — it's an intentional
// impurity boundary that gives us "lockable" / "isEditable" decisions
// that depend on now-vs-kickoff.
//
// Routing every server-component clock read through this helper means:
//   1. The eslint-disable lives in one place, not eight; reviewers don't
//      have to evaluate the same rationale at every call site.
//   2. Future tightening (say, making "now" deterministic in tests via
//      an env override) is a one-line change here.
//   3. Grep for `serverNow(` to find every page whose render depends on
//      the wall clock — useful when thinking about cache headers.
//
// Returns the current epoch milliseconds. Callers wrap with `new Date()`
// when they need a Date instance.
//
// `import "server-only"` is what physically prevents this from leaking
// into a client component; the bundler errors loudly if it does.
//
// eslint-disable-next-line react-hooks/purity
export const serverNow = (): number => Date.now();
