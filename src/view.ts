import { createContext, useContext } from "react";

// Viewing through a share link: queries carry the code; writes are swapped for a sign-in prompt.
export type View = { code?: string; readOnly: boolean };
export const ViewCtx = createContext<View>({ readOnly: false });
export const useView = () => useContext(ViewCtx);

// Sends a viewer to sign up, then back into this workspace as a member.
export const goJoin = (code?: string) => {
  if (code) sessionStorage.setItem("tandem-join", code);
  location.hash = "/signup";
};
