import type { Metadata } from "next";
import { Cormorant_Garamond, Nunito } from "next/font/google";
import "./globals.css";

const displaySerif = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const bodySans = Nunito({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "600"],
});

export const metadata: Metadata = {
  title: "Happy Anniversary",
  description: "A little something made with love.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f7e6df",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${displaySerif.variable} ${bodySans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
