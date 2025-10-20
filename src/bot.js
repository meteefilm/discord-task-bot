// file: src/bot.js
import 'dotenv/config';
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
    ensureStore,
    addTask,
    listTasks,
    setTaskStatus,
    assignTask,
    removeTask,
    setTaskCategory,          // 👈 ต้องมีใน store.js ด้วย (ตามที่ส่งไว้ก่อนหน้า)
} from './store.js';

const { DISCORD_TOKEN, ANNOUNCE_CHANNEL_ID, TEAM_ROLE_ID } = process.env;

// safety logs
process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- emojis ----------
const STATUS_EMO = { done: '✅', doing: '⏳', todo: '⚠️' };
const USER_EMO = '👤';

// ---------- helpers ----------
function getStorageId(itx) {
    const ch = itx.channel;
    if (ch?.isThread?.()) return ch.parentId ?? itx.channelId;
    return itx.channelId;
}
function getTitleOrId(itx) {
    const id = itx.options.getInteger('id');
    const title = itx.options.getString('title');
    if (id != null) return String(id);
    if (title) return title;
    return null;
}
async function postAnnouncement(content) {
    if (!ANNOUNCE_CHANNEL_ID) return;
    try {
        const ch = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
        if (!ch) return;
        if (ch.isThread?.()) { try { await ch.join(); } catch { } }
        if (ch.isTextBased?.()) await ch.send(content);
    } catch (e) { console.error('announce error:', e); }
}
// ดึงรายชื่อ category ที่เคยใช้ใน channel นี้
async function fetchCategories(storageId) {
    const items = await listTasks(storageId, { status: 'all' });
    const s = new Set(items.map(t => (t.category || 'general')));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'th'));
}

// ---------- Slash Commands (เปิด autocomplete ให้ category) ----------
const commands = [
    {
        name: 'task',
        description: 'Manage task checklist (per channel/thread)',
        options: [
            {
                type: 1, name: 'add', description: 'Add task',
                options: [
                    { type: 3, name: 'title', description: 'Task title', required: true },
                    { type: 3, name: 'category', description: 'Category (e.g. Frontend, Backend)', required: false, autocomplete: true },
                    { type: 3, name: 'note', description: 'Note/detail', required: false }
                ]
            },
            {
                type: 1, name: 'list', description: 'List tasks',
                options: [
                    {
                        type: 3, name: 'status', description: 'todo | doing | done | all', required: false,
                        choices: ['todo', 'doing', 'done', 'all'].map(v => ({ name: v, value: v }))
                    },
                    { type: 3, name: 'category', description: 'Category (or all)', required: false, autocomplete: true },
                    { type: 5, name: 'public', description: 'Post to channel (visible to everyone)', required: false }
                ]
            },
            {
                type: 1, name: 'set', description: 'Update task status',
                options: [
                    {
                        type: 3, name: 'status', description: 'New status', required: true,
                        choices: ['todo', 'doing', 'done'].map(v => ({ name: v, value: v }))
                    },
                    { type: 4, name: 'id', description: 'Task ID', required: false },
                    { type: 3, name: 'title', description: 'Task title', required: false }
                ]
            },
            {
                type: 1, name: 'assign', description: 'Assign task',
                options: [
                    { type: 6, name: 'user', description: 'Member', required: true },
                    { type: 4, name: 'id', description: 'Task ID', required: false },
                    { type: 3, name: 'title', description: 'Task title', required: false }
                ]
            },
            {
                type: 1, name: 'category', description: 'Change task category',
                options: [
                    { type: 3, name: 'new_category', description: 'New category', required: true, autocomplete: true },
                    { type: 4, name: 'id', description: 'Task ID', required: false },
                    { type: 3, name: 'title', description: 'Task title', required: false }
                ]
            },
            {
                type: 1, name: 'remove', description: 'Delete task',
                options: [
                    { type: 4, name: 'id', description: 'Task ID', required: false },
                    { type: 3, name: 'title', description: 'Task title', required: false }
                ]
            }
        ]
    }
];

