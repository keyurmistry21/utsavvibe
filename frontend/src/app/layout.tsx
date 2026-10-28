import type { Metadata } from "next";
import "./styles.css";
import "./fields.css";

export const metadata: Metadata = { title: "UtsavVibe", description: "Festive & devotional gifts" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* apply the saved field style before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: 'try{var s=localStorage.getItem("fieldStyle");if(s)document.documentElement.setAttribute("data-fields",s)}catch(e){}' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
