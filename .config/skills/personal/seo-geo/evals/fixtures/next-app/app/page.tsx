import type { Metadata } from "next";
import Hero from "@/components/Hero";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <main>
      <Hero />
      <h1>Staff rotas in minutes, not Sunday evenings</h1>
      <p>
        Rotaly is rota and shift scheduling software for hospitality and retail teams. Managers build next
        week&apos;s rota from a template, staff swap shifts in the app with manager approval, and approved hours go
        straight to payroll.
      </p>
      <h2>What Rotaly does</h2>
      <ul>
        <li>Drag-and-drop rota builder with labour cost shown as you plan</li>
        <li>Shift swaps and open shifts, approved by a manager in one tap</li>
        <li>Holiday requests and allowance tracking</li>
        <li>Clock in and out on a shared tablet or the staff app</li>
        <li>Payroll export to Xero, Sage and BrightPay</li>
      </ul>
      <a href="/pricing">See pricing</a>
    </main>
  );
}
