import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "AI Pipeline — Real Estate Deals",
  description: "Advanced AI real estate pipeline and underwriting platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      {/* suppressHydrationWarning prevents next/font className SSR/client mismatch */}
      <body suppressHydrationWarning className="bg-background text-foreground overflow-hidden">
        <div className={`${inter.className} h-screen w-full`}>
          {children}
        </div>
      </body>
    </html>
  );
}

