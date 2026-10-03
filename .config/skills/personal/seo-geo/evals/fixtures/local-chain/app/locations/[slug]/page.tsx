import type { Metadata } from "next";
import { notFound } from "next/navigation";
import cities from "@/data/cities.json";

export function generateStaticParams() {
  return cities.filter((c) => c.hasPremises).map((c) => ({ slug: c.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const loc = cities.find((c) => c.slug === slug);
  return {
    title: `Dentist in ${loc?.city}`,
    description: `Looking for a dentist in ${loc?.city}? Northgate Dental ${loc?.city} offers check-ups, hygiene and emergency appointments.`,
    alternates: { canonical: `/locations/${slug}` },
  };
}

export default async function LocationPage({ params }: Props) {
  const { slug } = await params;
  const loc = cities.find((c) => c.slug === slug);
  if (!loc || !loc.clinic) notFound();
  const { city, clinic } = loc;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: `Northgate Dental - ${city}`,
    url: `https://northgatedental.co.uk/locations/${slug}`,
    telephone: clinic.phone,
    branchOf: { "@type": "Organization", name: "Northgate Dental" },
    address: {
      "@type": "PostalAddress",
      streetAddress: clinic.street,
      addressLocality: city,
      postalCode: clinic.postcode,
      addressCountry: "GB",
    },
    geo: { "@type": "GeoCoordinates", latitude: clinic.lat, longitude: clinic.lng },
    // Pulled from our Google Business Profile rating
    aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "1287" },
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1>Your friendly dentist in {city}</h1>
      <p>
        Looking for a dentist in {city}? Northgate Dental {city} is the leading dental practice for families in
        {" "}{city}. Patients in {city} trust our {city} team for check-ups, hygiene, whitening and emergency
        appointments. Whether you live in {city} or nearby, our {city} dentists are here to help.
      </p>
      <h2>Why choose Northgate Dental {city}?</h2>
      <ul>
        <li>Friendly, experienced dentists</li>
        <li>NHS and private treatment</li>
        <li>Emergency appointments available</li>
      </ul>
      <h2>Opening hours and booking</h2>
      <iframe
        src={`https://widgets.smilebook.app/clinic/${clinic.smilebookId}/hours-and-booking`}
        title="Opening hours and booking"
        width="100%"
        height="640"
      />
      <p>
        Rated 4.9 on Google. <a href="/">Back to all clinics</a>
      </p>
    </main>
  );
}
