import cities from "@/data/cities.json";

export default function Home() {
  const clinics = cities.filter((c) => c.hasPremises);
  return (
    <main>
      <h1>Friendly dentists across Yorkshire</h1>
      <p>12 clinics, NHS and private, with evening and Saturday appointments at most sites.</p>
      <h2>Find your nearest clinic</h2>
      <ul>
        {clinics.map((c) => (
          <li key={c.slug}>
            <a href={`/locations/${c.slug}`}>{c.city}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
