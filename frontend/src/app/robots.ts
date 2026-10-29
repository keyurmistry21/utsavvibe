import type { MetadataRoute } from "next";
import { getSite } from "@/lib/store";
import { siteOrigin } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteOrigin((await getSite()).publicUrl);
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/*/cart", "/*/account", "/*/order/", "/p/", "/*?variant="] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
