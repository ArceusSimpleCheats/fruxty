const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder, SlashCommandBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');

dotenv.config();
// Check if token exists
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing!');
    process.exit(1);
}
if (!process.env.CLIENT_ID) {
    console.error('❌ CLIENT_ID is missing!');
    process.exit(1);
}
console.log('✅ Token found, length:', process.env.DISCORD_TOKEN.length);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ]
});

// ============ DATA STORAGE ============
client.guildSettings = new Map();
client.tempChannels = new Map();
client.autoModSettings = new Map();
client.warnings = new Map();
client.serverStatus = new Map();
client.verificationCodes = new Map();

// ============ BAD WORDS DATABASE ============
const badWords = {
    severe: ['nigger', 'nigga', 'faggot', 'tranny', 'retard', 'kike', 'chink'],
    profanity: ['fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'bastard', 'cock', 'cum', 'slut', 'twat'],
    sexual: ['porn', 'xxx', 'nsfw', 'nude', 'naked', 'sex', 'penis', 'vagina']
};

function containsBadWord(msg, level = 'all') {
    const lower = msg.toLowerCase();
    if (level === 'severe') return badWords.severe.some(w => lower.includes(w));
    if (level === 'profanity') return badWords.profanity.some(w => lower.includes(w));
    return [...badWords.severe, ...badWords.profanity, ...badWords.sexual].some(w => lower.includes(w));
}

function getAllViolations(msg) {
    const v = [];
    if (containsBadWord(msg, 'severe')) v.push('⚠️ Severe');
    if (containsBadWord(msg, 'profanity')) v.push('🚫 Profanity');
    if (badWords.sexual.some(w => msg.toLowerCase().includes(w))) v.push('🔞 Sexual');
    return v;
}

// ============ COMMANDS DEFINITION ============
const commands = [
    // Admin Commands
    {
        name: 'send',
        description: 'Send a message (Admin)',
        options: [{ name: 'channel', type: 7, description: 'Channel', required: true }, { name: 'message', type: 3, description: 'Message', required: true }]
    },
    {
        name: 'embed',
        description: 'Send an embed (Admin)',
        options: [{ name: 'channel', type: 7, description: 'Channel', required: true }, { name: 'title', type: 3, description: 'Title', required: true }, { name: 'description', type: 3, description: 'Description', required: true }]
    },
    {
        name: 'purge',
        description: 'Delete messages (Admin)',
        options: [{ name: 'amount', type: 4, description: '1-100', required: true, min_value: 1, max_value: 100 }]
    },
    {
        name: 'setup-voice',
        description: 'Setup auto temp voice (Admin)'
    },
    {
        name: 'setup-verify',
        description: 'Setup verification (Admin)',
        options: [{ name: 'channel', type: 7, description: 'Channel', required: true }, { name: 'role', type: 8, description: 'Role', required: true }]
    },
    {
        name: 'server-status',
        description: 'Setup live server status (Admin)',
        options: [{ name: 'channel', type: 7, description: 'Channel', required: true }]
    },
    {
        name: 'lockdown',
        description: 'Lockdown a channel (Admin)',
        options: [{ name: 'channel', type: 7, description: 'Channel', required: false }]
    },
    {
        name: 'slowmode',
        description: 'Set slowmode (Admin)',
        options: [{ name: 'seconds', type: 4, description: 'Seconds', required: true, min_value: 0, max_value: 21600 }, { name: 'channel', type: 7, description: 'Channel', required: false }]
    },
    
    // Moderation Commands
    {
        name: 'automod',
        description: 'Configure AutoMod (Admin)',
        options: [{ name: 'action', type: 3, description: 'enable/disable/status', required: true, choices: [{ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' }, { name: 'Status', value: 'status' }] }]
    },
    {
        name: 'ban',
        description: 'Ban a user',
        options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'reason', type: 3, description: 'Reason', required: false }]
    },
    {
        name: 'kick',
        description: 'Kick a user',
        options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'reason', type: 3, description: 'Reason', required: false }]
    },
    {
        name: 'timeout',
        description: 'Timeout a user',
        options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'minutes', type: 4, description: 'Minutes (1-1440)', required: true, min_value: 1, max_value: 1440 }, { name: 'reason', type: 3, description: 'Reason', required: false }]
    },
    {
        name: 'warn',
        description: 'Warn a user',
        options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'reason', type: 3, description: 'Reason', required: true }]
    },
    {
        name: 'warnings',
        description: 'View warnings for a user',
        options: [{ name: 'user', type: 6, description: 'User', required: false }]
    },
    
    // Utility Commands
    {
        name: 'ping',
        description: 'Check bot latency'
    },
    {
        name: 'serverinfo',
        description: 'Get server information'
    },
    {
        name: 'userinfo',
        description: 'Get user information',
        options: [{ name: 'user', type: 6, description: 'User', required: false }]
    },
    {
        name: 'avatar',
        description: 'Get user avatar',
        options: [{ name: 'user', type: 6, description: 'User', required: false }]
    },
    {
        name: 'botinfo',
        description: 'Get bot information'
    },
    {
        name: 'verify',
        description: 'Verify yourself'
    }
];

