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

// ---------- party games (in-memory per channel/thread) ----------
// g1: closest number (host sets secret + range)
// g2: closest to 50 but UNIQUE (cannot pick same number), closest wins
const gameRounds = new Map(); // key=storageId -> { g1:..., g2:... }

function getGameState(storageId) {
    let st = gameRounds.get(storageId);
    if (!st) {
        st = { g1: null, g2: null };
        gameRounds.set(storageId, st);
    }
    return st;
}

function ensureRound(st, key) {
    if (!st[key]) {
        st[key] = {
            hostId: null,
            active: false,
            closed: false,
            roundNo: 0,
            alive: new Set(),         // คนที่ยังอยู่ในทัวร์นาเมนต์
            answers: new Map(),       // userId -> number
            winners: [],              // userId[]
            lastResultText: '',
            // config
            min: 1,
            max: 100,
            secret: null,             // g1 only
            target: 50                // g2 only
        };
    }
    return st[key];
}

function isHost(round, userId) {
    return round.hostId && round.hostId === userId;
}

function formatMention(id) {
    return `<@${id}>`;
}

function pickTopClosest(guesses, target, topN) {
    // guesses: [{userId, value}]
    const sorted = [...guesses].sort((a, b) => {
        const da = Math.abs(a.value - target);
        const db = Math.abs(b.value - target);
        if (da !== db) return da - db;
        return a.value - b.value;
    });
    return sorted.slice(0, Math.max(1, topN));
}

function pickWinnersClosest(guesses, target) {
    // guesses: [{ userId, value }]
    if (!guesses.length) return [];
    const withDist = guesses.map(g => ({ ...g, dist: Math.abs(g.value - target) }));
    const minDist = Math.min(...withDist.map(x => x.dist));
    return withDist.filter(x => x.dist === minDist);
}

// ---------- game3: guess host mind ----------
const game3Rounds = new Map();

