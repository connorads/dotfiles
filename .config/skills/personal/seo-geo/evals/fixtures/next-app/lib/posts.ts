export type Post = { slug: string; title: string; excerpt: string; body: string[]; updated: string };

const POSTS: Post[] = [
  {
    slug: "how-to-make-a-staff-rota",
    title: "How to make a staff rota that people stick to",
    excerpt: "A step-by-step way to build a fair weekly rota for a café, bar or shop.",
    body: [
      "Start from demand, not from availability. Pull last month's busiest hours from your till and staff to those first.",
      "Publish the rota at least two weeks ahead. Late rotas are the most common reason staff give for leaving hospitality jobs.",
    ],
    updated: "2026-05-14",
  },
  {
    slug: "shift-swap-policy-template",
    title: "Shift swap policy template for hospitality teams",
    excerpt: "A one-page policy you can copy, with the approval rules we see work.",
    body: ["Swaps need a manager's approval when they change who holds a key or a licence on that shift."],
    updated: "2026-03-02",
  },
];

// Simulates the headless CMS round trip (slow API on the cheap plan).
export async function getPost(slug: string): Promise<Post | undefined> {
  await new Promise((r) => setTimeout(r, 2000));
  return POSTS.find((p) => p.slug === slug);
}

export function allPosts(): Post[] {
  return POSTS;
}
