import type { Metadata } from "next";
import { Inter } from "next/font/google";
import FaqSchema from "@/components/FaqSchema";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", adjustFontFallback: false });

export const metadata: Metadata = {
  title: { default: "Rotaly - Rota and shift scheduling software", template: "%s | Rotaly" },
  description:
    "Rotaly builds staff rotas in minutes, handles shift swaps and holiday requests, and sends hours straight to payroll. For hospitality and retail teams.",
  keywords: [
    "rota software",
    "staff rota app",
    "shift scheduling software",
    "best rota software",
    "employee scheduling",
    "free rota maker",
    "deputy alternative",
  ],
  openGraph: {
    title: "Rotaly - Rota and shift scheduling software",
    description: "Build rotas in minutes. Shift swaps, holiday requests and payroll export.",
    images: ["/og.png"],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

const orgGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://rotaly.io/#org",
      name: "Rotaly",
      url: "https://rotaly.io/",
      logo: "https://rotaly.io/logo.png",
      sameAs: [
        "https://www.linkedin.com/company/rotaly",
        "https://x.com/rotalyhq",
        "https://www.youtube.com/@rotaly",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://rotaly.io/#website",
      url: "https://rotaly.io/",
      name: "Rotaly",
      publisher: { "@id": "https://rotaly.io/#org" },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.className}>
      <head>
        <link rel="canonical" href="https://rotaly.io/" />
      </head>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgGraph) }} />
        <FaqSchema />
        <header className="site-header">
          <a href="/">Rotaly</a>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/blog/how-to-make-a-staff-rota">Blog</a>
          </nav>
        </header>
        {children}
        <footer>Rotaly Ltd, London. Registered in England and Wales.</footer>
      </body>
    </html>
  );
}