const G3_QUESTIONS = [
    { id: 1, q: 'ถ้าได้ของขวัญปีใหม่ 1 ชิ้น อยากได้อะไรสุด?', a: 'ของใช้จริงจัง', b: 'ของแต่งบ้าน/โต๊ะทำงาน', c: 'ของกิน', d: 'เงินสด/บัตรของขวัญ' },
    { id: 2, q: 'ถ้าออกทริปกับเพื่อน สิ่งที่ทำให้ทริปล่มมากที่สุดคือ?', a: 'ตื่นสาย', b: 'แผนเปลี่ยนบ่อย', c: 'เงินไม่พอ', d: 'ความเห็นไม่ตรงกัน' },
    { id: 3, q: 'ถ้าต้องติดเกาะ 3 วัน จะเลือกพกอะไรไป 1 อย่าง?', a: 'โทรศัพท์', b: 'มีดอเนกประสงค์', c: 'อาหาร', d: 'เพื่อนสักคน' },
    { id: 4, q: 'ถ้าโดนเรียกประชุมด่วน สิ่งแรกที่คิดคือ?', a: 'งานด่วนแน่ ๆ', b: 'ใครทำอะไรพลาด', c: 'ขี้เกียจ', d: 'ขอเลื่อน' },
    { id: 5, q: 'ถ้าได้หยุดงานแบบไม่แจ้งล่วงหน้า 1 วัน จะทำอะไร?', a: 'นอนยาว', b: 'เคลียร์ชีวิต', c: 'ออกไปเที่ยว', d: 'อยู่เฉย ๆ ไม่ทำอะไร' },
    { id: 6, q: 'ถ้าต้องทำงานถึงดึก สิ่งที่ช่วยพยุงชีวิตคือ?', a: 'กาแฟ', b: 'เพลง', c: 'ของกิน', d: 'แรงใจ' },
    { id: 7, q: 'ของขวัญแบบไหน “ไม่อยากได้แต่ต้องยิ้มรับ”?', a: 'แก้ว', b: 'เสื้อไซส์ไม่พอดี', c: 'ของตกแต่งแปลก ๆ', d: 'ของที่ไม่รู้จะใช้ยังไง' },
    { id: 8, q: 'ถ้าวันหยุดทั้งวัน สิ่งที่อยากทำที่สุด?', a: 'นอน', b: 'ดูหนัง/ซีรีส์', c: 'เล่นเกม', d: 'ออกไปข้างนอก' },
    { id: 9, q: 'ถ้าต้องเลือกกินอย่างเดียว 1 เดือน?', a: 'หมูกระทะ', b: 'ก๋วยเตี๋ยว', c: 'ข้าวกล่อง', d: 'ฟาสต์ฟู้ด' },
    { id: 10, q: 'ถ้าเพื่อนพิมพ์มาว่า “เดี๋ยวเล่าให้ฟัง” แต่หายไปทั้งวัน สิ่งที่คิดคือ?', a: 'ลืม', b: 'ยังไม่อยากเล่า', c: 'เรื่องใหญ่', d: 'ช่างมัน เดี๋ยวก็รู้' },
    { id: 11, q: 'เวลาว่าง ๆ คุณชอบไปที่ไหนมากที่สุด?', a: 'คาเฟ่ / ร้านกาแฟ', b: 'ห้าง / ที่เดินเล่น', c: 'อยู่บ้าน', d: 'ที่ธรรมชาติ / ต่างจังหวัด' },
    { id: 12, q: 'เวลาเลือกของขวัญให้คนอื่น สิ่งที่คิดมากที่สุดคือ?', a: 'เขาจะชอบไหม', b: 'ราคาแพงไปไหม', c: 'มันดูตั้งใจพอหรือยัง', d: 'เอาอะไรก็ได้แหละ' },
    { id: 13, q: 'ประเทศที่อยากไปมากที่สุดในปีนี้?', a: 'ญี่ปุ่น', b: 'เกาหลี', c: 'ยุโรป', d: 'เที่ยวในประเทศก็พอ' },
    { id: 14, q: 'สิ่งที่อยาก “เลิกทำ” มากที่สุดในปีหน้า?', a: 'นอนดึก', b: 'ใช้เงินฟุ่มเฟือย', c: 'ผัดวันประกันพรุ่ง', d: 'คิดมาก' },
    { id: 15, q: 'สิ่งแรกที่คุณทำทันทีเมื่อหยิบโทรศัพท์ขึ้นมา คือ?', a: 'เช็กแชต', b: 'ไถโซเชียล', c: 'ดูเวลา', d: 'เปิดดูแจ้งเตือน' },
];

function getG3Round(storageId) {
    let r = game3Rounds.get(storageId);
    if (!r) {
        r = {
            hostId: null,
            roundNo: 0,
            active: false,
            closed: false,
            alive: null,          // Set(userId) or null
            currentQ: null,       // question object
            usedQ: new Set(),     // used question ids
            answers: new Map(),   // userId -> 'A'|'B'|'C'|'D'
            survivors: [],        // userId[] from last result
        };
        game3Rounds.set(storageId, r);
    }
    return r;
}

function formatMention(userId) {
    return `<@${userId}>`;
}

function randomPickQuestion(round) {
    const pool = G3_QUESTIONS.filter(x => !round.usedQ.has(x.id));
    const list = pool.length ? pool : G3_QUESTIONS; // ถ้าใช้ครบแล้ว เริ่มวนใหม่
    const picked = list[Math.floor(Math.random() * list.length)];
    round.usedQ.add(picked.id);
    return picked;
}

function choiceText(q, choice) {
    const c = (choice || '').toUpperCase();
    if (c === 'A') return q.a;
    if (c === 'B') return q.b;
    if (c === 'C') return q.c;
    if (c === 'D') return q.d;
    return '';
}

