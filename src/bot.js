// file: src/bot.js
import 'dotenv/config';
import { Client, GatewayIntentBits, MessageFlags, AttachmentBuilder } from 'discord.js';
import {
    ensureStore,
    addTask,
    listTasks,
    setTaskStatus,
    assignTask,
    removeTask,
    setTaskCategory,
} from './store.js';

const { DISCORD_TOKEN, ANNOUNCE_CHANNEL_ID, TEAM_ROLE_ID } = process.env;

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- emojis ----------
const STATUS_EMO = { done: '✅', doing: '⏳', todo: '⚠️', cancel: '❌' };
const USER_EMO = '👤';

// ---------- helpers ----------
function getStorageId(itx) {
    // 🔄 แยกงานตาม thread: ถ้าอยู่ใน thread จะใช้ threadId (ซึ่งก็คือ itx.channelId)
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
async function fetchCategories(storageId) {
    const items = await listTasks(storageId, { status: 'all' });
    const s = new Set(items.map(t => (t.category || 'general')));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'th'));
}

const giftRounds = new Map();

/** ดึง/สร้างรอบจับฉลากของช่องนี้ */
function getGiftRound(storageId) {
    let round = giftRounds.get(storageId);
    if (!round) {
        round = { closed: false, wishes: [] };
        giftRounds.set(storageId, round);
    }
    return round;
}

/** helper random จาก array */
function randomPick(arr) {
    if (!arr.length) return null;
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx];
}

// ---------- commands ----------

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
                        type: 3, name: 'status', description: 'todo | doing | done | cancel | all', required: false,
                        choices: ['todo', 'doing', 'done', 'cancel', 'all'].map(v => ({ name: v, value: v }))
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
                        choices: ['todo', 'doing', 'done', 'cancel'].map(v => ({ name: v, value: v }))
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
            },
            // 👇 ใหม่: ย้ายงานจาก parent channel → thread ปัจจุบัน
            {
                type: 1, name: 'migrate_from_parent', description: 'Copy tasks from parent channel to this thread',
                options: []
            }
        ]
    },
    {
        name: 'gift',
        description: 'Secret gift wish & random draw (per channel/thread)',
        options: [
            {
                type: 1,
                name: 'wish',
                description: 'ส่งความต้องการของขวัญ (1 คนต่อ 1 ความต้องการ)',
                options: [
                    {
                        type: 3,
                        name: 'text',
                        description: 'สิ่งที่อยากได้ เช่น ของแต่งโต๊ะทำงาน, ของใช้บนรถ ฯลฯ',
                        required: true
                    }
                ]
            },
            {
                type: 1,
                name: 'close',
                description: 'ปิดรอบ ไม่ให้เพิ่ม/แก้ wish ในช่องนี้',
                options: []
            },
            {
                type: 1,
                name: 'list',
                description: 'ดูรายการ wish ทั้งหมดในช่องนี้',
                options: [
                    {
                        type: 5,
                        name: 'public',
                        description: 'โพสต์ลงห้องแบบสาธารณะ',
                        required: false
                    }
                ]
            },
            {
                type: 1,
                name: 'draw',
                description: 'สุ่ม wish ที่ต้องไปซื้อ (ไม่ใช่ของตัวเองและไม่ซ้ำกัน)',
                options: []
            },
            {
                type: 1,
                name: 'reset',
                description: 'ล้างข้อมูลรอบจับฉลากในช่องนี้ (เริ่มใหม่)',
                options: []
            }
        ]
    }
];

