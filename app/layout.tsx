import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
    variable: "--font-sans", // 👈 matches your CSS
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "DocFlow Secure Upload Portal",
    description: "Secure mortgage document collection portal.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="en"
            className={`${inter.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">
                {children}
            </body>
        </html>
    );
}