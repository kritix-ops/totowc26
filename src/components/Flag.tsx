// Renders a real country flag image from the HatScripts/circle-flags set
// hosted on jsDelivr. Vector SVG (scales perfectly at any size), free, no
// auth, no rate limit. Solves the Windows fallback where flag emojis show as
// 2-letter regional indicators. England, Scotland, Wales get their proper
// national flags via the "gb-eng" / "gb-sct" / "gb-wls" subdivision codes.
//
// Usage: <Flag code="ENG" size={40} />
// On image error or unknown TLA, falls back to a styled badge with the TLA.

"use client";

import { useState } from "react";
import Image from "next/image";
import { clsx } from "clsx";

// FIFA 3-letter code → flag slug (ISO 3166-1 alpha-2, plus the regional
// subdivisions for UK home nations). Anything missing here renders as a
// text badge with the TLA.
const TLA_TO_SLUG: Record<string, string> = {
  // CONMEBOL
  ARG: "ar", BRA: "br", COL: "co", ECU: "ec", PAR: "py", URU: "uy", URY: "uy",
  BOL: "bo", CHI: "cl", PER: "pe", VEN: "ve",
  // CONCACAF
  USA: "us", MEX: "mx", CAN: "ca", CRC: "cr", PAN: "pa", HON: "hn",
  JAM: "jm", SLV: "sv", HAI: "ht", CUB: "cu", CUW: "cw", SUR: "sr",
  GUA: "gt", TRI: "tt",
  // UEFA
  GER: "de", FRA: "fr", ESP: "es", ITA: "it",
  ENG: "gb-eng", SCO: "gb-sct", WAL: "gb-wls", NIR: "gb-nir",
  NED: "nl", POR: "pt", BEL: "be", CRO: "hr", DEN: "dk", SUI: "ch",
  POL: "pl", AUT: "at", NOR: "no", TUR: "tr", UKR: "ua", CZE: "cz",
  SVK: "sk", SRB: "rs", ROU: "ro", HUN: "hu", FIN: "fi", SWE: "se",
  IRL: "ie", BIH: "ba", GRE: "gr", ISL: "is", ALB: "al",
  MKD: "mk", MNE: "me", SVN: "si", BLR: "by", EST: "ee", LTU: "lt",
  LVA: "lv", ARM: "am", GEO: "ge", AZE: "az", BUL: "bg", KOS: "xk",
  // AFC
  JPN: "jp", KOR: "kr", PRK: "kp", IRN: "ir", KSA: "sa", AUS: "au",
  IRQ: "iq", QAT: "qa", UAE: "ae", JOR: "jo", UZB: "uz", CHN: "cn",
  THA: "th", IDN: "id", VIE: "vn", LBN: "lb", SYR: "sy", BHR: "bh",
  OMA: "om", KUW: "kw", IND: "in", MAS: "my", TKM: "tm",
  // CAF
  MAR: "ma", SEN: "sn", NGA: "ng", EGY: "eg", ALG: "dz", TUN: "tn",
  CMR: "cm", GHA: "gh", CIV: "ci", RSA: "za", MLI: "ml", BFA: "bf",
  ZAM: "zm", ANG: "ao", CGO: "cg", COD: "cd", GAB: "ga", KEN: "ke",
  UGA: "ug", ETH: "et", CPV: "cv", BEN: "bj", MOZ: "mz", MAD: "mg",
  TAN: "tz", RWA: "rw", BDI: "bi", TOG: "tg", ZIM: "zw", NAM: "na",
  // OFC
  NZL: "nz", FIJ: "fj", PNG: "pg", SOL: "sb", VAN: "vu", TAH: "pf",
  NCL: "nc",
};

export function Flag({
  code,
  size = 32,
  rounded = "full",
  className,
}: {
  code: string;
  size?: number;
  rounded?: "full" | "md" | "sm" | "none";
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const slug = TLA_TO_SLUG[code.toUpperCase()];
  const widthPx = size;
  const radius =
    rounded === "full"
      ? "rounded-full"
      : rounded === "md"
        ? "rounded-md"
        : rounded === "sm"
          ? "rounded-sm"
          : "";

  if (!slug || errored) {
    return (
      <span
        aria-label={code}
        className={clsx(
          "inline-flex items-center justify-center bg-surface-variant text-on-surface-variant font-bold font-[family-name:var(--font-label)] tracking-wider text-[10px] border border-outline-variant",
          radius,
          className,
        )}
        style={{ width: widthPx, height: widthPx }}
      >
        {code.toUpperCase()}
      </span>
    );
  }

  // Circle-flags SVG, served from jsDelivr (CDN). Vector → sharp at any
  // size, single asset per country, no per-size variants needed.
  const src = `https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${slug}.svg`;

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center overflow-hidden shrink-0",
        // The HatScripts flags are already circular, so we don't need a
        // border/background. Keep the radius for non-default shapes.
        rounded === "full" ? "" : `bg-surface border border-outline-variant ${radius}`,
        className,
      )}
      style={{ width: widthPx, height: widthPx }}
      aria-label={code}
    >
      <Image
        src={src}
        width={widthPx}
        height={widthPx}
        alt=""
        // SVG vectors don't benefit from raster optimisation, and the
        // HatScripts set is already byte-tiny; skip the optimisation
        // pipeline so the image router doesn't add cold-start latency
        // here. lazy loading still applies via the default loading="lazy".
        unoptimized
        onError={() => setErrored(true)}
        style={{
          width: widthPx,
          height: widthPx,
          objectFit: rounded === "full" ? "contain" : "cover",
        }}
      />
    </span>
  );
}
