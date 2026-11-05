import type { ImgHTMLAttributes } from "react";
import "@/brand-logo.css";

type SellCaseLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function SellCaseLogo({
  alt = "開賣啦 SellCase",
  className = "",
  ...props
}: SellCaseLogoProps) {
  return (
    <img
      src="/sellcase-logo.png"
      alt={alt}
      className={className}
      decoding="async"
      {...props}
    />
  );
}