// register
client.once('ready', async () => {
    try {
        await ensureStore();
        await client.application?.fetch();
        await client.guilds.fetch();

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
client.on('guildCreate', async (g) => {
    try {
        await g.commands.set(commands);
        console.log(`✅ Registered ${commands.length} commands to ${g.name} (${g.id}) [guildCreate]`);
    } catch (e) {
        console.error(`❌ Register failed for ${g?.name ?? g?.id}`, e?.rawError ?? e);
    }
});

// ---------- autocomplete ----------
client.on('interactionCreate', async (itx) => {
    try {
        if (!itx.isAutocomplete()) return;
        if (itx.commandName !== 'task') return;

        const focused = itx.options.getFocused(true);
        const storageId = getStorageId(itx);

        if (['category', 'new_category'].includes(focused.name)) {
            const all = await fetchCategories(storageId);
            const q = (focused.value || '').toString().toLowerCase();
            const filtered = all.filter(c => c.toLowerCase().includes(q)).slice(0, 25);
            const resp = (filtered.length ? filtered : ['general']).map(c => ({ name: c, value: c }));
            await itx.respond(resp);
            return;
        }
        await itx.respond([]);
    } catch (e) {
        console.error('autocomplete error:', e);
    }
});

// ---------- handlers ----------
// ---------- handlers ----------
client.on('interactionCreate', async (itx) => {
    try {
        if (!itx.isChatInputCommand()) return;

        // -------------------- /task --------------------
        if (itx.commandName === 'task') {
            const sub = itx.options.getSubcommand();

            // list: เคารพ public:true
            if (sub === 'list') {
                const isPublic = itx.options.getBoolean('public') === true;
                await itx.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

                const storageId = getStorageId(itx);
                const status = itx.options.getString('status') ?? 'all';
                const category = (itx.options.getString('category') || '').trim();

                const tasks = await listTasks(storageId, { status, category: category || undefined });

                let output = '';
                if (!category) {
                    const groups = tasks.reduce((m, t) => {
                        const k = t.category || 'general';
                        (m[k] = m[k] || []).push(t);
                        return m;
                    }, {});
                    const cats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th'));
                    output = cats.map(cat => {
                        const lines = groups[cat].map(t => {
                            const icon = STATUS_EMO[t.status] ?? '•';
                            const who = t.assigneeId ? ` ${USER_EMO} <@${t.assigneeId}>` : '';
                            const note = t.note ? ` — ${t.note}` : '';
                            return `- [#${t.id}] **${t.title}** — ${icon} _${t.status}_${who}${note}`;
                        }).join('\n');
                        return `**/${cat}**\n${lines}`;
                    }).join('\n\n');
                    if (!output) output = '— ไม่มีงานในรายการ —';
                } else {
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

                    if (output.length > 8000) {
                        const file = new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: `tasks_${status}_${category || 'all'}.txt` });
                        await itx.channel.send({ content: 'รายการยาว ส่งเป็นไฟล์แนบเพิ่มเติม:', files: [file] });
                    }
                } else {
                    await itx.editReply(headerText);
                    for (let i = 1; i < chunks.length; i++) {
                        await itx.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
                    }
                    if (output.length > 8000) {
                        const file = new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: `tasks_${status}_${category || 'all'}.txt` });
                        await itx.followUp({ content: 'รายการยาว ส่งเป็นไฟล์แนบเพิ่มเติม:', files: [file], flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            // sub อื่น ๆ ตอบสาธารณะปกติ
            await itx.deferReply();

            const storageId = getStorageId(itx);

            if (sub === 'add') {
                const title = itx.options.getString('title', true);
                const category = itx.options.getString('category') ?? 'general';
                const note = itx.options.getString('note') ?? '';
                const id = await addTask(storageId, { title, note, authorId: itx.user?.id || 'unknown', category });
                await itx.editReply(`📝 เพิ่มงาน: **${title}** (#${id}) — _/${category}_`);
                return;
            }

            if (sub === 'set') {
                const titleOrId = getTitleOrId(itx);
                if (!titleOrId) return await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                const status = itx.options.getString('status', true);
                await setTaskStatus(storageId, titleOrId, status);
                await itx.editReply(`🔄 อัปเดตสถานะ **${titleOrId}** → ${STATUS_EMO[status] ?? ''} _${status}_`);
                const rolePing = TEAM_ROLE_ID ? `<@&${TEAM_ROLE_ID}> ` : '';
                await postAnnouncement(`${rolePing}📌 **${titleOrId}** is now ${STATUS_EMO[status] ?? ''} _${status}_. (by <@${itx.user?.id}>)`);
                return;
            }

            if (sub === 'assign') {
                const titleOrId = getTitleOrId(itx);
                if (!titleOrId) return await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                const user = itx.options.getUser('user', true);
                await assignTask(storageId, titleOrId, user.id);
                await itx.editReply(`👤 มอบหมายงาน **${titleOrId}** ให้ <@${user.id}>`);
                const rolePing = TEAM_ROLE_ID ? `<@&${TEAM_ROLE_ID}> ` : '';
                await postAnnouncement(`${rolePing}🧑‍💻 **${titleOrId}** assigned to <@${user.id}> (by <@${itx.user?.id}>)`);
                return;
            }

            if (sub === 'remove') {
                const titleOrId = getTitleOrId(itx);
                if (!titleOrId) return await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                await removeTask(storageId, titleOrId);
                await itx.editReply(`❌ ลบงาน **${titleOrId}** แล้ว`);
                return;
            }

            if (sub === 'category') {
                const newCat = itx.options.getString('new_category', true);
                const id = itx.options.getInteger('id');
                const title = itx.options.getString('title');
                const titleOrId = id != null ? String(id) : title;
                if (!titleOrId) return await itx.editReply('⚠️ ต้องระบุอย่างน้อยหนึ่งอย่าง: `id` หรือ `title`');
                await setTaskCategory(storageId, titleOrId, newCat);
                await itx.editReply(`🗂️ เปลี่ยนหมวด **${titleOrId}** → _/${newCat}_`);
                return;
            }

            // 👇 เดิม: migrate งานจาก parent channel → thread นี้
            if (sub === 'migrate_from_parent') {
                if (!itx.channel?.isThread?.()) {
                    await itx.editReply('คำสั่งนี้ใช้ได้เฉพาะใน Thread');
                    return;
                }
                const parentId = itx.channel.parentId;
                const hereId = itx.channelId;

                const parentTasks = await listTasks(parentId, { status: 'all' });
                if (!parentTasks.length) {
                    await itx.editReply('ไม่พบงานที่ parent channel');
                    return;
                }
                let moved = 0;
                for (const t of parentTasks) {
                    const newId = await addTask(hereId, {
                        title: t.title,
                        note: t.note ?? '',
                        authorId: t.authorId ?? itx.user.id,
                        category: t.category ?? 'general'
                    });
                    if (t.assigneeId) await assignTask(hereId, String(newId), t.assigneeId);
                    if (t.status && t.status !== 'todo') await setTaskStatus(hereId, String(newId), t.status);
                    moved++;
                }
                await itx.editReply(`ย้ายงานจาก parent → thread นี้แล้ว ${moved} รายการ`);
                return;
            }

            await itx.editReply('⚠️ คำสั่งไม่รู้จัก');
            return;
        }

        // -------------------- /gift --------------------
        if (itx.commandName === 'gift') {
            const sub = itx.options.getSubcommand();
            const storageId = getStorageId(itx);

            // /gift wish
            if (sub === 'wish') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const round = getGiftRound(storageId);
                if (round.closed) {
                    await itx.editReply('รอบนี้ปิดรับความต้องการแล้วนะครับ');
                    return;
                }

                const text = (itx.options.getString('text', true) || '').trim();
                if (!text) {
                    await itx.editReply('ขอให้กรอกข้อความความต้องการด้วยครับ');
                    return;
                }

                const userId = itx.user.id;
                let wish = round.wishes.find(w => w.authorId === userId);
                let isUpdate = false;

                if (!wish) {
                    const newId = (round.wishes.reduce((max, w) => Math.max(max, w.id), 0) || 0) + 1;
                    wish = { id: newId, text, authorId: userId, takenBy: null };
                    round.wishes.push(wish);
                } else {
                    wish.text = text;
                    isUpdate = true;
                }

                await itx.editReply(
                    isUpdate
                        ? `อัปเดตความต้องการของคุณเป็น:\n> ${text}`
                        : `บันทึกความต้องการของคุณแล้ว:\n> ${text}`
                );
                return;
            }

            // /gift close
            if (sub === 'close') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const round = getGiftRound(storageId);
                if (!round.wishes.length) {
                    await itx.editReply('ยังไม่มีใครส่งความต้องการเลย ปิดรอบไปก็ไม่มีอะไรให้จับนะครับ 😅');
                    return;
                }
                if (round.closed) {
                    await itx.editReply('รอบนี้ปิดรับอยู่แล้วครับ');
                    return;
                }
                round.closed = true;
                await itx.editReply(
                    `ปิดรอบเรียบร้อย ✅\nจำนวนความต้องการในช่องนี้: **${round.wishes.length}** รายการ\nทุกคนสามารถใช้ \`/gift draw\` เพื่อจับฉลากได้แล้ว`
                );
                return;
            }

            // /gift list
            if (sub === 'list') {
                const isPublic = itx.options.getBoolean('public') === true;
                await itx.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

                const round = getGiftRound(storageId);
                if (!round.wishes.length) {
                    await itx.editReply('ยังไม่มีรายการความต้องการในรอบนี้ครับ');
                    return;
                }

                const lines = round.wishes.map(w => {
                    const owner = `<@${w.authorId}>`;
                    const taker = w.takenBy ? ` → ถูกจับไปโดย <@${w.takenBy}>` : '';
                    return `- [#${w.id}] **${w.text}**${taker}`;
                }).join('\n');

                const statusText = round.closed ? 'ปิดรับแล้ว' : 'กำลังเปิดรับอยู่';
                const msg = `**Gift wish list (${statusText})**\n${lines}`;

                if (isPublic && itx.channel?.isTextBased?.()) {
                    await itx.editReply('โพสต์รายการ wish ลงห้องแล้วครับ');
                    await itx.channel.send(msg);
                } else {
                    await itx.editReply(msg);
                }
                return;
            }

            // /gift draw
            if (sub === 'draw') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const round = getGiftRound(storageId);
                const userId = itx.user.id;

                if (!round.closed) {
                    await itx.editReply('ยังไม่ปิดรอบเลยครับ ใช้ `/gift close` ก่อนค่อยจับฉลากได้');
                    return;
                }

                if (!round.wishes.length) {
                    await itx.editReply('ไม่มีความต้องการในรอบนี้ให้จับเลยครับ');
                    return;
                }

                // ถ้าเคยจับได้แล้ว แสดงของเดิม
                const already = round.wishes.find(w => w.takenBy === userId);
                if (already) {
                    await itx.editReply(
                        `คุณเคยจับได้แล้วนะครับ ในรอบนี้:\n` +
                        `คุณต้องไปหาของตามหัวข้อ: **<@${already.authorId}>** - \n> ${already.text}`
                    );
                    return;
                }

                // pool: wish ที่ไม่ใช่ของตัวเอง และยังไม่ถูกจับ
                const pool = round.wishes.filter(w => w.authorId !== userId && !w.takenBy);
                if (!pool.length) {
                    await itx.editReply('ไม่เหลือ wish ที่ไม่ใช่ของตัวเองให้จับแล้วครับ (หรือของคนอื่นโดนจับไปครบแล้ว)');
                    return;
                }

                const picked = randomPick(pool);
                picked.takenBy = userId;

                await itx.editReply(
                    `🎁 ผลสุ่มของคุณคือ:\n` +
                    `หาของตามตามหัวข้อ:\n> ${picked.text}\n\n` +
                    `เก็บข้อมูลนี้ไว้ดี ๆ นะครับ รอบนี้จะไม่สุ่มใหม่ให้แล้ว`
                );
                return;
            }

            // /gift reset
            if (sub === 'reset') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                if (!giftRounds.has(storageId)) {
                    await itx.editReply('ไม่มีข้อมูลรอบ gift ในช่องนี้อยู่แล้วครับ');
                    return;
                }
                giftRounds.delete(storageId);
                await itx.editReply('ล้างข้อมูลรอบ gift ของช่องนี้เรียบร้อย สามารถเริ่มใหม่ได้เลยด้วย `/gift wish`');
                return;
            }

            await itx.reply({ content: '⚠️ คำสั่ง /gift ไม่รู้จัก', flags: MessageFlags.Ephemeral });
            return;
        }

    } catch (err) {
        console.error('task/gift handler error:', err);
        if (itx.deferred || itx.replied) {
            await itx.editReply('⚠️ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง').catch(() => { });
        } else {
            await itx.reply({ content: '⚠️ เกิดข้อผิดพลาด', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
});


client.login(DISCORD_TOKEN);
