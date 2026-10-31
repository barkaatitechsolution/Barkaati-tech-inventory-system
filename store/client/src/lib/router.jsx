import { useEffect, useState } from "react";

const subscribers = new Set();

function normalize(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  return clean || "/";
}

function currentPath() {
  return normalize(window.location.pathname);
}

export function navigate(to, { replace = false } = {}) {
  const path = to.startsWith("/") ? to : `/${to}`;
  const next = normalize(path);
  if (next === currentPath()) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  subscribers.forEach((fn) => fn(next));
}

export function useRoute() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    subscribers.add(setPath);
    const onPop = () => {
      const next = currentPath();
      subscribers.forEach((fn) => fn(next));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      subscribers.delete(setPath);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return path;
}

export function matchRoute(path) {
  if (path === "/") return { name: "home" };
  if (path === "/cart") return { name: "cart" };
  if (path === "/track") return { name: "track" };
  if (path === "/order-success") return { name: "order-success" };
  const product = path.match(/^\/product\/(\d+)$/);
  if (product) return { name: "product", id: Number(product[1]) };
  return { name: "not-found" };
}

export function Link({ href, onClick, children, ...props }) {
  const handleClick = (event) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
