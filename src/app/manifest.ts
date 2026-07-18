import type { MetadataRoute } from "next";
import { MALL_NAME } from "@/lib/util";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: MALL_NAME + " — Maintenance",
    short_name: MALL_NAME,
    description: "Mall maintenance collection system",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6fb",
    theme_color: "#3b5bfd",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
