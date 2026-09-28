import { Hono } from "hono";
import { nanoid } from "nanoid";

type Link = { url: string; createdAt: string; hits: number };

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("links: POST /api/links {url} to shorten"));

app.post("/api/links", async (c) => {
  const { url } = await c.req.json<{ url?: string }>();
  if (!url || !URL.canParse(url)) return c.json({ error: "invalid url" }, 400);
  const slug = nanoid(7);
  const link: Link = { url, createdAt: new Date().toISOString(), hits: 0 };
  await c.env.LINKS.put(slug, JSON.stringify(link));
  return c.json({ slug, short: new URL(`/${slug}`, c.req.url).href }, 201);
});

app.get("/api/links/:slug", async (c) => {
  const link = await c.env.LINKS.get<Link>(c.req.param("slug"), "json");
  return link ? c.json(link) : c.json({ error: "not found" }, 404);
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const link = await c.env.LINKS.get<Link>(slug, "json");
  if (!link) return c.notFound();
  c.executionCtx.waitUntil(c.env.LINKS.put(slug, JSON.stringify({ ...link, hits: link.hits + 1 })));
  return c.redirect(link.url, 302);
});

export default app;
