// Small toast bus: anything can call toast.success / toast.error; <ToastHost> in the admin layout shows them.
export type ToastKind = "success" | "error" | "info";
export type ToastDetail = { id: number; kind: ToastKind; message: string };
let n = 0;
const send = (kind: ToastKind, message: string) => {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent<ToastDetail>("uv:toast", { detail: { id: ++n, kind, message } }));
};
export const toast = {
  success: (m: string) => send("success", m),
  error: (m: string) => send("error", m),
  info: (m: string) => send("info", m),
};
