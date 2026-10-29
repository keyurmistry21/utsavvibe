import type { Metadata } from "next";
import "./styles.css";
import "./fields.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.STOREFRONT_URL || "http://localhost:5173"),
  title: "UtsavVibe",
  description: "Festive & devotional gifts",
  openGraph: { type: "website", siteName: "UtsavVibe" },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* apply the saved field style before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: 'var d=document.documentElement;try{d.setAttribute("data-fields",localStorage.getItem("fieldStyle.v2")||"filled")}catch(e){d.setAttribute("data-fields","filled")}' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