function isHost(round, userId) {
    return round.hostId && round.hostId === userId;
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
    , {
        name: 'g1',
        description: 'Game1: Closest Number (1-100)',
        options: [
            { type: 1, name: 'host', description: 'Set host for this channel/thread', options: [] },
            {
                type: 1, name: 'start', description: 'Start round (host only)',
                options: [
                    { type: 4, name: 'secret', description: 'Secret number (1-100)', required: true },
                ]
            },
            {
                type: 1, name: 'answer', description: 'Submit your guess (locked)',
                options: [{ type: 4, name: 'num', description: 'Your number', required: true }]
            },
            { type: 1, name: 'close', description: 'Close submissions (host only)', options: [] },
            { type: 1, name: 'result', description: 'Publish result (host only)', options: [] },
            { type: 1, name: 'nextround', description: 'Use winners as alive (host only)', options: [] },
            { type: 1, name: 'reset', description: 'Reset g1 (host only)', options: [] },
        ]
    }
    , {
        name: 'g2',
        description: 'Game2: Closest to 50 UNIQUE',
        options: [
            { type: 1, name: 'host', description: 'Set host for this channel/thread', options: [] },
            { type: 1, name: 'start', description: 'Start round (host only)', options: [] },
            {
                type: 1, name: 'answer', description: 'Submit your number (locked)',
                options: [{ type: 4, name: 'num', description: 'Your number', required: true }]
            },
            { type: 1, name: 'close', description: 'Close submissions (host only)', options: [] },
            { type: 1, name: 'result', description: 'Publish result (host only)', options: [] },
            { type: 1, name: 'nextround', description: 'Use winners as alive (host only)', options: [] },
            { type: 1, name: 'reset', description: 'Reset g2 (host only)', options: [] },
        ]
    },
    {
        name: 'g3',
        description: 'Game3: Guess host mind (A/B/C/D)',
        options: [
            { type: 1, name: 'host', description: 'Set host for this channel/thread', options: [] },
            { type: 1, name: 'start', description: 'Start round (host only)', options: [] },
            {
                type: 1, name: 'answer', description: 'Submit your answer (locked)',
                options: [
                    {
                        type: 3, name: 'choice', description: 'A | B | C | D', required: true,
                        choices: ['A', 'B', 'C', 'D'].map(v => ({ name: v, value: v }))
                    }
                ]
            },
            { type: 1, name: 'close', description: 'Close submissions (host only)', options: [] },
            { type: 1, name: 'result', description: 'Reveal host answer and survivors (host only)', options: [] },
            { type: 1, name: 'nextround', description: 'Use survivors as alive (host only)', options: [] },
            { type: 1, name: 'reset', description: 'Reset g3 (host only)', options: [] },
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

        // -------------------- /g1 --------------------
        if (itx.commandName === 'g1') {
            const sub = itx.options.getSubcommand();
            const storageId = getStorageId(itx);

            const st = getGameState(storageId);
            const round = ensureRound(st, 'g1');

            // /g1 host
            if (sub === 'host') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                round.hostId = itx.user.id;
                await itx.editReply(`ตั้ง host เรียบร้อย: ${formatMention(round.hostId)}`);
                return;
            }

            // ต้องมี host ก่อน (ยกเว้น host command)
            if (!round.hostId) {
                await itx.reply({ content: 'ยังไม่มี host ใช้ `/g1 host` ก่อน', flags: MessageFlags.Ephemeral });
                return;
            }

            // /g1 start secret:xx  (host only)
            if (sub === 'start') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                const secret = itx.options.getInteger('secret', true);

                // ✅ ล็อกช่วง 1-100 ตายตัว
                round.min = 1;
                round.max = 100;

                if (secret < 1 || secret > 100) {
                    return await itx.editReply('secret ต้องอยู่ในช่วง 1-100');
                }

                // ถ้ายังไม่มี alive (รอบแรก) ให้ปล่อยว่างไว้ก่อน
                // รอบนี้ใครส่งคำตอบ = เข้ารอบนี้ได้
                // รอบถัดไปจะใช้ nextround คัดคน
                round.roundNo += 1;
                round.active = true;
                round.closed = false;
                round.secret = secret;
                round.answers = new Map();
                round.winners = [];
                round.lastResultText = '';

                await itx.editReply(`เริ่มรอบ G1 #${round.roundNo} แล้ว ✅ (ช่วง 1-100)`);

                if (itx.channel?.isTextBased?.()) {
                    await itx.channel.send(
                        `🎮 **G1 รอบ #${round.roundNo}**: เดาเลขช่วง **1-100**\n` +
                        `ส่งคำตอบด้วย \`/g1 answer num:<เลข>\`\n` +
                        `⛔ ส่งแล้วแก้ไม่ได้`
                    );

                    // ถ้าเป็นรอบต่อไป (มี alive) ให้บอกผู้เล่นที่เหลือ
                    if (round.alive?.size > 0) {
                        await itx.channel.send(`ผู้เล่นที่ยังอยู่: ${[...round.alive].map(formatMention).join(', ')}`);
                    }
                }
                return;
            }

            // /g1 answer num:xx  (everyone, locked)
            if (sub === 'answer') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                if (!round.active || round.closed) return await itx.editReply('ตอนนี้ยังไม่เปิดรับคำตอบ (หรือปิดแล้ว)');

                // ถ้ามี alive (หลัง nextround) จำกัดเฉพาะคนที่รอด
                if (round.alive?.size > 0 && !round.alive.has(itx.user.id)) {
                    return await itx.editReply('คุณตกรอบไปแล้ว รอบนี้เล่นไม่ได้ 😅');
                }

                if (round.answers.has(itx.user.id)) {
                    return await itx.editReply('คุณส่งคำตอบไปแล้ว แก้ไม่ได้ครับ');
                }

                const num = itx.options.getInteger('num', true);
                if (num < 1 || num > 100) {
                    return await itx.editReply('เลขต้องอยู่ในช่วง 1-100');
                }

                round.answers.set(itx.user.id, num);
                await itx.editReply(`ล็อกคำตอบของคุณแล้ว: **${num}** ✅`);
                return;
            }

            // /g1 close (host only)
            if (sub === 'close') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');

                round.closed = true;
                await itx.editReply(`ปิดรับคำตอบรอบ #${round.roundNo} แล้ว ✅`);
                return;
            }

            // /g1 result (host only) => winners = closest (tie allowed)
            if (sub === 'result') {
                await itx.deferReply(); // public reply by default
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');

                round.closed = true;

                const guesses = [...round.answers.entries()].map(([userId, value]) => ({ userId, value }));
                if (!guesses.length) {
                    await itx.editReply('ไม่มีใครส่งคำตอบเลย');
                    round.active = false;
                    return;
                }

                const winners = pickWinnersClosest(guesses, round.secret);
                round.winners = winners.map(w => w.userId);

                // ถ้ายังไม่เคยมี alive (รอบแรก) ให้ถือว่า "ผู้ส่งคำตอบทั้งหมด" เป็นผู้เข้าแข่งขันได้
                // แต่รอบต่อไปจะใช้ nextround เพื่อคัดจริง
                if (!round.alive) round.alive = new Set();
                if (round.alive.size === 0) {
                    // รอบแรก: ให้ทุกคนที่ส่งคำตอบถือว่าเป็นผู้เล่นเริ่มต้น (optional)
                    // ถ้าคุณไม่อยากให้แบบนี้ ให้คอมเมนต์บล็อกนี้ทิ้งได้
                    for (const g of guesses) round.alive.add(g.userId);
                }

                const lines = guesses
                    .sort((a, b) => {
                        const da = Math.abs(a.value - round.secret);
                        const db = Math.abs(b.value - round.secret);
                        if (da !== db) return da - db;
                        return a.value - b.value;
                    })
                    .map(g => `- ${formatMention(g.userId)} → **${g.value}** (ห่าง ${Math.abs(g.value - round.secret)})`)
                    .join('\n');

                const winnersText = winners.map(w => formatMention(w.userId)).join(', ');
                const msg =
                    `🏁 **G1 Result รอบ #${round.roundNo}**\n` +
                    `🔑 เฉลย: **${round.secret}**\n\n` +
                    `📋 คำตอบทั้งหมด:\n${lines}\n\n` +
                    `✅ ผู้ชนะรอบนี้ (${round.winners.length}): ${winnersText}\n` +
                    `➡️ host ใช้ \`/g1 nextround\` เพื่อเอาผู้ชนะไปต่อ`;

                round.lastResultText = msg;
                round.active = false;

                await itx.editReply(msg);
                return;
            }

            // /g1 nextround (host only) => alive = winners
            if (sub === 'nextround') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                if (!round.winners || !round.winners.length) {
                    return await itx.editReply('ยังไม่มีผู้ชนะจากรอบก่อน ใช้ `/g1 result` ก่อน');
                }

                round.alive = new Set(round.winners);
                round.winners = [];
                round.answers = new Map();
                round.closed = false;
                round.active = false;
                round.secret = null;

                const aliveText = [...round.alive].map(formatMention).join(', ');
                await itx.editReply(`ตั้งค่า NextRound แล้ว ✅ ผู้รอด: ${aliveText}`);

                if (itx.channel?.isTextBased?.()) {
                    await itx.channel.send(
                        `🎮 **G1 NextRound** ผู้รอด: ${aliveText}\n` +
                        `host เริ่มรอบใหม่ด้วย \`/g1 start secret:<เลข>\``
                    );
                }
                return;
            }

            // /g1 reset (host only)
            if (sub === 'reset') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                st.g1 = null;
                await itx.editReply('รีเซ็ต G1 ของช่องนี้แล้ว ✅');
                return;
            }

            await itx.reply({ content: 'คำสั่ง g1 ไม่รู้จัก', flags: MessageFlags.Ephemeral });
            return;
        }

        // -------------------- /g2 --------------------
        if (itx.commandName === 'g2') {
            const sub = itx.options.getSubcommand();
            const storageId = getStorageId(itx);

            const st = getGameState(storageId);
            const round = ensureRound(st, 'g2');
            round.target = 50;

            // /g2 host
            if (sub === 'host') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                round.hostId = itx.user.id;
                await itx.editReply(`ตั้ง host เรียบร้อย: ${formatMention(round.hostId)}`);
                return;
            }

            if (!round.hostId) {
                await itx.reply({ content: 'ยังไม่มี host ใช้ `/g2 host` ก่อน', flags: MessageFlags.Ephemeral });
                return;
            }

            // /g2 start (host only)
            if (sub === 'start') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                round.roundNo += 1;
                round.active = true;
                round.closed = false;
                round.answers = new Map();
                round.winners = [];
                round.lastResultText = '';

                await itx.editReply(`เริ่มรอบ G2 #${round.roundNo} แล้ว ✅ (เป้าหมาย = 50, ต้องไม่ซ้ำ)`);

                if (itx.channel?.isTextBased?.()) {
                    await itx.channel.send(
                        `🎮 **G2 รอบ #${round.roundNo}**: เลือกเลขให้ใกล้ **50** ที่สุด และ **ห้ามซ้ำคนอื่น**\n` +
                        `ส่งคำตอบด้วย \`/g2 answer num:<เลข>\`\n` +
                        `⛔ ส่งแล้วแก้ไม่ได้`
                    );

                    if (round.alive?.size > 0) {
                        await itx.channel.send(`ผู้เล่นที่ยังอยู่: ${[...round.alive].map(formatMention).join(', ')}`);
                    }
                }
                return;
            }

            // /g2 answer num:xx (locked)
            if (sub === 'answer') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                if (!round.active || round.closed) return await itx.editReply('ตอนนี้ยังไม่เปิดรับคำตอบ (หรือปิดแล้ว)');

                if (round.alive?.size > 0 && !round.alive.has(itx.user.id)) {
                    return await itx.editReply('คุณตกรอบไปแล้ว รอบนี้เล่นไม่ได้ 😅');
                }

                if (round.answers.has(itx.user.id)) {
                    return await itx.editReply('คุณส่งคำตอบไปแล้ว แก้ไม่ได้ครับ');
                }

                const num = itx.options.getInteger('num', true);
                if (num < 0 || num > 100) return await itx.editReply('เลขต้องอยู่ในช่วง 0-100');

                round.answers.set(itx.user.id, num);
                await itx.editReply(`ล็อกคำตอบของคุณแล้ว: **${num}** ✅`);
                return;
            }

            // /g2 close (host only)
            if (sub === 'close') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');

                round.closed = true;
                await itx.editReply(`ปิดรับคำตอบรอบ #${round.roundNo} แล้ว ✅`);
                return;
            }

            // /g2 result (host only) => remove duplicates then winners = closest to 50 (tie allowed)
            if (sub === 'result') {
                await itx.deferReply(); // public
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');

                round.closed = true;

                const guesses = [...round.answers.entries()].map(([userId, value]) => ({ userId, value }));
                if (!guesses.length) {
                    await itx.editReply('ไม่มีใครส่งคำตอบเลย');
                    round.active = false;
                    return;
                }

                // frequency ของตัวเลข
                const freq = new Map();
                for (const g of guesses) freq.set(g.value, (freq.get(g.value) || 0) + 1);

                const uniques = guesses.filter(g => freq.get(g.value) === 1);
                const dupes = guesses.filter(g => freq.get(g.value) > 1);

                const linesAll = guesses
                    .map(g => {
                        const tag = freq.get(g.value) > 1 ? ' (ซ้ำ ❌)' : '';
                        return `- ${formatMention(g.userId)} → **${g.value}**${tag}`;
                    })
                    .join('\n');

                if (!uniques.length) {
                    round.active = false;
                    round.winners = [];
                    round.alive = new Set();

                    await itx.editReply(
                        `🏁 **G2 Result รอบ #${round.roundNo}**\n` +
                        `🎯 เป้าหมาย: **50** (ต้องไม่ซ้ำ)\n\n` +
                        `📋 คำตอบทั้งหมด:\n${linesAll}\n\n` +
                        `❌ ทุกคำตอบซ้ำหมด ไม่มีผู้ชนะรอบนี้\n` +
                        `host เริ่มใหม่ด้วย \`/g2 start\``
                    );
                    return;
                }

                const winners = pickWinnersClosest(uniques, 50);
                round.winners = winners.map(w => w.userId);

                // รอบแรกถ้ายังไม่มี alive ให้ถือว่าทุกคนที่ส่งคำตอบเป็นผู้เล่นเริ่มต้น (optional)
                if (!round.alive) round.alive = new Set();
                if (round.alive.size === 0) {
                    for (const g of guesses) round.alive.add(g.userId);
                }

                const linesUniqueSorted = uniques
                    .sort((a, b) => Math.abs(a.value - 50) - Math.abs(b.value - 50))
                    .map(g => `- ${formatMention(g.userId)} → **${g.value}** (ห่าง ${Math.abs(g.value - 50)})`)
                    .join('\n');

                const winnersText = winners.map(w => formatMention(w.userId)).join(', ');
                const msg =
                    `🏁 **G2 Result รอบ #${round.roundNo}**\n` +
                    `🎯 เป้าหมาย: **50** (ต้องไม่ซ้ำ)\n\n` +
                    `📋 คำตอบทั้งหมด:\n${linesAll}\n\n` +
                    `✅ เฉพาะคำตอบที่ไม่ซ้ำ (เรียงใกล้ 50):\n${linesUniqueSorted}\n\n` +
                    `✅ ผู้ชนะรอบนี้ (${round.winners.length}): ${winnersText}\n` +
                    `➡️ host ใช้ \`/g2 nextround\` เพื่อเอาผู้ชนะไปต่อ`;

                round.lastResultText = msg;
                round.active = false;

                await itx.editReply(msg);
                return;
            }

            // /g2 nextround (host only)
            if (sub === 'nextround') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                if (!round.winners || !round.winners.length) {
                    return await itx.editReply('ยังไม่มีผู้ชนะจากรอบก่อน ใช้ `/g2 result` ก่อน');
                }

                round.alive = new Set(round.winners);
                round.winners = [];
                round.answers = new Map();
                round.closed = false;
                round.active = false;

                const aliveText = [...round.alive].map(formatMention).join(', ');
                await itx.editReply(`ตั้งค่า NextRound แล้ว ✅ ผู้รอด: ${aliveText}`);

                if (itx.channel?.isTextBased?.()) {
                    await itx.channel.send(
                        `🎮 **G2 NextRound** ผู้รอด: ${aliveText}\n` +
                        `host เริ่มรอบใหม่ด้วย \`/g2 start\``
                    );
                }
                return;
            }

            // /g2 reset (host only)
            if (sub === 'reset') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                st.g2 = null;
                await itx.editReply('รีเซ็ต G2 ของช่องนี้แล้ว ✅');
                return;
            }

            await itx.reply({ content: 'คำสั่ง g2 ไม่รู้จัก', flags: MessageFlags.Ephemeral });
            return;
        }
        
        // -------------------- /g3 --------------------
        if (itx.commandName === 'g3') {
            const sub = itx.options.getSubcommand();
            const storageId = getStorageId(itx);
            const round = getG3Round(storageId);

            // /g3 host
            if (sub === 'host') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                round.hostId = itx.user.id;
                await itx.editReply(`ตั้ง host เรียบร้อย: ${formatMention(round.hostId)}`);
                return;
            }

            if (!round.hostId) {
                await itx.reply({ content: 'ยังไม่มี host ใช้ `/g3 host` ก่อน', flags: MessageFlags.Ephemeral });
                return;
            }

            // /g3 start (host only)
            if (sub === 'start') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                // ถ้ามี alive (จาก nextround) ให้เล่นเฉพาะคนรอด
                round.roundNo += 1;
                round.active = true;
                round.closed = false;
                round.answers = new Map();
                round.survivors = [];

                round.currentQ = randomPickQuestion(round);

                await itx.editReply(`เริ่มรอบ G3 #${round.roundNo} แล้ว ✅`);

                if (itx.channel?.isTextBased?.()) {
                    const q = round.currentQ;
                    const aliveText = (round.alive && round.alive.size > 0)
                        ? `\nผู้เล่นที่ยังอยู่: ${[...round.alive].map(formatMention).join(', ')}`
                        : '';

                    await itx.channel.send(
                        `🧠 **G3 รอบ #${round.roundNo}**: อ่านใจ host!\n` +
                        `**Q${q.id}. ${q.q}**\n` +
                        `A) ${q.a}\nB) ${q.b}\nC) ${q.c}\nD) ${q.d}\n\n` +
                        `ตอบด้วย \`/g3 answer choice:A|B|C|D\`\n` +
                        `⛔ ส่งแล้วแก้ไม่ได้ (host ก็ตอบพร้อมกัน)\n` +
                        aliveText
                    );
                }
                return;
            }

            // /g3 answer (locked, ephemeral)
            if (sub === 'answer') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                if (!round.active || round.closed) return await itx.editReply('ตอนนี้ยังไม่เปิดรับคำตอบ (หรือปิดแล้ว)');
                if (!round.currentQ) return await itx.editReply('ยังไม่มีคำถามในรอบนี้ ให้ host ใช้ `/g3 start`');

                // ถ้ามี alive ให้เฉพาะคนรอดตอบได้
                if (round.alive && round.alive.size > 0 && !round.alive.has(itx.user.id)) {
                    return await itx.editReply('คุณตกรอบไปแล้ว รอบนี้เล่นไม่ได้ 😅');
                }

                if (round.answers.has(itx.user.id)) {
                    return await itx.editReply('คุณส่งคำตอบไปแล้ว แก้ไม่ได้ครับ');
                }

                const choice = (itx.options.getString('choice', true) || '').toUpperCase();
                if (!['A', 'B', 'C', 'D'].includes(choice)) {
                    return await itx.editReply('choice ต้องเป็น A/B/C/D');
                }

                round.answers.set(itx.user.id, choice);
                await itx.editReply(`ล็อกคำตอบของคุณแล้ว: **${choice}**`);
                return;
            }

            // /g3 close (host only)
            if (sub === 'close') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');

                round.closed = true;
                await itx.editReply(`ปิดรับคำตอบรอบ #${round.roundNo} แล้ว ✅`);
                return;
            }

            // /g3 result (host only) => survivors = same as host; if none => everyone survives
            if (sub === 'result') {
                await itx.deferReply(); // public
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');
                if (!round.active) return await itx.editReply('ยังไม่เริ่มรอบ');
                if (!round.currentQ) return await itx.editReply('ยังไม่มีคำถาม');

                round.closed = true;

                const q = round.currentQ;
                const hostChoice = round.answers.get(round.hostId);

                if (!hostChoice) {
                    return await itx.editReply(`host ยังไม่ตอบ! ให้ ${formatMention(round.hostId)} ใช้ \`/g3 answer\` ก่อน`);
                }

                const allPlayers = [...round.answers.keys()]; // คนที่ตอบในรอบนี้
                if (!allPlayers.length) {
                    round.active = false;
                    return await itx.editReply('ไม่มีใครส่งคำตอบเลย');
                }

                // คนรอด = ตอบเหมือน host
                let survivors = allPlayers.filter(uid => round.answers.get(uid) === hostChoice);

                // ถ้าไม่มีใครเหมือน host => ทุกคนรอด
                const noMatch = survivors.length === 0;
                if (noMatch) survivors = allPlayers.slice();

                round.survivors = survivors;

                // ถ้าเหลือคนเดียว = ชนะแล้ว
                const winnerText = survivors.length === 1 ? `\n🏆 ผู้ชนะคือ ${formatMention(survivors[0])} !!!` : '';

                // ทำสรุปคำตอบ (สั้น ๆ)
                const lines = allPlayers.map(uid => {
                    const c = round.answers.get(uid);
                    const ok = (c === hostChoice) ? '✅' : '❌';
                    return `- ${formatMention(uid)}: **${c}** ${ok}`;
                }).join('\n');

                const msg =
                    `🧠 **G3 Result รอบ #${round.roundNo}**\n` +
                    `**Q${q.id}. ${q.q}**\n` +
                    `Host = ${formatMention(round.hostId)} ตอบ: **${hostChoice}** (${choiceText(q, hostChoice)})\n` +
                    (noMatch ? `⚠️ ไม่มีใครตอบตรง host เลย → รอบนี้ **ทุกคนรอด**\n` : '') +
                    `\n📋 สรุปคำตอบ:\n${lines}\n` +
                    `\n✅ ผู้รอด (${survivors.length}): ${survivors.map(formatMention).join(', ')}` +
                    winnerText +
                    `\n\n➡️ host ใช้ \`/g3 nextround\` เพื่อเอาผู้รอดไปต่อ`;

                round.active = false;

                await itx.editReply(msg);
                return;
            }

            // /g3 nextround (host only): alive = survivors
            if (sub === 'nextround') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                if (!round.survivors || !round.survivors.length) {
                    return await itx.editReply('ยังไม่มีผู้รอดจากรอบก่อน ใช้ `/g3 result` ก่อน');
                }

                round.alive = new Set(round.survivors);
                round.survivors = [];
                round.answers = new Map();
                round.closed = false;
                round.active = false;
                round.currentQ = null;

                const aliveText = [...round.alive].map(formatMention).join(', ');
                await itx.editReply(`ตั้งค่า NextRound แล้ว ✅ ผู้รอด: ${aliveText}`);

                if (itx.channel?.isTextBased?.()) {
                    await itx.channel.send(
                        `🔁 **G3 NextRound** ผู้รอด: ${aliveText}\n` +
                        `host เริ่มรอบใหม่ด้วย \`/g3 start\``
                    );
                }
                return;
            }

            // /g3 reset (host only)
            if (sub === 'reset') {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });
                if (!isHost(round, itx.user.id)) return await itx.editReply('คำสั่งนี้ให้ host เท่านั้น');

                game3Rounds.delete(storageId);
                await itx.editReply('รีเซ็ต G3 ของช่องนี้แล้ว ✅');
                return;
            }

            await itx.reply({ content: 'คำสั่ง g3 ไม่รู้จัก', flags: MessageFlags.Ephemeral });
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
