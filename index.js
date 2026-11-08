require('dotenv').config();
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder, ActivityType, MessageFlags,
} = require('discord.js');
const db = require('./src/db');
const { CATS, ADHKAR, MIX, autoKeys } = require('./src/adhkar');

const COLOR = 0x2f6f4f;
const FOOTER = 'by s80b';
const MAIN_OWNERS = (process.env.OWNER_ID || '').split(',').map((s) => s.trim()).filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

/* ───────────── أدوات مساعدة ───────────── */

const eph = (o) => ({ ...o, flags: MessageFlags.Ephemeral });
const isOwner = (id) => MAIN_OWNERS.includes(id) || db.data.owners.includes(id);
const catOf = (key) => CATS.find((c) => c.key === key);
const catLabel = (key) => { const c = catOf(key); return c ? `${c.emoji} ${c.label}` : key; };
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const bold = (t) => t.split('\n').map((l) => (l.trim() ? `**${l.trim()}**` : l)).join('\n');
const extractId = (s = '') => (s.match(/\d{17,20}/) || [])[0];

function nowIn(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long',
  }).formatToParts(new Date());
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, hour: +o.hour, fri: o.weekday === 'Friday' };
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function modal(id, title, fields) {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  m.addComponents(
    ...fields.map((f) => {
      const t = new TextInputBuilder()
        .setCustomId(f.id).setLabel(f.label)
        .setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(!!f.req).setMaxLength(f.max || 100);
      if (f.ph) t.setPlaceholder(f.ph);
      return new ActionRowBuilder().addComponents(t);
    }),
  );
  return m;
}

const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

/* ───────────── الأذكار ───────────── */

function poolFor(gid, cat, hour, fri) {
  const g = db.guild(gid);
  const keys = cat === 'auto' ? autoKeys(hour, fri) : [cat, ...(MIX[cat] || [])];
  const pool = [];
  for (const k of keys) {
    for (const it of ADHKAR[k] || []) pool.push({ t: it.t, s: it.s, cat: k });
    for (const t of g.custom[k] || []) pool.push({ t, cat: k });
  }
  if (!pool.length) for (const it of ADHKAR.general) pool.push({ t: it.t, s: it.s, cat: 'general' });
  return pool;
}

function dhikrEmbed(it) {
  const e = new EmbedBuilder().setColor(COLOR).setDescription(bold(it.t));
  e.setTitle(it.cat ? catLabel(it.cat) : '📿 ذكر');
  e.setFooter({ text: it.s ? `${it.s} • quran` : 'quran' });
  return e;
}

async function sendDhikr(channel, cat = 'auto') {
  const g = db.guild(channel.guild.id);
  const n = nowIn(g.tz);
  const pool = poolFor(channel.guild.id, cat, n.hour, n.fri);
  const it = pool[Math.floor(Math.random() * pool.length)];
  return channel.send({ embeds: [dhikrEmbed(it)] });
}

const DEFAULT_SCHEDULE = [
  ['03:30', 'qiyam'], ['05:00', 'fajr'], ['06:30', 'morning'], ['07:30', 'work'], ['09:30', 'duha'],
  ['12:30', 'dhuhr'], ['15:45', 'asr'], ['17:45', 'maghrib'], ['20:00', 'isha'], ['22:30', 'sleep'],
].map(([time, cat]) => ({ time, cat }));
DEFAULT_SCHEDULE.push({ time: '10:00', cat: 'friday', onlyFri: true });

/* ───────────── اللوحات ───────────── */

