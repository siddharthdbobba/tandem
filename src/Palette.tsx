import { useEffect, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
};

export function Palette({ open, onClose, commands }: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = commands.filter(({ label }) => words.every((word) => label.toLowerCase().includes(word)));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  if (!open) return null;

  const run = (command: Command) => {
    command.run();
    onClose();
  };

  const groups = matches.reduce<{ name?: string; commands: Command[] }[]>((all, command) => {
    const last = all[all.length - 1];
    const group = !last || last.name !== command.group
      ? { name: command.group, commands: [] }
      : last;
    if (group !== last) all.push(group);
    group.commands.push(command);
    return all;
  }, []);

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected((n) => Math.min(n + 1, matches.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected((n) => Math.max(n - 1, 0)); }
        if (event.key === "Enter" && matches[selected]) run(matches[selected]);
      }}>
        <input ref={input} className="palette__input" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} placeholder="Type a command or file name…" autoFocus />
        <div className="palette__list">
          {matches.length === 0 ? <p className="palette__empty">No matches</p> : groups.map(({ name, commands: group }) => (
            <section className="palette__group" key={name ?? "ungrouped"}>
              {name && <h2>{name}</h2>}
              {group.map((command) => {
                const index = matches.indexOf(command);
                return <button className={`palette__item ghost${index === selected ? " is-selected" : ""}`} key={command.id} onClick={() => run(command)}>
                  <span>{command.label}</span>{command.hint && <kbd>{command.hint}</kbd>}
                </button>;
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