// ============ EVENT HANDLERS ============

// Ready event
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Registered ${commands.length} commands`);
    } catch(e) { console.error(e); }
    
    client.user.setPresence({ activities: [{ name: `/help | ${client.guilds.cache.size} servers`, type: ActivityType.Watching }], status: 'online' });
    
    // Auto-update server status every 5 minutes
    cron.schedule('*/5 * * * *', () => {
        client.guilds.cache.forEach(guild => updateServerStatus(guild));
    });
});

// Message Create event (AutoMod)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const settings = client.autoModSettings.get(message.guild.id);
    if (!settings?.enabled) return;
    
    const violations = getAllViolations(message.content);
    if (violations.length > 0) {
        await message.delete();
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🛡️ AutoMod')
            .setDescription(`${message.author}, your message was deleted for: ${violations.join(', ')}`);
        const warn = await message.channel.send({ embeds: [embed] });
        setTimeout(() => warn.delete(), 5000);
    }
});

// Voice State Update (Temp Voice)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const settings = client.guildSettings?.get(newState.guild?.id) || {};
    const vc = settings.voiceHub;
    
    if (vc?.enabled && newState.channelId === vc.creatorChannelId && !oldState.channelId) {
        const member = newState.member;
        const name = `${member.user.username}'s Voice`.slice(0, 32);
        const channel = await newState.guild.channels.create({
            name, type: ChannelType.GuildVoice, parent: vc.categoryId,
            userLimit: vc.userLimit || 10,
            permissionOverwrites: [{ id: member.id, allow: [PermissionFlagsBits.ManageChannels] }]
        });
        client.tempChannels.set(channel.id, { ownerId: member.id });
        await member.voice.setChannel(channel);
    }
    
    if (oldState.channelId && client.tempChannels?.has(oldState.channelId)) {
        const ch = oldState.guild.channels.cache.get(oldState.channelId);
        if (ch && ch.members.size === 0) {
            setTimeout(async () => {
                const fresh = oldState.guild.channels.cache.get(oldState.channelId);
                if (fresh && fresh.members.size === 0) await fresh.delete();
                client.tempChannels.delete(oldState.channelId);
            }, 5000);
        }
    }
});