function panelPayload(guild) {
  const g = db.guild(guild.id);
  const sched = [...g.schedule].sort((a, b) => a.time.localeCompare(b.time));
  const lines = sched.map((s) => `\`${s.time}\` ← ${catLabel(s.cat)}${s.onlyFri ? ' (الجمعة فقط)' : ''}`);
  const customCount = Object.values(g.custom).reduce((a, b) => a + b.length, 0);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('📿 لوحة تحكم الأذكار')
    .addFields(
      { name: 'الروم', value: g.channel ? `<#${g.channel}>` : 'غير محدد', inline: true },
      { name: 'الحالة', value: g.enabled ? '🟢 شغال' : '🔴 متوقف', inline: true },
      { name: 'التوقيت', value: `\`${g.tz}\``, inline: true },
      { name: `المواعيد (${sched.length})`, value: trunc(lines.join('\n') || 'لا يوجد مواعيد — اضغط «جدول افتراضي»', 1000) },
      { name: 'أذكار مضافة', value: `${customCount}`, inline: true },
      { name: 'كلمات الرد', value: `${Object.keys(g.triggers).length}`, inline: true },
    )
    .setFooter({ text: FOOTER });
  const components = [
    row(new ChannelSelectMenuBuilder().setCustomId('az:channel').setPlaceholder('اختر روم الأذكار')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    row(
      btn('az:toggle', g.enabled ? 'إيقاف التلقائي' : 'تشغيل التلقائي', g.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      btn('az:addtime', '➕ إضافة موعد', ButtonStyle.Primary),
      btn('az:deltime', '🗑️ حذف موعد'),
      btn('az:defaults', 'جدول افتراضي'),
    ),
    row(
      btn('az:addz', '✍️ إضافة ذكر', ButtonStyle.Primary),
      btn('az:delz', '🗑️ حذف ذكر'),
      btn('az:tz', '🌍 التوقيت'),
      btn('az:test', '📨 تجربة'),
      btn('az:refresh', '🔄'),
    ),
  ];
  return { embeds: [embed], components };
}

function triggerPayload(guild) {
  const g = db.guild(guild.id);
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('💬 كلمات الرد بذكر')
    .setDescription(`أي شخص يبدأ رسالته بالكلمة، البوت يرسل الذكر اللي تحدده.\nعدد الكلمات الحالية: **${Object.keys(g.triggers).length}**`)
    .setFooter({ text: FOOTER });
  return {
    embeds: [embed],
    components: [row(btn('tr:add', '➕ إضافة كلمة', ButtonStyle.Primary), btn('tr:del', '🗑️ حذف كلمة'), btn('tr:list', '📋 عرض الكلمات'))],
  };
}

function helpEmbed() {
  const p = db.data.prefix;
  const c = (x) => `\`${p}${x}\``;
  const desc = [
    '**اوامر الاذكار :**',
    `${c('azkar')} : لوحة تحكم الاذكار (روم - مواعيد - اضافة اذكار)`,
    `${c('setroom')} : تحديد روم الاذكار`,
    `${c('trigger')} : كلمات الرد التلقائي بذكر`,
    `${c('send')} : ارسال ذكر الان`,
    `${c('cats')} : عرض اقسام الاذكار`,
    `${c('taazia')} : فورم انشاء شات تعزية`,
    `${c('taaziacat')} : تحديد كاتيجوري التعزية`,
    `${c('settings')} : عرض اعدادات السيرفر`,
    '',
    '**اوامر مالك البوت :**',
    `${c('setname')} : تغيير اسم البوت`,
    `${c('setavatar')} : تغيير افتار البوت`,
    `${c('setgame')} : تغيير حالة البوت`,
    `${c('prefix')} : تغيير دالة البوت`,
    `${c('owners')} : اضافة او ازالة اونر للبوت`,
    `${c('ownerlist')} : عرض قائمة الاونرات`,
    `${c('restart')} : اعادة تشغيل البوت`,
  ].join('\n');
  return new EmbedBuilder().setColor(COLOR).setDescription(desc).setFooter({ text: FOOTER });
}

/* ───────────── التعزية ───────────── */

const taaziaImages = new Map(); // panelMessageId -> url

function duaText(mention, fem) {
  const w = (m, f) => (fem ? f : m);
  return [
    '**إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ**',
    '',
    `**تَغَمَّدَ اللَّهُ ${w('فَقِيدَنَا', 'فَقِيدَتَنَا')} الغَالِي${w('', 'ة')} ${mention} بِوَاسِعِ رَحْمَتِهِ، وَأَسْكَنَ${w('هُ', 'هَا')} فَسِيحَ جَنَّاتِهِ، وَجَعَلَ قَبْر${w('هُ', 'هَا')} رَوْضَةً مِنْ رِيَاضِ الجَنَّةِ.**`,
    '',
    `**اللَّهُمَّ اغْفِرْ ل${w('هُ', 'هَا')} وَارْحَمْ${w('هُ', 'هَا')}، وَعَافِ${w('هِ', 'هَا')} وَاعْفُ عَن${w('هُ', 'هَا')}، وَأَكْرِمْ نُزُل${w('هُ', 'هَا')}، وَوَسِّعْ مُدْخَل${w('هُ', 'هَا')}، وَاغْسِل${w('هُ', 'هَا')} بِالْمَاءِ وَالثَّلْجِ وَالْبَرَدِ، وَنَقِّ${w('هِ', 'هَا')} مِنَ الْخَطَايَا كَمَا يُنَقَّى الثَّوْبُ الْأَبْيَضُ مِنَ الدَّنَسِ.**`,
    '',
    `**اللَّهُمَّ أَبْدِل${w('هُ', 'هَا')} دَارًا خَيْرًا مِنْ دَارِ${w('هِ', 'هَا')}، وَأَهْلًا خَيْرًا مِنْ أَهْلِ${w('هِ', 'هَا')}، وَزَوْجًا خَيْرًا مِنْ زَوْجِ${w('هِ', 'هَا')}، وَأَدْخِل${w('هُ', 'هَا')} الْجَنَّةَ، وَأَعِذ${w('هُ', 'هَا')} مِنْ عَذَابِ الْقَبْرِ وَعَذَابِ النَّارِ.**`,
    '',
    `**اللَّهُمَّ ثَبِّت${w('هُ', 'هَا')} عِنْدَ السُّؤَالِ، وَآنِسْ وَحْشَت${w('هُ', 'هَا')}، وَنَوِّرْ لَ${w('هُ', 'هَا')} فِي قَبْر${w('هِ', 'هَا')}، وَاجْعَلْ${w('هُ', 'هَا')} مِنْ أَهْلِ الفِرْدَوْسِ الْأَعْلَى بِلَا حِسَابٍ وَلَا سَابِقَةِ عَذَابٍ.**`,
    '',
    '**وَأَلْهِمْ أَهْلَهُ وَذَوِيهِ وَمُحِبِّيهِ الصَّبْرَ وَالسُّلْوَانَ، وَاجْبُرْ مُصَابَهُمْ، وَاجْمَعْنَا بِهِمْ فِي جَنَّاتِ النَّعِيمِ.**',
    '',
    '**إِنَّ لِلَّهِ مَا أَخَذَ وَلَهُ مَا أَعْطَى، وَكُلُّ شَيْءٍ عِنْدَهُ بِأَجَلٍ مُسَمًّى، فَاصْبِرُوا وَاحْتَسِبُوا.**',
    '',
    '**﴿ يَا أَيَّتُهَا النَّفْسُ الْمُطْمَئِنَّةُ * ارْجِعِي إِلَىٰ رَبِّكِ رَاضِيَةً مَّرْضِيَّةً * فَادْخُلِي فِي عِبَادِي * وَادْخُلِي جَنَّتِي ﴾**',
  ].join('\n');
}

async function createTaazia(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const name = i.fields.getTextInputValue('name').trim();
  const idRaw = i.fields.getTextInputValue('uid').trim();
  const genderRaw = i.fields.getTextInputValue('gender').trim();
  const text = i.fields.getTextInputValue('text').trim();
  let imageUrl = i.fields.getTextInputValue('image').trim();
  const uid = extractId(idRaw);
  if (!uid) return i.editReply('❌ ايدي المرحوم غير صحيح، لازم يكون ارقام (17-20 رقم).');
  if (!imageUrl && i.message && taaziaImages.has(i.message.id)) imageUrl = taaziaImages.get(i.message.id);
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return i.editReply('❌ رابط الصورة لازم يبدأ بـ http او https.');
  const fem = /(انث|أنث|بنت|مرا|مره|female|^f$)/i.test(genderRaw);

  const g = db.guild(i.guild.id);
  const channelName = trunc(`تعزية-${name}`, 100);
  let channel;
  try {
    channel = await i.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: g.taaziaCategory || undefined,
      topic: `تعزية — ${name}`,
      reason: `تعزية بواسطة ${i.user.tag}`,
    });
  } catch (e) {
    return i.editReply(`❌ ما قدرت انشئ الروم، تأكد ان البوت عنده صلاحية Manage Channels.\n\`${e.message}\``);
  }

  const user = await client.users.fetch(uid).catch(() => null);
  const mention = `<@${uid}>`;
  const description = text
    ? `**تعزية في فقيدنا ${mention}**\n\n${text}`
    : duaText(mention, fem);
  const embed = new EmbedBuilder()
    .setColor(0x1e1f22)
    .setTitle('﴿ إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ ﴾')
    .setDescription(trunc(description, 4000))
    .setFooter({ text: 'تعزية • quran' })
    .setTimestamp();
  if (user) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));

  const payload = { embeds: [embed] };
  try {
    if (imageUrl) {
      const ext = (imageUrl.split('?')[0].match(/\.(png|jpe?g|gif|webp)$/i) || [, 'png'])[1];
      const file = new AttachmentBuilder(imageUrl, { name: `taazia.${ext}` });
      embed.setImage(`attachment://taazia.${ext}`);
      await channel.send({ ...payload, files: [file] });
    } else {
      await channel.send(payload);
    }
  } catch {
    embed.setImage(null);
    await channel.send(payload).catch(() => {});
  }
  if (i.message) taaziaImages.delete(i.message.id);
  return i.editReply(`✅ تم انشاء ${channel}`);
}

