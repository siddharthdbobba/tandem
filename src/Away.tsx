import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Props = {
  workspaceId: Id<"workspaces">;
  readOnly: boolean;
  tourShowing: boolean;
  onOpenFile: (path: string) => void;
  onOpenChat: () => void;
};

export function Away({ workspaceId, readOnly, tourShowing, onOpenFile, onOpenChat }: Props) {
  const key = `tandem-seen-${workspaceId}`;
  const [since] = useState(() => {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [dismissed, setDismissed] = useState(false);
  const activity = useQuery(api.away.since, since && !readOnly ? { workspaceId, since } : "skip");

  useEffect(() => {
    const save = () => localStorage.setItem(key, String(Date.now()));
    const visibility = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      save();
    };
  }, [key]);

  if (!since || readOnly || tourShowing || dismissed || !activity) return null;
  if (!activity.fileCount && !activity.runs && !activity.messages) return null;
  return (
    <div className="away" role="status">
      <span>While you were away: </span>
      {activity.fileCount > 0 && <>
        <strong>{activity.lastEditor ?? "Someone"}</strong> edited {activity.files.map((path, i) => (
          <span key={path}>{i > 0 && ", "}<button type="button" className="ghost away__link" onClick={() => onOpenFile(path)}>{path}</button></span>
        ))}{activity.fileCount > activity.files.length && ` and ${activity.fileCount - activity.files.length} other file${activity.fileCount - activity.files.length === 1 ? "" : "s"}`}
      </>}
      {activity.runs > 0 && <span> · {activity.runs} AI run{activity.runs === 1 ? "" : "s"}</span>}
      {activity.messages > 0 && <span> · <button type="button" className="ghost away__link" onClick={onOpenChat}>{activity.messages} chat message{activity.messages === 1 ? "" : "s"}</button></span>}
      <button type="button" className="ghost away__dismiss" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}
