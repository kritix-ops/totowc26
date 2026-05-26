import { Newspaper } from "lucide-react";
import { Card } from "@/components/ui";
import type { Dictionary, Locale } from "../dictionaries";

// Placeholder for the future RSS news feed. Kept as a distinct tab from
// day one so the tab bar order stays stable once the real feed lands.

export function NewsTab({
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  return (
    <section className="flex justify-center py-6 md:py-10">
      <Card className="max-w-xl w-full p-8 md:p-10 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
          <Newspaper className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {dict.tournament.newsComingSoonTitle}
        </h2>
        <p className="text-sm md:text-base text-on-surface-variant leading-relaxed">
          {dict.tournament.newsComingSoonBody}
        </p>
      </Card>
    </section>
  );
}