/* ───────────── الاوامر ───────────── */

const commands = {
  async help(m) { await m.channel.send({ embeds: [helpEmbed()] }); },

  async azkar(m) { await m.channel.send(panelPayload(m.guild)); },
  async trigger(m) { await m.channel.send(triggerPayload(m.guild)); },

  async setroom(m, args) {
    const ch = m.mentions.channels.first() || m.guild.channels.cache.get(extractId(args[0]));
    if (!ch || !ch.isTextBased()) return m.reply('❌ منشن الروم او حط ايديه: `setroom #room`');
    db.guild(m.guild.id).channel = ch.id;
    db.save();
    m.reply(`✅ تم تحديد روم الاذكار: ${ch}`);
  },

  async send(m, args) {
    const cat = args[0]?.toLowerCase() || 'auto';
    if (!catOf(cat)) return m.reply('❌ قسم غير موجود، شوف الاقسام بـ `cats`');
    const g = db.guild(m.guild.id);
    const ch = (g.channel && (await client.channels.fetch(g.channel).catch(() => null))) || m.channel;
    await sendDhikr(ch, cat);
    if (ch.id !== m.channel.id) m.react('✅').catch(() => {});
  },

  async cats(m) {
    const e = new EmbedBuilder().setColor(COLOR).setTitle('اقسام الاذكار')
      .setDescription(CATS.map((c) => `\`${c.key}\` : ${c.emoji} ${c.label}`).join('\n')).setFooter({ text: FOOTER });
    m.channel.send({ embeds: [e] });
  },

  async settings(m) {
    const g = db.guild(m.guild.id);
    const e = new EmbedBuilder().setColor(COLOR).setTitle('اعدادات السيرفر').addFields(
      { name: 'روم الاذكار', value: g.channel ? `<#${g.channel}>` : 'غير محدد', inline: true },
      { name: 'التلقائي', value: g.enabled ? '🟢 شغال' : '🔴 متوقف', inline: true },
      { name: 'التوقيت', value: `\`${g.tz}\``, inline: true },
      { name: 'المواعيد', value: `${g.schedule.length}`, inline: true },
      { name: 'كلمات الرد', value: `${Object.keys(g.triggers).length}`, inline: true },
      { name: 'كاتيجوري التعزية', value: g.taaziaCategory ? `<#${g.taaziaCategory}>` : 'بدون', inline: true },
      { name: 'الدالة', value: `\`${db.data.prefix}\``, inline: true },
    ).setFooter({ text: FOOTER });
    m.channel.send({ embeds: [e] });
  },

  async taazia(m) {
    const att = m.attachments.first();
    const sent = await m.channel.send({
      embeds: [new EmbedBuilder().setColor(0x1e1f22).setTitle('🕊️ فورم التعزية')
        .setDescription('اضغط الزر وعبّي البيانات.\nالروم يبدأ دايماً بـ **تعزية-** وانت تختار الباقي.\n\n💡 تقدر ترفق صورة مع الأمر نفسه، او تحط رابطها في الفورم.')
        .setFooter({ text: FOOTER })],
      components: [row(btn('tz:open', '📝 فتح الفورم', ButtonStyle.Primary))],
    });
    if (att && att.contentType?.startsWith('image/')) taaziaImages.set(sent.id, att.url);
  },

  async taaziacat(m, args) {
    const g = db.guild(m.guild.id);
    if (args[0] === 'off') { g.taaziaCategory = null; db.save(); return m.reply('✅ تم ازالة الكاتيجوري.'); }
    const ch = m.guild.channels.cache.get(extractId(args[0]));
    if (!ch || ch.type !== ChannelType.GuildCategory) return m.reply('❌ حط ايدي الكاتيجوري: `taaziacat <id>` او `taaziacat off`');
    g.taaziaCategory = ch.id; db.save();
    m.reply(`✅ شاتات التعزية بتنفتح داخل **${ch.name}**`);
  },

  async setname(m, args) {
    const n = args.join(' ');
    if (!n) return m.reply('❌ اكتب الاسم.');
    await client.user.setUsername(n).then(() => m.reply('✅ تم تغيير الاسم.')).catch((e) => m.reply(`❌ ${e.message}`));
  },

  async setavatar(m, args) {
    const url = m.attachments.first()?.url || args[0];
    if (!url) return m.reply('❌ ارفق صورة او حط رابط.');
    await client.user.setAvatar(url).then(() => m.reply('✅ تم تغيير الافتار.')).catch((e) => m.reply(`❌ ${e.message}`));
  },

  async setgame(m, args) {
    const t = args.join(' ');
    if (!t) return m.reply('❌ اكتب الحالة.');
    db.data.game = t; db.save();
    client.user.setActivity(t, { type: ActivityType.Listening });
    m.reply('✅ تم تغيير الحالة.');
  },

  async prefix(m, args) {
    const p = args[0];
    if (!p || p.length > 3) return m.reply('❌ اكتب دالة جديدة (حد اقصى 3 حروف).');
    db.data.prefix = p; db.save();
    m.reply(`✅ الدالة الجديدة: \`${p}\``);
  },

  async owners(m, args) {
    const id = m.mentions.users.first()?.id || extractId(args[0]);
    if (!id) return m.reply('❌ منشن الشخص او حط ايديه.');
    if (MAIN_OWNERS.includes(id)) return m.reply('❌ هذا المالك الاساسي ما ينشال.');
    const i = db.data.owners.indexOf(id);
    if (i >= 0) { db.data.owners.splice(i, 1); db.save(); return m.reply(`✅ تم ازالة <@${id}> من الاونرات.`); }
    db.data.owners.push(id); db.save();
    m.reply(`✅ تم اضافة <@${id}> للاونرات.`);
  },

  async ownerlist(m) {
    const all = [...new Set([...MAIN_OWNERS, ...db.data.owners])];
    const e = new EmbedBuilder().setColor(COLOR).setTitle('قائمة الاونرات')
      .setDescription(all.map((id, n) => `${n + 1}. <@${id}> ${MAIN_OWNERS.includes(id) ? '👑' : ''}`).join('\n') || 'لا يوجد')
      .setFooter({ text: FOOTER });
    m.channel.send({ embeds: [e] });
  },

  async restart(m) {
    await m.reply('🔄 جاري اعادة التشغيل...');
    process.exit(0); // شغّل البوت عبر pm2 او loop عشان يرجع يشتغل تلقائياً
  },
};

