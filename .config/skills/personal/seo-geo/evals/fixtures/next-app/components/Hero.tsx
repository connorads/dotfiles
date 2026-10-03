import Image from "next/image";

export default function Hero() {
  return (
    <section className="hero">
      <Image src="/hero-rota.png" alt="A café manager building next week's rota on a tablet" width={2400} height={1350} loading="lazy" />
    </section>
  );
}
