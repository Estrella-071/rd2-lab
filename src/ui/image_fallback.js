/**
 * Attach reviewed fallback sources to images created by UI templates.
 * Keeping the handler in JavaScript lets the runtime CSP reject inline event
 * attributes without breaking a missing optional icon.
 */
export function installImageFallbacks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("img[data-fallback-src]").forEach((image) => {
    if (image.dataset.fallbackBound === "true") return;
    image.dataset.fallbackBound = "true";
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (!fallback || image.getAttribute("src") === fallback) return;
      image.setAttribute("src", fallback);
    }, { once: true });
  });
}