/* ───────────── الرسائل ───────────── */

const trigCooldown = new Map();

client.on('messageCreate', async (m) => {
  try {
    if (m.author.bot || !m.guild) return;
    const prefix = db.data.prefix;

    if (m.content.startsWith(prefix)) {
      const [cmd, ...args] = m.content.slice(prefix.length).trim().split(/\s+/);
      const fn = commands[(cmd || '').toLowerCase()];
      if (!fn || !isOwner(m.author.id)) return; // كل الاوامر للاونرات فقط
      return await fn(m, args);
    }

    const g = db.guild(m.guild.id);
    const content = m.content.trim().toLowerCase();
    for (const [word, text] of Object.entries(g.triggers)) {
      const w = word.toLowerCase();
      if (!content.startsWith(w)) continue;
      const next = content[w.length];
      if (next && !/\s/.test(next)) continue;
      const key = `${m.channel.id}:${w}`;
      if (Date.now() - (trigCooldown.get(key) || 0) < 5000) return;
      trigCooldown.set(key, Date.now());
      return await m.reply({ embeds: [dhikrEmbed({ t: text })], allowedMentions: { repliedUser: false } });
    }
  } catch (e) {
    console.error('messageCreate:', e);
  }
});

/* ───────────── التفاعلات ───────────── */

