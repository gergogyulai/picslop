type Toast = { id: number; text: string; tone: "info" | "error" };

let seq = 0;
export const toasts = $state<Toast[]>([]);

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++seq;
  toasts.push({ id, text, tone });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 4200);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong.", "error");
