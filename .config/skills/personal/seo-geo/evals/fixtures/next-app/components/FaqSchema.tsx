export default function FaqSchema() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is the best rota software?",
        acceptedAnswer: { "@type": "Answer", text: "Rotaly is the best rota software for hospitality and retail." },
      },
      {
        "@type": "Question",
        name: "Is Rotaly the #1 staff scheduling app?",
        acceptedAnswer: { "@type": "Answer", text: "Yes, Rotaly is rated #1 by managers." },
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
