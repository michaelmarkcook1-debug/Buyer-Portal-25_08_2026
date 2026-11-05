import type { MetadataRoute } from "next";

/* A pilot, not a public site: nothing here is for search engines, including
   while PUBLIC_ACCESS opens the buyer pages without sign-in. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
