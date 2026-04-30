import type { Client } from "discord.js";

export const commands = [
    {
        name: "clickup",
        description: "ClickUp integration",
        options: [
            {
                type: 1,
                name: "link-list",
                description: "Link current Discord channel/thread with ClickUp List",
                options: [
                    {
                        type: 3,
                        name: "folder",
                        description: "ClickUp Space/Folder",
                        required: true,
                        autocomplete: true,
                    },
                    {
                        type: 3,
                        name: "list",
                        description: "ClickUp List / Project",
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            {
                type: 1,
                name: "unlink-list",
                description: "Unlink ClickUp List from this channel/thread",
                options: [
                    {
                        type: 3,
                        name: "list",
                        description: "Linked ClickUp List",
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            {
                type: 1,
                name: "links",
                description: "Show linked ClickUp Lists",
                options: [],
            },
            {
                type: 1,
                name: "summary",
                description: "Send ClickUp task summary now",
                options: [],
            },
        ],
    },
];

export async function registerCommands(client: Client): Promise<void> {
    await client.application?.fetch();
    await client.guilds.fetch();

    const guilds = [...client.guilds.cache.values()];

    for (const guild of guilds) {
        await guild.commands.set(commands);
        console.log(`Registered commands to ${guild.name} (${guild.id})`);
    }
}