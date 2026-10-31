import { useEffect } from "react";

const DEFAULT_TITLE = "Online Store — Barkaati Tech";
const DEFAULT_DESCRIPTION =
  "Browse the shop catalogue, add products to your cart and place your order online. Pay on delivery or pick it up from the shop.";

function setMeta(attribute, key, content) {
  let tag = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!content) {
    if (tag) tag.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

export function useSeo({ title, description, noindex = false } = {}) {
  useEffect(() => {
    const fullTitle = title ? `${title} — Barkaati Tech` : DEFAULT_TITLE;
    const text = description || DEFAULT_DESCRIPTION;

    document.title = fullTitle;
    setMeta("name", "description", text);
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", text);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:card", "summary");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", text);
    setMeta("name", "robots", noindex ? "noindex,nofollow" : "index,follow");
  }, [title, description, noindex]);
}
