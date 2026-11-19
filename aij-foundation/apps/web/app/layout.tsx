import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AIJ Foundation", description: "AIJ 独立底座工程入口" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
