import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const safeName = (name: string) => name.replace(/[^\w .-]/g, "_") || "workspace";

export function ExportButton({ workspaceId, name, code }: {
  workspaceId: Id<"workspaces">;
  name: string;
  code?: string;
}) {
  const convex = useConvex();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  const download = async () => {
    setSkipped([]);
    const { strToU8, zipSync } = await import("fflate"); // only needed when someone exports
    const files = await convex.query(api.files.tree, { workspaceId, code });
    setProgress({ done: 0, total: files.length });
    const zip: Record<string, Uint8Array> = {};
    const failed: string[] = [];
    let completed = 0;

    const add = async (file: typeof files[number]) => {
      try {
        const data = await convex.query(api.files.get, { workspaceId, path: file.path, code });
        if (!data) throw new Error("file not found");
        zip[`${safeName(name)}/${file.path}`] = data.url
          ? new Uint8Array(await (await fetch(data.url)).arrayBuffer())
          : strToU8(data.content);
      } catch {
        failed.push(file.path);
      } finally {
        completed++;
        setProgress({ done: completed, total: files.length });
      }
    };

    for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(add));
    const url = URL.createObjectURL(new Blob([zipSync(zip)], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName(name)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setSkipped(failed);
    setProgress(null);
  };

  return <>
    <button className="btn btn--ghost btn--sm" onClick={download} disabled={progress !== null}>
      {progress === null ? "Download as .zip" : `Zipping… ${progress.done}/${progress.total}`}
    </button>
    {skipped.length > 0 && <span>Skipped: {skipped.join(", ")}</span>}
  </>;
}
