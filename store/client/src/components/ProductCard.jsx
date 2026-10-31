import { useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Plus } from "lucide-react";
import { Button } from "./Field";
import { fmtMoney } from "../lib/format";

const finalPrice = (p) => {
  const sp = Number(p.selling_price) || 0;
  const disc = Number(p.discount) || 0;
  const tax = Number(p.tax) || 0;
  const taxable = Math.max(0, sp - disc);
  return Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
};

export default function ProductCard({ product, onOpen, onAdd, storeClosed }) {
  const images = Array.isArray(product.images) ? product.images : [];
  const [imageIndex, setImageIndex] = useState(0);
  const price = finalPrice(product);
  const market = Number(product.market_price) || 0;
  const save = market > price ? market - price : 0;
  const image = images[Math.min(imageIndex, images.length - 1)];
  const hasGallery = images.length > 1;

  const scrollImage = (event, step) => {
    event.stopPropagation();
    setImageIndex((current) => (current + step + images.length) % images.length);
  };

  return (
    <div
      className="flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md"
      onClick={() => onOpen(product.id)}
    >
      <div className="group relative flex h-40 items-center justify-center bg-slate-50 sm:h-44">
        {image ? (
          <img
            src={image.url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-slate-300">
            <ImageIcon className="h-10 w-10" />
            <p className="mt-1 text-[10px] font-medium">No photo</p>
          </div>
        )}

        {hasGallery && (
          <>
            <button
              type="button"
              onClick={(event) => scrollImage(event, -1)}
              aria-label="Previous photo"
              className="absolute left-1.5 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-white hover:text-indigo-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(event) => scrollImage(event, 1)}
              aria-label="Next photo"
              className="absolute right-1.5 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-white hover:text-indigo-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white">
              {imageIndex + 1} / {images.length}
            </span>
          </>
        )}

        {save > 0 && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">
            Save {fmtMoney(save)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-slate-800">{product.name}</p>
        <p className="text-[11px] text-slate-400">
          {product.unit || "pcs"}
          {product.sku ? ` · ${product.sku}` : ""}
        </p>
        <div className="flex items-baseline gap-1.5">
          <p className="text-base font-bold text-indigo-700">{fmtMoney(price)}</p>
          {market > price && (
            <p className="text-xs text-slate-400 line-through">{fmtMoney(market)}</p>
          )}
        </div>
        <div className="mt-auto pt-2">
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onAdd(product);
            }}
            disabled={storeClosed}
            title={storeClosed ? "The online store is currently closed." : undefined}
            className="w-full !py-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add to cart
          </Button>
        </div>
      </div>
    </div>
  );
}
