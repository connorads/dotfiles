import type { Metadata } from "next";
import cities from "@/data/cities.json";

export function generateStaticParams() {
  return cities.map((city: string) => ({ city: city.toLowerCase().replace(/ /g, "-") }));
}

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  const name = city.replace(/-/g, " ");
  return { title: `Best Rota Software in ${name}` };
}

export default async function CityPage({ params }: Props) {
  const { city } = await params;
  const name = city.replace(/-/g, " ");
  return (
    <main>
      <h1>Best Rota Software in {name}</h1>
      <p>
        Looking for the best rota software in {name}? Rotaly is the leading staff scheduling software for cafés,
        restaurants, bars and shops in {name}. Businesses in {name} trust Rotaly to build rotas, manage shift swaps
        and run payroll.
      </p>
    </main>
  );
}