// Interaction Create (Command Handler)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, guild, member, channel } = interaction;
    
    // ========== ADMIN COMMANDS ==========
    
    if (commandName === 'send') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const targetChannel = options.getChannel('channel');
        await targetChannel.send(options.getString('message'));
        await interaction.reply({ content: '✅ Sent!', ephemeral: true });
    }
    
    else if (commandName === 'embed') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const targetChannel = options.getChannel('channel');
        const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2);
        await targetChannel.send({ embeds: [embed] });
        await interaction.reply({ content: '✅ Embed sent!', ephemeral: true });
    }
    
    else if (commandName === 'purge') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const amount = options.getInteger('amount');
        const messages = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(messages, true);
        await interaction.reply({ content: `✅ Deleted ${deleted.size} messages!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply(), 3000);
    }
    
    else if (commandName === 'setup-voice') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        await interaction.reply({ content: '🔧 Setting up...', ephemeral: true });
        const cat = await guild.channels.create({ name: '🎤 Temp Voice', type: ChannelType.GuildCategory });
        const creator = await guild.channels.create({ name: '➕-create-voice', type: ChannelType.GuildVoice, parent: cat.id });
        const settings = client.guildSettings.get(guild.id) || {};
        settings.voiceHub = { enabled: true, categoryId: cat.id, creatorChannelId: creator.id, userLimit: 10 };
        client.guildSettings.set(guild.id, settings);
        const embed = new EmbedBuilder().setColor(0x00ff00).setTitle('✅ Auto Temp Voice Ready!').setDescription(`Join ${creator} to get your own voice channel!`);
        await interaction.editReply({ content: null, embeds: [embed] });
    }
    
    else if (commandName === 'setup-verify') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const verifyChannel = options.getChannel('channel');
        const role = options.getRole('role');
        const settings = client.guildSettings.get(guild.id) || {};
        settings.verification = { channelId: verifyChannel.id, roleId: role.id };
        client.guildSettings.set(guild.id, settings);
        const embed = new EmbedBuilder().setColor(0x00ff00).setTitle('✅ Verification').setDescription(`Click below to get ${role}`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_me').setLabel('Verify').setStyle(ButtonStyle.Success));
        await verifyChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Setup in ${verifyChannel}!`, ephemeral: true });
    }
    
    else if (commandName === 'server-status') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const statusChannel = options.getChannel('channel');
        const settings = client.guildSettings.get(guild.id) || {};
        settings.serverStatus = { enabled: true, channelId: statusChannel.id, title: '📊 Server Status', color: 0x00ff00 };
        client.guildSettings.set(guild.id, settings);
        await interaction.reply({ content: `✅ Server status will update in ${statusChannel} every 5 minutes!`, ephemeral: true });
        await updateServerStatus(guild);
    }
    
    else if (commandName === 'lockdown') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        await interaction.reply({ content: `🔒 ${targetChannel} is now locked down!`, ephemeral: true });
    }
    
    else if (commandName === 'slowmode') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const seconds = options.getInteger('seconds');
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.setRateLimitPerUser(seconds);
        await interaction.reply({ content: `✅ Slowmode set to ${seconds} seconds in ${targetChannel}!`, ephemeral: true });
    }
    
    // ========== MODERATION COMMANDS ==========
    
    else if (commandName === 'automod') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        const action = options.getString('action');
        if (!client.autoModSettings.has(guild.id)) client.autoModSettings.set(guild.id, { enabled: false });
        const settings = client.autoModSettings.get(guild.id);
        if (action === 'enable') { settings.enabled = true; await interaction.reply('✅ AutoMod enabled!'); }
        else if (action === 'disable') { settings.enabled = false; await interaction.reply('❌ AutoMod disabled!'); }
        else if (action === 'status') {
            const embed = new EmbedBuilder().setColor(settings.enabled ? 0x00ff00 : 0xff0000).setTitle('🛡️ AutoMod').addFields({ name: 'Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled' });
            await interaction.reply({ embeds: [embed] });
        }
        client.autoModSettings.set(guild.id, settings);
    }
    
    else if (commandName === 'ban') {
        if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.bannable) return interaction.reply({ content: '❌ Cannot ban!', ephemeral: true });
        await targetMember.ban({ reason });
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('🔨 User Banned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'kick') {
        if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.kickable) return interaction.reply({ content: '❌ Cannot kick!', ephemeral: true });
        await targetMember.kick(reason);
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('👢 User Kicked').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'timeout') {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        const target = options.getUser('user');
        const minutes = options.getInteger('minutes');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.moderatable) return interaction.reply({ content: '❌ Cannot timeout!', ephemeral: true });
        await targetMember.timeout(minutes * 60 * 1000, reason);
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⏰ User Timed Out').addFields({ name: 'User', value: target.tag }, { name: 'Duration', value: `${minutes} minutes` }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'warn') {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason');
        if (!client.warnings.has(guild.id)) client.warnings.set(guild.id, new Map());
        const userWarnings = client.warnings.get(guild.id);
        const warnings = userWarnings.get(target.id) || [];
        warnings.push({ reason, date: Date.now(), moderator: interaction.user.tag });
        userWarnings.set(target.id, warnings);
        client.warnings.set(guild.id, userWarnings);
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⚠️ User Warned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason }, { name: 'Warnings', value: `${warnings.length} total` });
        await interaction.reply({ embeds: [embed] });
        if (warnings.length >= 3) {
            const targetMember = await guild.members.fetch(target.id).catch(() => null);
            if (targetMember) await targetMember.timeout(30 * 60 * 1000, '3 warnings - auto timeout');
            await interaction.followUp({ content: `⚠️ ${target.tag} has been timed out for 30 minutes (3 warnings)` });
        }
    }
    
    else if (commandName === 'warnings') {
        const target = options.getUser('user') || interaction.user;
        const userWarnings = client.warnings.get(guild.id);
        const warnings = userWarnings?.get(target.id) || [];
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`Warnings for ${target.tag}`).setDescription(warnings.length > 0 ? warnings.map((w, i) => `${i + 1}. ${w.reason} (by ${w.moderator})`).join('\n') : 'No warnings');
        await interaction.reply({ embeds: [embed] });
    }
    
    // ========== UTILITY COMMANDS ==========
    
    else if (commandName === 'ping') {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const api = Math.round(client.ws.ping);
        const color = api > 200 ? (api > 500 ? '#FF0000' : '#FFFF00') : '#00FF00';
        const status = api > 200 ? (api > 500 ? '🔴 Poor' : '🟡 Good') : '🟢 Excellent';
        const embed = new EmbedBuilder().setColor(color).setTitle(`${status} - ${roundtrip}ms`).addFields({ name: 'API Latency', value: `${api}ms`, inline: true }, { name: 'Uptime', value: `<t:${Math.floor(Date.now() / 1000 - client.uptime / 1000)}:R>`, inline: true });
        await interaction.editReply({ content: null, embeds: [embed] });
    }
    
    else if (commandName === 'serverinfo') {
        const embed = new EmbedBuilder().setTitle(guild.name).setThumbnail(guild.iconURL({ dynamic: true })).addFields({ name: '👑 Owner', value: (await guild.fetchOwner()).user.tag, inline: true }, { name: '👥 Members', value: `${guild.memberCount}`, inline: true }, { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true }, { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'userinfo') {
        const target = options.getUser('user') || interaction.user;
        const targetMember = await guild.members.fetch(target.id);
        const embed = new EmbedBuilder().setTitle(target.tag).setThumbnail(target.displayAvatarURL({ dynamic: true })).addFields({ name: 'ID', value: target.id, inline: true }, { name: 'Joined Server', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: true }, { name: 'Joined Discord', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'avatar') {
        const target = options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder().setTitle(`${target.tag}'s Avatar`).setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'botinfo') {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🤖 Bot Info').addFields({ name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }, { name: 'Users', value: `${client.users.cache.size}`, inline: true }, { name: 'Commands', value: `${commands.length}`, inline: true }, { name: 'Uptime', value: `<t:${Math.floor(Date.now() / 1000 - client.uptime / 1000)}:R>`, inline: true }, { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true });
        await interaction.reply({ embeds: [embed] });
    }
    
    else if (commandName === 'verify') {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        client.verificationCodes.set(interaction.user.id, code);
        await interaction.reply({ content: `🔐 Type this code in chat: \`${code}\``, ephemeral: true });
        const filter = m => m.author.id === interaction.user.id && m.content === code;
        const collector = channel.createMessageCollector({ filter, time: 300000, max: 1 });
        collector.on('collect', async () => {
            const verifySettings = client.guildSettings.get(guild.id)?.verification;
            if (verifySettings?.roleId) {
                const verifyRole = guild.roles.cache.get(verifySettings.roleId);
                if (verifyRole) await member.roles.add(verifyRole);
            }
            await interaction.followUp({ content: '✅ Verified!', ephemeral: true });
            client.verificationCodes.delete(interaction.user.id);
        });
    }
});

// ============ SERVER STATUS UPDATE FUNCTION ============
async function updateServerStatus(guild) {
    const settings = client.guildSettings.get(guild.id);
    if (!settings?.serverStatus?.enabled) return;
    const channel = guild.channels.cache.get(settings.serverStatus.channelId);
    if (!channel) return;
    
    const online = guild.members.cache.filter(m => m.presence?.status === 'online' && !m.user.bot).size;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    
    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('📊 Server Status')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
            { name: '🟢 Online', value: `${online}`, inline: true },
            { name: '🤖 Bots', value: `${bots}`, inline: true },
            { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true }
        )
        .setTimestamp();
    
    try {
        if (client.serverStatus.has(guild.id)) {
            const { messageId } = client.serverStatus.get(guild.id);
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed] });
        } else {
            const msg = await channel.send({ embeds: [embed] });
            client.serverStatus.set(guild.id, { channelId: channel.id, messageId: msg.id });
        }
    } catch(e) {}
}

