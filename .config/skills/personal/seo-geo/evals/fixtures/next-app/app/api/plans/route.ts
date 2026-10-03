export async function GET() {
  return Response.json({
    plans: [
      { name: "Starter", gbpPerUser: 2.5, features: ["Rota builder", "Staff app", "Shift swaps"] },
      { name: "Pro", gbpPerUser: 4, features: ["Everything in Starter", "Clock in/out", "Payroll export"] },
      { name: "Multi-site", gbpPerUser: 5.5, features: ["Everything in Pro", "Cross-site cover", "Labour cost reports"] },
    ],
  });
}
