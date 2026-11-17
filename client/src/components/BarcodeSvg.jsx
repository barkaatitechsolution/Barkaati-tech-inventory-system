import { useMemo } from "react";
import { barcodeSvg } from "../lib/barcode.js";

export default function BarcodeSvg({
  value,
  height = 40,
  width = 1.4,
  fontSize = 10,
  displayValue = false,
  className = ""
}) {
  const html = useMemo(
    () => barcodeSvg(value, { height, width, fontSize, displayValue, margin: 0 }),
    [value, height, width, fontSize, displayValue]
  );

  if (!html) return null;

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