client.on('interactionCreate', async (i) => {
  try {
    if (!i.guild) return;
    if (!isOwner(i.user.id)) return i.reply(eph({ content: '❌ هذا الامر للاونرات فقط.' }));
    const g = db.guild(i.guild.id);
    const id = i.customId;

    /* ── ازرار ── */
    if (i.isButton()) {
      switch (id) {
        case 'az:toggle':
          if (!g.enabled && !g.channel) return i.reply(eph({ content: '❌ حدد الروم اولاً.' }));
          g.enabled = !g.enabled; db.save();
          return i.update(panelPayload(i.guild));
        case 'az:refresh': return i.update(panelPayload(i.guild));
        case 'az:defaults':
          g.schedule = DEFAULT_SCHEDULE.map((s, n) => ({ ...s, id: `d${n}` })); db.save();
          return i.update(panelPayload(i.guild));
        case 'az:addtime':
          if (g.schedule.length >= 25) return i.reply(eph({ content: '❌ الحد الاقصى 25 موعد.' }));
          return i.reply(eph({
            content: 'اختر نوع الاذكار للموعد:',
            components: [row(new StringSelectMenuBuilder().setCustomId('az:time:cat').setPlaceholder('القسم')
              .addOptions(CATS.map((c) => ({ label: c.label, value: c.key, emoji: c.emoji }))))],
          }));
        case 'az:deltime': {
          if (!g.schedule.length) return i.reply(eph({ content: 'ما فيه مواعيد.' }));
          const opts = [...g.schedule].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 25)
            .map((s) => ({ label: `${s.time} — ${catOf(s.cat)?.label || s.cat}`, value: s.id }));
          return i.reply(eph({ content: 'اختر الموعد للحذف:', components: [row(new StringSelectMenuBuilder().setCustomId('az:time:del').addOptions(opts))] }));
        }
        case 'az:addz':
          return i.reply(eph({
            content: 'اختر القسم اللي تبي تضيف له ذكر:',
            components: [row(new StringSelectMenuBuilder().setCustomId('az:z:cat').setPlaceholder('القسم')
              .addOptions(CATS.filter((c) => c.key !== 'auto').map((c) => ({ label: c.label, value: c.key, emoji: c.emoji }))))],
          }));
        case 'az:delz': {
          const opts = [];
          for (const [cat, list] of Object.entries(g.custom)) {
            list.forEach((t, n) => opts.push({ label: trunc(`${catOf(cat)?.label || cat}: ${t}`, 100), value: `${cat}|${n}` }));
          }
          if (!opts.length) return i.reply(eph({ content: 'ما فيه اذكار مضافة.' }));
          return i.reply(eph({ content: 'اختر الذكر للحذف:', components: [row(new StringSelectMenuBuilder().setCustomId('az:z:del').addOptions(opts.slice(0, 25)))] }));
        }
        case 'az:tz':
          return i.showModal(modal('az:tz:modal', 'التوقيت', [{ id: 'tz', label: 'المنطقة الزمنية', req: true, ph: 'Asia/Riyadh', max: 60 }]));
        case 'az:test': {
          const ch = (g.channel && (await client.channels.fetch(g.channel).catch(() => null))) || i.channel;
          await sendDhikr(ch, 'auto');
          return i.reply(eph({ content: `✅ تم الارسال في ${ch}` }));
        }
        case 'tr:add':
          return i.showModal(modal('tr:add:modal', 'اضافة كلمة', [
            { id: 'word', label: 'الكلمة (اول الكلام)', req: true, max: 50 },
            { id: 'text', label: 'الذكر اللي يرسله البوت', req: true, long: true, max: 1500 },
          ]));
        case 'tr:del': {
          const words = Object.keys(g.triggers);
          if (!words.length) return i.reply(eph({ content: 'ما فيه كلمات.' }));
          return i.reply(eph({ content: 'اختر الكلمة للحذف:', components: [row(new StringSelectMenuBuilder().setCustomId('tr:del:sel').addOptions(words.slice(0, 25).map((w) => ({ label: trunc(w, 100), value: trunc(w, 100) }))))] }));
        }
        case 'tr:list': {
          const list = Object.entries(g.triggers).map(([w, t]) => `**${w}** ← ${trunc(t, 80)}`).join('\n');
          return i.reply(eph({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle('كلمات الرد').setDescription(trunc(list || 'لا يوجد', 4000))] }));
        }
        case 'tz:open':
          return i.showModal(modal('tz:modal', 'فورم التعزية', [
            { id: 'name', label: 'اسم الشات (بعد: تعزية-)', req: true, max: 60 },
            { id: 'uid', label: 'ايدي المرحوم', req: true, max: 25 },
            { id: 'gender', label: 'الجنس: ذكر / انثى (اختياري)', max: 10 },
            { id: 'text', label: 'نص التعزية (فاضي = دعاء تلقائي)', long: true, max: 3500 },
            { id: 'image', label: 'رابط الصورة (اختياري)', max: 500 },
          ]));
      }
      return;
    }

    /* ── قوائم ── */
    if (i.isChannelSelectMenu() && id === 'az:channel') {
      g.channel = i.values[0]; db.save();
      return i.update(panelPayload(i.guild));
    }

    if (i.isStringSelectMenu()) {
      const v = i.values[0];
      if (id === 'az:time:cat') {
        return i.showModal(modal(`az:time:modal:${v}`, `موعد: ${catOf(v).label}`, [
          { id: 'time', label: 'الوقت بصيغة 24 ساعة', req: true, ph: '05:30', max: 5 },
        ]));
      }
      if (id === 'az:time:del') {
        g.schedule = g.schedule.filter((s) => s.id !== v); db.save();
        return i.update({ content: '✅ تم حذف الموعد. اضغط 🔄 في اللوحة للتحديث.', components: [] });
      }
      if (id === 'az:z:cat') {
        return i.showModal(modal(`az:z:modal:${v}`, `ذكر جديد: ${catOf(v).label}`, [
          { id: 'text', label: 'نص الذكر', req: true, long: true, max: 1500 },
        ]));
      }
      if (id === 'az:z:del') {
        const [cat, n] = v.split('|');
        g.custom[cat]?.splice(+n, 1); db.save();
        return i.update({ content: '✅ تم حذف الذكر.', components: [] });
      }
      if (id === 'tr:del:sel') {
        delete g.triggers[v]; db.save();
        return i.update({ content: '✅ تم حذف الكلمة.', components: [] });
      }
      return;
    }

    /* ── فورمات ── */
    if (i.isModalSubmit()) {
      if (id.startsWith('az:time:modal:')) {
        const cat = id.split(':')[3];
        const mt = i.fields.getTextInputValue('time').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!mt) return i.reply(eph({ content: '❌ صيغة الوقت غلط، مثال: 05:30' }));
        const time = `${mt[1].padStart(2, '0')}:${mt[2]}`;
        g.schedule.push({ id: Date.now().toString(36), time, cat, ...(cat === 'friday' ? { onlyFri: true } : {}) });
        db.save();
        return i.reply(eph({ content: `✅ تمت اضافة موعد \`${time}\` ← ${catLabel(cat)}\nاضغط 🔄 في اللوحة للتحديث.` }));
      }
      if (id.startsWith('az:z:modal:')) {
        const cat = id.split(':')[3];
        (g.custom[cat] ??= []).push(i.fields.getTextInputValue('text').trim()); db.save();
        return i.reply(eph({ content: `✅ تمت اضافة الذكر لقسم ${catLabel(cat)}` }));
      }
      if (id === 'az:tz:modal') {
        const tz = i.fields.getTextInputValue('tz').trim();
        if (!validTz(tz)) return i.reply(eph({ content: '❌ منطقة زمنية غير صحيحة، مثال: Asia/Riyadh' }));
        g.tz = tz; db.save();
        return i.reply(eph({ content: `✅ التوقيت: \`${tz}\`` }));
      }
      if (id === 'tr:add:modal') {
        const word = i.fields.getTextInputValue('word').trim();
        g.triggers[word] = i.fields.getTextInputValue('text').trim(); db.save();
        return i.reply(eph({ content: `✅ تمت اضافة الكلمة **${word}**` }));
      }
      if (id === 'tz:modal') return createTaazia(i);
    }
  } catch (e) {
    console.error('interactionCreate:', e);
    const msg = eph({ content: '❌ صار خطأ غير متوقع.' });
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

/* ───────────── الجدولة ───────────── */

setInterval(async () => {
  for (const [gid, g] of Object.entries(db.data.guilds)) {
    if (!g.enabled || !g.channel) continue;
    let n;
    try { n = nowIn(g.tz || 'Asia/Riyadh'); } catch { continue; }
    for (const s of g.schedule || []) {
      if (s.time !== n.time || s.last === n.date) continue;
      if (s.onlyFri && !n.fri) continue;
      s.last = n.date; db.save();
      const ch = await client.channels.fetch(g.channel).catch(() => null);
      if (ch) await sendDhikr(ch, s.cat).catch((e) => console.error(`send ${gid}:`, e.message));
    }
  }
}, 20000);

client.once('clientReady', () => {
  console.log(`✅ ${client.user.tag} شغال`);
  client.user.setActivity(db.data.game, { type: ActivityType.Listening });
});

process.on('unhandledRejection', (e) => console.error('unhandled:', e));
client.login(process.env.TOKEN);
