import * as vscode from "vscode";

function getDateLocale(): string {
  const lang = vscode.env.language;
  return lang.startsWith("ru") ? "ru-RU" : "en-US";
}

export function formatDate(d: Date | undefined): string {
  if (!d) return "";
  const locale = getDateLocale();
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateRelative(d: Date | undefined): string {
  if (!d) return "";
  const locale = getDateLocale();
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) {
    return d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (days === 1) {
    return (
      vscode.l10n.t("date.yesterday") +
      " " +
      d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    );
  }
  if (days < 7) {
    return vscode.l10n.t("date.daysAgo", String(days));
  }
  return formatDate(d);
}