// ลงทะเบียนเป็น Guild Commands (เห็นทันที)
client.once('ready', async () => {
    try {
        await ensureStore();
        await client.application?.fetch();
        await client.guilds.fetch(); // เติม cache จาก API

        const guilds = [...client.guilds.cache.values()];
        console.log('🛰️ Guilds:', guilds.map(g => `${g.name} (${g.id})`).join(', ') || '[none]');

        for (const g of guilds) {
            await g.commands.set(commands);
            console.log(`✅ Registered ${commands.length} commands to ${g.name} (${g.id})`);
        }
        console.log(`✅ Logged in as ${client.user.tag}`);
    } catch (err) {
        console.error('READY ERROR:', err);
    }
});

// ลงคำสั่งทันทีเมื่อเชิญเข้าใหม่
client.on('guildCreate', async (g) => {
    try {
        await g.commands.set(commands);
        console.log(`✅ Registered ${commands.length} commands to ${g.name} (${g.id}) [guildCreate]`);
    } catch (e) {
        console.error(`❌ Register failed for ${g?.name ?? g?.id}`, e?.rawError ?? e);
    }
});

// ---------- Autocomplete: category / new_category ----------
client.on('interactionCreate', async (itx) => {
    try {
        if (!itx.isAutocomplete()) return;

        if (itx.commandName !== 'task') return;
        const focused = itx.options.getFocused(true); // { name, value }
        const storageId = getStorageId(itx);

        // เฉพาะ field category / new_category เท่านั้น
        if (['category', 'new_category'].includes(focused.name)) {
            const all = await fetchCategories(storageId);
            const q = (focused.value || '').toString().toLowerCase();
            const filtered = all.filter(c => c.toLowerCase().includes(q)).slice(0, 25);
            // อย่างน้อยมี 'general'
            const resp = (filtered.length ? filtered : ['general']).map(c => ({ name: c, value: c }));
            await itx.respond(resp);
            return;
        }

        // ถ้าไม่ใช่ field ที่รองรับ autocomplete
        await itx.respond([]);
    } catch (e) {
        console.error('autocomplete error:', e);
    }
});

