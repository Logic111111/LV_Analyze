// Keyboard access to scrolling table wrappers (UI stage 1, WCAG 2.1.1). Pure, unit-tested in Node.

/** True when the element's content overflows it (beyond a 1 px rounding difference). */
export function needsTabStop({ scrollWidth, clientWidth, scrollHeight, clientHeight }) {
  return scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1;
}
