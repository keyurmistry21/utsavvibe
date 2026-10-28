import type { Metadata } from "next";
import "./styles.css";
import "./fields.css";

export const metadata: Metadata = { title: "UtsavVibe", description: "Festive & devotional gifts" };

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