// ============ BUTTON INTERACTIONS ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'verify_me') {
        const verifySettings = client.guildSettings.get(interaction.guild.id)?.verification;
        if (verifySettings?.roleId) {
            const role = interaction.guild.roles.cache.get(verifySettings.roleId);
            if (role && !interaction.member.roles.cache.has(role.id)) {
                await interaction.member.roles.add(role);
                await interaction.reply({ content: '✅ Verified!', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Already verified or role not found!', ephemeral: true });
            }
        }
    }
});

// ============ EXPRESS DASHBOARD API ============
const app = express();
app.use(cors());
app.use(express.json());

// Homepage
app.get('/', (req, res) => {
    res.json({
        bot: 'Fruxty',
        status: '🟢 Online',
        discord: 'https://discord.com/oauth2/authorize?client_id=' + process.env.CLIENT_ID,
        uptime: `${Math.floor(client.uptime / 1000 / 60)} minutes`,
        servers: client.guilds.cache.size,
        users: client.users.cache.size
    });
});

// API Status
app.get('/api/status', (req, res) => {
    res.json({
        name: 'Fruxty Bot',
        status: 'online',
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        ping: client.ws.ping,
        uptime: client.uptime
    });
});

// API Guilds
app.get('/api/guilds', (req, res) => {
    const guilds = client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        members: g.memberCount,
        icon: g.iconURL()
    }));
    res.json(guilds);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`📡 Fruxty API on port ${PORT}`));

// ============ LOGIN ============
client.login(process.env.DISCORD_TOKEN);
