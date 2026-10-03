import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://northgatedental.co.uk"),
  title: { default: "Northgate Dental - Dentists in Leeds, York and Yorkshire", template: "%s | Northgate Dental" },
  description: "NHS and private dentists across Yorkshire. Check-ups, hygiene, implants, Invisalign and emergency appointments.",
};

const org = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://northgatedental.co.uk/#org",
  name: "Northgate Dental",
  url: "https://northgatedental.co.uk/",
  logo: "https://northgatedental.co.uk/logo.png",
  sameAs: ["https://www.facebook.com/northgatedental", "https://www.instagram.com/northgatedental"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
        <header>
          <a href="/">Northgate Dental</a>
          <nav>
            <a href="/locations">Our clinics</a>
            <a href="/treatments">Treatments</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
