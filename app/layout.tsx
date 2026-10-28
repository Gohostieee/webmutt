import type { Metadata } from "next";
import { Chakra_Petch } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { SharkBackground } from "@/components/shark-background";
import "./globals.css";

const silver = localFont({
  src: "./fonts/silver.ttf",
  variable: "--font-silver",
  weight: "500",
  style: "normal",
  display: "swap",
  // Normalize Silver's oversized descent: 1000 ascent / 200 descent per 1900 units.
  declarations: [
    { prop: "size-adjust", value: "175%" },
    { prop: "ascent-override", value: "52.63%" },
    { prop: "descent-override", value: "10.53%" },
    { prop: "line-gap-override", value: "0%" },
  ],
});

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra-petch",
  display: "swap",
});

export const metadata: Metadata = {
  title: "webmutt",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${silver.variable} ${chakraPetch.variable} h-full antialiased`}
    >
      <body className="relative isolate min-h-full flex flex-col">
        <Providers>
          <SharkBackground />
          {children}
        </Providers>
      </body>
    </html>
  );
}
