const copyButtons = document.querySelectorAll("[data-copy]");

for (const button of copyButtons) {
  button.addEventListener("click", async () => {
    const target = button.getAttribute("data-copy");
    const source = target === null ? null : document.querySelector(target);
    const text = source?.textContent?.trim();
    if (text === undefined || text.length === 0) return;

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
      if (source instanceof HTMLElement) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(source);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }

    window.setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  });
}

/** @param {string} buttonSelector @param {string} navigationSelector */
function bindNavigationToggle(buttonSelector, navigationSelector) {
  const button = document.querySelector(buttonSelector);
  const navigation = document.querySelector(navigationSelector);
  if (button === null || navigation === null) return;

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
    navigation.toggleAttribute("data-open", !isOpen);
  });
}

bindNavigationToggle("[data-site-navigation-toggle]", "[data-site-navigation]");
bindNavigationToggle("[data-navigation-toggle]", "[data-navigation]");
