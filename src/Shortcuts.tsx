// Keyboard shortcut cheat sheet, opened with "?" or from the command palette.
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const rows: [string, string][] = [
  [`${mod}K`, "Search commands and files"],
  [`${mod}B`, "Show or hide files"],
  ["Enter", "Send a prompt or chat message"],
  ["Shift+Enter", "New line"],
  [`${mod}S`, "Save the open file"],
  ["@ai", "In chat, hand the AI a task"],
  ["@name", "In chat, mention someone"],
  ["?", "This list"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="palette shortcuts">
        <div className="shortcuts__head"><h2>Shortcuts</h2><button className="ghost" autoFocus onClick={onClose} aria-label="Close">✕</button></div>
        <dl>
          {rows.map(([k, label]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{label}</dd></div>)}
        </dl>
      </div>
    </div>
  );
}
