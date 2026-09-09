import type { ImgHTMLAttributes } from "react";
import sellcaseLogo from "@assets/file_00000000564081f880671269e5e8513e_1788967488652.png";
import "@/brand-logo.css";

type SellCaseLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function SellCaseLogo({
  alt = "開賣啦 SellCase",
  className = "",
  ...props
}: SellCaseLogoProps) {
  return (
    <img
      src={sellcaseLogo}
      alt={alt}
      className={className}
      decoding="async"
      {...props}
    />
  );
}