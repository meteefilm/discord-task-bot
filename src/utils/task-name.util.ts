import type { ClickUpTask } from "../types/clickup.type.js";

function normalizeToken(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

function getTagNames(task: ClickUpTask): string[] {
    const tags = task.tags ?? [];

    return [
        ...new Set(
            tags
                .map((tag) => {
                    if (typeof tag === "string") return tag.trim();

                    return String(tag.name ?? "").trim();
                })
                .filter(Boolean)
                .map(normalizeToken),
        ),
    ];
}

export function resolveProjectName(task: ClickUpTask): string {
    const listName = task.list?.name?.trim();
    const folderName = task.folder?.name?.trim();
    const spaceName = task.space?.name?.trim();

    if (listName) return normalizeToken(listName);
    if (folderName) return normalizeToken(folderName);
    if (spaceName) return normalizeToken(spaceName);

    return "GENERAL";
}

export function resolveTagName(task: ClickUpTask): string | null {
    const tags = getTagNames(task);

    if (tags.length !== 1) return null;

    return tags[0];
}

export function buildTaskName(task: ClickUpTask): string {
    const projectName = resolveProjectName(task);
    const tagName = resolveTagName(task);
    const currentName = task.name.trim();

    if (!currentName) {
        return tagName ? `${projectName}_${tagName}` : projectName;
    }

    const upper = currentName.toUpperCase();

    if (upper.startsWith(`${projectName}_`)) {
        return currentName;
    }

    return tagName
        ? `${projectName}_${tagName}_${currentName}`
        : `${projectName}_${currentName}`;
}