// ---------- Slash handlers ----------
client.on('interactionCreate', async (itx) => {
    try {
        if (!itx.isChatInputCommand()) return;
        if (itx.commandName !== 'task') return;

        // ตอบสาธารณะ (อยากส่วนตัวให้ใส่ flags: Ephemeral)
        await itx.deferReply();

        const storageId = getStorageId(itx);
        if (!storageId) {
            await itx.editReply('⚠️ ไม่พบ channelId');
            return;
        }

        const sub = itx.options.getSubcommand();

        if (sub === 'add') {
            const title = itx.options.getString('title', true);
            const category = itx.options.getString('category') ?? 'general';
            const note = itx.options.getString('note') ?? '';
            const id = await addTask(storageId, { title, note, authorId: itx.user?.id || 'unknown', category });
            await itx.editReply(`📝 เพิ่มงาน: **${title}** (#${id}) — _/${category}_`);
            return;
        }

        if (sub === 'list') {
            const status = itx.options.getString('status') ?? 'all';
            const category = (itx.options.getString('category') || '').trim(); // ว่าง = all
            const isPublic = itx.options.getBoolean('public') === true;

            const tasks = await listTasks(storageId, { status, category: category || undefined });

            let output = '';
            if (!category) {
                // group by category
                const groups = tasks.reduce((m, t) => {
                    const k = t.category || 'general';
                    (m[k] = m[k] || []).push(t);
                    return m;
                }, {});
                const cats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th'));
                output = cats.map(cat => {
                    const lines = groups[cat].map(t => {
                        const icon = STATUS_EMO[t.status] ?? '•';
                        const who = t.assigneeId ? ` ${USER_EMO} 👤<@${t.assigneeId}>` : '';
                        const note = t.note ? ` — ${t.note}` : '';
                        return `- [#${t.id}] **${t.title}** — ${icon} _${t.status}_${who}${note}`;
                    }).join('\n');
                    return `**/${cat}**\n${lines}`;
                }).join('\n\n');
                if (!output) output = '— ไม่มีงานในรายการ —';
            } else {
                // single category
                const header = `**/${category}**`;
                const lines = tasks.length ? tasks.map(t => {
                    const icon = STATUS_EMO[t.status] ?? '•';
                    const who = t.assigneeId ? ` ${USER_EMO} <@${t.assigneeId}>` : '';
                    const note = t.note ? ` — ${t.note}` : '';
                    return `- [#${t.id}] **${t.title}** — ${icon} _${t.status}_${who}${note}`;
                }).join('\n') : '— ไม่มีงานในรายการ —';
                output = `${header}\n${lines}`;
            }

            const chunks = output.match(/[\s\S]{1,1800}/g) || ['— ไม่มีงานในรายการ —'];
            const headerText = `**Task List (${status}${category ? ` • ${category}` : ''})**\n${chunks[0]}`;

            if (isPublic && itx.channel?.isTextBased?.()) {
                await itx.editReply('โพสต์รายการลงห้องแล้วครับ');
                await itx.channel.send(headerText);
                for (let i = 1; i < chunks.length; i++) await itx.channel.send(chunks[i]);
            } else {
                await itx.editReply(headerText);
                for (let i = 1; i < chunks.length; i++) {
                    await itx.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
                }
            }
            return;
        }

        if (sub === 'set') {
            const titleOrId = getTitleOrId(itx);
            if (!titleOrId) {
                await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                return;
            }
            const status = itx.options.getString('status', true);
            await setTaskStatus(storageId, titleOrId, status);
            await itx.editReply(`🔄 อัปเดตสถานะ **${titleOrId}** → ${STATUS_EMO[status] ?? ''} _${status}_`);
            const rolePing = TEAM_ROLE_ID ? `<@&${TEAM_ROLE_ID}> ` : '';
            await postAnnouncement(`${rolePing}📌 **${titleOrId}** is now ${STATUS_EMO[status] ?? ''} _${status}_. (by <@${itx.user?.id}>)`);
            return;
        }

        if (sub === 'assign') {
            const titleOrId = getTitleOrId(itx);
            if (!titleOrId) {
                await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                return;
            }
            const user = itx.options.getUser('user', true);
            await assignTask(storageId, titleOrId, user.id);
            await itx.editReply(`👤 มอบหมายงาน **${titleOrId}** ให้ <@${user.id}>`);
            const rolePing = TEAM_ROLE_ID ? `<@&${TEAM_ROLE_ID}> ` : '';
            await postAnnouncement(`${rolePing}🧑‍💻 **${titleOrId}** assigned to <@${user.id}> (by <@${itx.user?.id}>)`);
            return;
        }

        if (sub === 'remove') {
            const titleOrId = getTitleOrId(itx);
            if (!titleOrId) {
                await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                return;
            }
            await removeTask(storageId, titleOrId);
            await itx.editReply(`❌ ลบงาน **${titleOrId}** แล้ว`);
            return;
        }

        if (sub === 'category') {
            const newCat = itx.options.getString('new_category', true);
            const id = itx.options.getInteger('id');
            const title = itx.options.getString('title');
            const titleOrId = id != null ? String(id) : title;
            if (!titleOrId) {
                await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                return;
            }
            await setTaskCategory(storageId, titleOrId, newCat);
            await itx.editReply(`🗂️ เปลี่ยนหมวด **${titleOrId}** → _/${newCat}_`);
            return;
        }

        await itx.editReply('⚠️ คำสั่งไม่รู้จัก');
    } catch (err) {
        console.error('task handler error:', err);
        if (itx.deferred || itx.replied) {
            await itx.editReply('⚠️ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง').catch(() => { });
        } else {
            await itx.reply({ content: '⚠️ เกิดข้อผิดพลาด', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
});

client.login(DISCORD_TOKEN);
