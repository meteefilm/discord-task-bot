import { promises as fs } from "fs";
import path from "path";

export interface UserMapping {
    clickupUserId: string;
    clickupName: string;

    discordUserId: string;
    discordName: string;

    mappedBy: string;
    mappedAt: string;
}

const FILE = path.join(process.cwd(), "data", "clickup-user-mappings.json");

async function ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(FILE), { recursive: true });

    try {
        await fs.access(FILE);
    } catch {
        await fs.writeFile(FILE, "[]");
    }
}

export async function getUserMappings(): Promise<UserMapping[]> {
    await ensureFile();

    const raw = await fs.readFile(FILE, "utf8");

    if (!raw.trim()) {
        await saveUserMappings([]);
        return [];
    }

    try {
        return JSON.parse(raw) as UserMapping[];
    } catch {
        await saveUserMappings([]);
        return [];
    }
}

async function saveUserMappings(mappings: UserMapping[]): Promise<void> {
    await ensureFile();
    await fs.writeFile(FILE, JSON.stringify(mappings, null, 2));
}

export async function upsertUserMapping(mapping: UserMapping): Promise<void> {
    const mappings = await getUserMappings();

    const index = mappings.findIndex(
        (item) => item.clickupUserId === mapping.clickupUserId,
    );

    if (index >= 0) {
        mappings[index] = mapping;
    } else {
        mappings.push(mapping);
    }

    await saveUserMappings(mappings);
}

export async function removeUserMappingByClickUpId(
    clickupUserId: string,
): Promise<boolean> {
    const mappings = await getUserMappings();

    const before = mappings.length;

    const next = mappings.filter(
        (item) => item.clickupUserId !== clickupUserId,
    );

    await saveUserMappings(next);

    return next.length !== before;
}

export async function findDiscordUserIdByClickUpUserId(
    clickupUserId: string | number,
): Promise<string | null> {
    const mappings = await getUserMappings();

    const found = mappings.find(
        (item) => item.clickupUserId === String(clickupUserId),
    );

    return found?.discordUserId ?? null;
}