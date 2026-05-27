import { GenericPageSkeleton } from "@/components/PageSkeleton";

// Catches client-side navigation into ANY route under [lang]/ that does
// not have its own loading.tsx. Subroutes that need a tailored shape
// (the dashboard, the picks list) override this. Showing this skeleton
// the instant the link is clicked is what unlocks partial prefetching:
// Next.js prefetches the shell + skeleton ahead of time, then renders
// the real page over it on arrival.
export default function Loading() {
  return <GenericPageSkeleton />;
}
