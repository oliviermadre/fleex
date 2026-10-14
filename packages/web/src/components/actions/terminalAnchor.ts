/** Bottom of the desktop app's title bar (Electron draws it over the page), or 0 in a browser. */
export function titleBarBottom(): number {
  return document.getElementById('fleex-desktop-titlebar')?.getBoundingClientRect().bottom ?? 0;
}
