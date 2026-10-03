import type { Metadata } from "next";
import { getPost } from "@/lib/posts";

// Always fresh from the CMS.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  return {
    title: post?.title ?? "Blog",
    description: post?.excerpt,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: { images: ["/og-blog.png"] },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    return (
      <main>
        <h1>Post not found</h1>
        <p>This post may have moved. Try the blog home.</p>
      </main>
    );
  }
  return (
    <main>
      <article>
        <h1>{post.title}</h1>
        <p>Updated {post.updated}</p>
        {post.body.map((para) => (
          <p key={para}>{para}</p>
        ))}
      </article>
    </main>
  );
}
