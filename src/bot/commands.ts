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
            {
                type: 1,
                name: "cleanup",
                description: "Delete old SG bot summary/notification messages",
                options: [
                    {
                        type: 3,
                        name: "scope",
                        description: "Cleanup target",
                        required: false,
                        choices: [
                            {
                                name: "Current channel/thread",
                                value: "current",
                            },
                            {
                                name: "All linked channels/threads",
                                value: "all",
                            },
                        ],
                    },
                    {
                        type: 3,
                        name: "mode",
                        description: "What to delete",
                        required: false,
                        choices: [
                            {
                                name: "Old cleanup markers only",
                                value: "old-markers",
                            },
                            {
                                name: "All messages from this bot",
                                value: "all-bot-messages",
                            },
                        ],
                    },
                ],
            },
            {
                type: 1,
                name: "map-user",
                description: "Map ClickUp user with Discord user",
                options: [
                    {
                        type: 3,
                        name: "clickup_user",
                        description: "ClickUp User",
                        required: true,
                        autocomplete: true,
                    },
                    {
                        type: 3,
                        name: "discord_user",
                        description: "Discord User",
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            {
                type: 1,
                name: "unmap-user",
                description: "Remove ClickUp user mapping",
                options: [
                    {
                        type: 3,
                        name: "clickup_user",
                        description: "Mapped ClickUp User",
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            {
                type: 1,
                name: "user-maps",
                description: "Show ClickUp ↔ Discord user mappings",
                options: [],
            },
        ],
    },
];

export async function registerCommands(client: Client): Promise<void> {
    await client.application?.fetch();
    await client.guilds.fetch();

    const guilds = [...client.guilds.cache.values()];
    console.log(`Registering commands to ${guilds.length} guild(s)`);

    for (const guild of guilds) {
        await guild.commands.set(commands);
        console.log(`Registered commands to ${guild.name} (${guild.id})`);
    }
}

export function registerGuildCommandSync(client: Client): void {
    client.on("guildCreate", async (guild) => {
        try {
            await guild.commands.set(commands);
            console.log(`Registered commands to new guild ${guild.name} (${guild.id})`);
        } catch (error) {
            console.error(`Failed to register commands to new guild ${guild.name} (${guild.id})`, error);
        }
    });
}
