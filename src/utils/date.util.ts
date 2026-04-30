export function formatDateTimeTH(value?: string | number | null): string {
    if (!value) return "-";

    const date = new Date(Number(value));

    if (Number.isNaN(date.getTime())) return "-";

    return new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}