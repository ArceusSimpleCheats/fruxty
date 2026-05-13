const { Client, GatewayIntentBits, REST, Routes, ActivityType, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

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

console.log('Fruxty bot is starting...');

// ============ Data Storage ============
const guildSettings = new Map();
const tempChannels = new Map();
const warnings = new Map();
const messageHistory = new Map();

// ============ Default Configuration ============
const defaultConfig = {
    automod: { enabled: true, action: 'warn' },
    antiNuke: true,
    antiRaid: true,
    logChannel: null,
    welcomeChannel: null,
    welcomeMessage: 'Welcome {user} to {server}!',
    goodbyeChannel: null,
    goodbyeMessage: '{user} has left the server.',
    verifyChannel: null,
    verifyRole: null,
    voiceCategory: null,
    voiceCreator: null,
    voiceSetup: false,
    leveling: { enabled: true, channel: null },
    serverStatus: { enabled: false, channel: null, messageId: null }
};

// ============ Bad Words List ============
const badWords = ['fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'bastard', 'nigga', 'faggot', 'retard', 'porn', 'xxx', 'nsfw', 'nude', 'sex', 'penis', 'vagina'];

// ============ Helper: Check if user is Admin ============
function isAdmin(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// ============ Helper: Check if user is Owner ============
function isOwner(member, guild) {
    return member.id === guild.ownerId;
}

// ============ Slash Commands ============
const commands = [
    // Utility
    { name: 'ping', description: 'Check bot latency' },
    { name: 'serverinfo', description: 'Get server information' },
    { name: 'userinfo', description: 'Get user info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'avatar', description: 'Get user avatar', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'botinfo', description: 'Get bot statistics' },
    { name: 'help', description: 'Show all commands' },
    
    // Leveling
    { name: 'rank', description: 'Check your level and XP' },
    { name: 'leaderboard', description: 'View top 10 users by level' },
    
    // Admin Setup Commands
    { name: 'setup', description: 'Setup bot protections (Admin only)' },
    { name: 'setup-voice', description: 'Setup temp voice channels (Admin only)' },
    { name: 'setup-verify', description: 'Setup verification system (Admin only)', options: [{ name: 'channel', type: 7, required: true }, { name: 'role', type: 8, required: true }] },
    { name: 'setup-welcome', description: 'Setup welcome channel (Admin only)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'setup-goodbye', description: 'Setup goodbye channel (Admin only)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'setup-status', description: 'Setup live server status channel (Admin only)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'automod', description: 'Toggle auto-moderation (Admin only)', options: [{ name: 'action', type: 3, required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
    
    // Moderation (Admin only or target non-admin)
    { name: 'purge', description: 'Delete messages (Admin only)', options: [{ name: 'amount', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'lockdown', description: 'Lock a channel (Admin only)', options: [{ name: 'channel', type: 7, required: false }] },
    { name: 'slowmode', description: 'Set slowmode (Admin only)', options: [{ name: 'seconds', type: 4, required: true, min_value: 0, max_value: 21600 }, { name: 'channel', type: 7, required: false }] },
    { name: 'ban', description: 'Ban a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'kick', description: 'Kick a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'timeout', description: 'Timeout a user', options: [{ name: 'user', type: 6, required: true }, { name: 'minutes', type: 4, required: true, min_value: 1, max_value: 1440 }] },
    { name: 'warn', description: 'Warn a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: true }] },
    { name: 'warnings', description: 'View user warnings', options: [{ name: 'user', type: 6, required: false }] },
    
    // Voice
    { name: 'vc', description: 'Manage your temporary voice channel', options: [
        { name: 'rename', type: 1, description: 'Rename your channel', options: [{ name: 'name', type: 3, description: 'New name', required: true }] },
        { name: 'limit', type: 1, description: 'Set user limit', options: [{ name: 'limit', type: 4, description: '1-99', required: true, min_value: 1, max_value: 99 }] },
        { name: 'lock', type: 1, description: 'Lock your channel' },
        { name: 'unlock', type: 1, description: 'Unlock your channel' },
        { name: 'hide', type: 1, description: 'Hide channel from member list' },
        { name: 'reveal', type: 1, description: 'Show channel to member list' },
        { name: 'claim', type: 1, description: 'Claim ownership (if owner left)' }
    ]},
    
    // Verification
    { name: 'verify', description: 'Verify yourself' }
];

// ============ Ready Event ============
client.once('ready', async () => {
    console.log(`Fruxty is online as ${client.user.tag}`);
    console.log(`Bot is in ${client.guilds.cache.size} servers`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`Registered ${commands.length} commands`);
    } catch(e) { console.error(e); }
    
    updateStatus();
    startServerStatusUpdater();
});

async function updateStatus() {
    const serverCount = client.guilds.cache.size;
    client.user.setPresence({
        activities: [{ name: `/help | ${serverCount} servers`, type: ActivityType.Watching }],
        status: 'online'
    });
}

setInterval(() => updateStatus(), 300000);

// ============ Server Status Auto-Updater ============
async function startServerStatusUpdater() {
    setInterval(async () => {
        for (const [guildId, config] of guildSettings) {
            if (config.serverStatus?.enabled && config.serverStatus.channelId) {
                await updateServerStatusMessage(client.guilds.cache.get(guildId));
            }
        }
    }, 300000);
}

async function updateServerStatusMessage(guild) {
    if (!guild) return;
    const config = guildSettings.get(guild.id);
    if (!config?.serverStatus?.enabled) return;
    
    const channel = guild.channels.cache.get(config.serverStatus.channelId);
    if (!channel) return;
    
    const totalMembers = guild.memberCount;
    const onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline' && !m.user.bot).size;
    const botCount = guild.members.cache.filter(m => m.user.bot).size;
    const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
    
    const embed = new EmbedBuilder()
        .setColor(0xFF6B35)
        .setTitle('Server Status')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: 'Total Members', value: `${totalMembers}`, inline: true },
            { name: 'Online Members', value: `${onlineMembers}`, inline: true },
            { name: 'Bots', value: `${botCount}`, inline: true },
            { name: 'Text Channels', value: `${textChannels}`, inline: true },
            { name: 'Voice Channels', value: `${voiceChannels}`, inline: true },
            { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
        )
        .setTimestamp();
    
    try {
        if (config.serverStatus.messageId) {
            const msg = await channel.messages.fetch(config.serverStatus.messageId);
            await msg.edit({ embeds: [embed] });
        } else {
            const msg = await channel.send({ embeds: [embed] });
            config.serverStatus.messageId = msg.id;
            guildSettings.set(guild.id, config);
        }
    } catch(e) { console.error('Status update failed:', e.message); }
}

// ============ Welcome & Goodbye Messages ============
client.on('guildMemberAdd', async (member) => {
    const config = guildSettings.get(member.guild.id);
    if (!config?.welcomeChannel) return;
    
    const channel = member.guild.channels.cache.get(config.welcomeChannel);
    if (!channel) return;
    
    const message = config.welcomeMessage
        .replace('{user}', `<@${member.id}>`)
        .replace('{server}', member.guild.name)
        .replace('{membercount}', member.guild.memberCount);
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Welcome to the server!')
        .setDescription(message)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();
    
    await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
    const config = guildSettings.get(member.guild.id);
    if (!config?.goodbyeChannel) return;
    
    const channel = member.guild.channels.cache.get(config.goodbyeChannel);
    if (!channel) return;
    
    const message = config.goodbyeMessage
        .replace('{user}', member.user.tag)
        .replace('{server}', member.guild.name)
        .replace('{membercount}', member.guild.memberCount);
    
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Goodbye!')
        .setDescription(message)
        .setTimestamp();
    
    await channel.send({ embeds: [embed] });
});

// ============ Auto-Moderation (Skips Admins) ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Skip admins completely
    if (isAdmin(message.member)) return;
    
    const config = guildSettings.get(message.guild.id) || defaultConfig;
    if (!config.automod?.enabled) return;
    
    const content = message.content.toLowerCase();
    const foundBadWord = badWords.find(word => content.includes(word));
    
    if (foundBadWord) {
        await message.delete();
        
        const userWarnings = warnings.get(`${message.guild.id}-${message.author.id}`) || [];
        userWarnings.push({ reason: `Bad word: ${foundBadWord}`, date: Date.now(), mod: 'AutoMod' });
        warnings.set(`${message.guild.id}-${message.author.id}`, userWarnings);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('AutoMod')
            .setDescription(`${message.author}, your message was deleted for inappropriate language.`)
            .addFields({ name: 'Warning', value: `${userWarnings.length}/3` });
        
        const warningMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => warningMsg.delete(), 5000);
        
        if (userWarnings.length >= 3) {
            await message.member.timeout(30 * 60 * 1000, '3 warnings');
            warnings.delete(`${message.guild.id}-${message.author.id}`);
        }
    }
    
    // Anti-spam (skips admins)
    const now = Date.now();
    const userHistory = messageHistory.get(`${message.guild.id}-${message.author.id}`) || [];
    const recent = userHistory.filter(t => now - t < 5000);
    recent.push(now);
    messageHistory.set(`${message.guild.id}-${message.author.id}`, recent);
    
    if (recent.length > 5) {
        await message.delete();
        await message.member.timeout(60 * 1000, 'Spamming');
        messageHistory.delete(`${message.guild.id}-${message.author.id}`);
    }
    
    setTimeout(() => {
        const current = messageHistory.get(`${message.guild.id}-${message.author.id}`) || [];
        messageHistory.set(`${message.guild.id}-${message.author.id}`, current.filter(t => now - t < 5000));
    }, 5000);
});

// ============ Leveling System (Skips Admins) ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (isAdmin(message.member)) return;
    
    const config = guildSettings.get(message.guild.id) || defaultConfig;
    if (!config.leveling?.enabled) return;
    
    const levels = guildSettings.get('levels') || new Map();
    const key = `${message.guild.id}-${message.author.id}`;
    let userData = levels.get(key) || { xp: 0, level: 0, totalXP: 0 };
    
    const xpGain = Math.floor(Math.random() * 10) + 5;
    userData.xp += xpGain;
    userData.totalXP += xpGain;
    
    if (userData.xp >= 100) {
        userData.level++;
        userData.xp = 0;
        await message.channel.send(`${message.author} reached Level ${userData.level}!`);
    }
    
    levels.set(key, userData);
    guildSettings.set('levels', levels);
});

// ============ Voice State Update (Temp Channels) ============
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild) return;
    
    const config = guildSettings.get(newState.guild.id) || defaultConfig;
    if (!config.voiceSetup) return;
    
    if (newState.channelId === config.voiceCreator && !oldState.channelId) {
        const member = newState.member;
        
        let existingChannel = null;
        for (const [channelId, data] of tempChannels) {
            if (data.ownerId === member.id) {
                existingChannel = newState.guild.channels.cache.get(channelId);
                break;
            }
        }
        
        if (existingChannel) {
            await member.voice.setChannel(existingChannel);
            return;
        }
        
        const channelName = `${member.user.username}'s VC`.slice(0, 32);
        const channel = await newState.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: config.voiceCategory,
            userLimit: 10,
            permissionOverwrites: [
                { id: member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers] },
                { id: newState.guild.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }
            ]
        });
        
        tempChannels.set(channel.id, { ownerId: member.id, ownerTag: member.user.tag });
        await member.voice.setChannel(channel);
        
        try {
            await member.send(`Created your temp voice channel: **${channel.name}**\nUse /vc rename, /vc lock, /vc limit, /vc hide, /vc claim to manage it.`);
        } catch(e) {}
    }
    
    if (oldState.channelId && tempChannels.has(oldState.channelId)) {
        const channel = oldState.guild.channels.cache.get(oldState.channelId);
        if (channel && channel.members.size === 0) {
            setTimeout(async () => {
                const freshChannel = oldState.guild.channels.cache.get(oldState.channelId);
                if (freshChannel && freshChannel.members.size === 0) {
                    await freshChannel.delete();
                    tempChannels.delete(oldState.channelId);
                }
            }, 10000);
        }
    }
});

// ============ Command Handler ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, guild, member, channel } = interaction;
    const config = guildSettings.get(guild?.id) || { ...defaultConfig };
    
    // ============ Help Command ============
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('Fruxty Bot Commands')
            .setDescription('Here are all my commands!')
            .addFields(
                { name: 'Information', value: '/ping, /serverinfo, /userinfo, /avatar, /botinfo', inline: false },
                { name: 'Leveling', value: '/rank, /leaderboard', inline: false },
                { name: 'Moderation', value: '/ban, /kick, /timeout, /warn, /warnings, /purge, /lockdown, /slowmode', inline: false },
                { name: 'Setup', value: '/setup, /setup-voice, /setup-verify, /setup-welcome, /setup-goodbye, /setup-status, /automod', inline: false },
                { name: 'Voice', value: '/vc rename, /vc limit, /vc lock, /vc unlock, /vc hide, /vc reveal, /vc claim', inline: false },
                { name: 'Verification', value: '/verify', inline: false }
            );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
    
    // ============ Ping Command ============
    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const api = Math.round(client.ws.ping);
        const embed = new EmbedBuilder()
            .setColor(api < 200 ? 0x00FF00 : api < 500 ? 0xFFFF00 : 0xFF0000)
            .setTitle('Pong!')
            .addFields(
                { name: 'Roundtrip', value: `${roundtrip}ms`, inline: true },
                { name: 'API Latency', value: `${api}ms`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
            );
        await interaction.editReply({ content: null, embeds: [embed] });
        return;
    }
    
    // ============ Server Info ============
    if (commandName === 'serverinfo') {
        await interaction.deferReply();
        const owner = await guild.fetchOwner();
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: 'Owner', value: owner.user.tag, inline: true },
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ User Info ============
    if (commandName === 'userinfo') {
        await interaction.deferReply();
        const target = options.getUser('user') || interaction.user;
        const targetMember = await guild.members.fetch(target.id);
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(target.tag)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'ID', value: target.id, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Joined Discord', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ Avatar ============
    if (commandName === 'avatar') {
        const target = options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`${target.tag}'s Avatar`)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Bot Info ============
    if (commandName === 'botinfo') {
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('Fruxty Bot')
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: 'Users', value: `${client.users.cache.size}`, inline: true },
                { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
                { name: 'Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true },
                { name: 'Commands', value: `${commands.length}`, inline: true }
            );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Rank Command ============
    if (commandName === 'rank') {
        const levels = guildSettings.get('levels') || new Map();
        const key = `${guild.id}-${interaction.user.id}`;
        const userData = levels.get(key) || { xp: 0, level: 0, totalXP: 0 };
        
        let allUsers = [];
        for (const [k, data] of levels) {
            if (k.startsWith(guild.id)) {
                allUsers.push({ userId: k.split('-')[1], totalXP: data.totalXP });
            }
        }
        allUsers.sort((a, b) => b.totalXP - a.totalXP);
        const rank = allUsers.findIndex(u => u.userId === interaction.user.id) + 1;
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`${interaction.user.username}'s Rank`)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Level', value: `${userData.level}`, inline: true },
                { name: 'Rank', value: `#${rank}`, inline: true },
                { name: 'Total XP', value: `${userData.totalXP}`, inline: true },
                { name: 'Progress', value: `${userData.xp}/100 XP`, inline: false }
            );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Leaderboard ============
    if (commandName === 'leaderboard') {
        await interaction.deferReply();
        const levels = guildSettings.get('levels') || new Map();
        
        let allUsers = [];
        for (const [k, data] of levels) {
            if (k.startsWith(guild.id)) {
                allUsers.push({ userId: k.split('-')[1], level: data.level, totalXP: data.totalXP });
            }
        }
        allUsers.sort((a, b) => b.totalXP - a.totalXP);
        const top10 = allUsers.slice(0, 10);
        
        let leaderboardText = '';
        for (let i = 0; i < top10.length; i++) {
            const user = await client.users.fetch(top10[i].userId).catch(() => null);
            const username = user ? user.username : 'Unknown User';
            leaderboardText += `${i+1}. **${username}** - Level ${top10[i].level}\n`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('Server Leaderboard')
            .setDescription(leaderboardText || 'No users ranked yet!');
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ Setup Command ============
    if (commandName === 'setup') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        guildSettings.set(guild.id, defaultConfig);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Setup Complete')
            .setDescription('Fruxty is now protecting your server!')
            .addFields(
                { name: 'AutoMod', value: 'Enabled', inline: true },
                { name: 'Leveling', value: 'Enabled', inline: true },
                { name: 'Anti-Nuke', value: 'Enabled', inline: true }
            );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Setup Voice ============
    if (commandName === 'setup-voice') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        await interaction.reply({ content: 'Setting up temp voice channels...', ephemeral: true });
        
        const category = await guild.channels.create({ name: 'Temp Voice', type: ChannelType.GuildCategory });
        const creatorChannel = await guild.channels.create({ name: 'create-vc', type: ChannelType.GuildVoice, parent: category.id });
        
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.voiceSetup = true;
        newConfig.voiceCategory = category.id;
        newConfig.voiceCreator = creatorChannel.id;
        guildSettings.set(guild.id, newConfig);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Temp Voice Setup Complete')
            .setDescription(`Join **${creatorChannel.name}** to get your own private voice channel!`);
        await interaction.editReply({ content: null, embeds: [embed] });
        return;
    }
    
    // ============ Setup Verify ============
    if (commandName === 'setup-verify') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const verifyChannel = options.getChannel('channel');
        const verifyRole = options.getRole('role');
        
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.verifyChannel = verifyChannel.id;
        newConfig.verifyRole = verifyRole.id;
        guildSettings.set(guild.id, newConfig);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Verification Setup')
            .setDescription(`Click the button below to get ${verifyRole.name}`);
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Verify Me')
                    .setStyle(ButtonStyle.Success)
            );
        
        await verifyChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `Verification setup in ${verifyChannel}!`, ephemeral: true });
        return;
    }
    
    // ============ Setup Welcome ============
    if (commandName === 'setup-welcome') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const welcomeChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.welcomeChannel = welcomeChannel.id;
        guildSettings.set(guild.id, newConfig);
        
        await interaction.reply({ content: `Welcome messages will be sent to ${welcomeChannel}!`, ephemeral: true });
        return;
    }
    
    // ============ Setup Goodbye ============
    if (commandName === 'setup-goodbye') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const goodbyeChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.goodbyeChannel = goodbyeChannel.id;
        guildSettings.set(guild.id, newConfig);
        
        await interaction.reply({ content: `Goodbye messages will be sent to ${goodbyeChannel}!`, ephemeral: true });
        return;
    }
    
    // ============ Setup Status ============
    if (commandName === 'setup-status') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const statusChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.serverStatus = { enabled: true, channelId: statusChannel.id, messageId: null };
        guildSettings.set(guild.id, newConfig);
        
        await interaction.reply({ content: `Server status will be sent to ${statusChannel} every 5 minutes!`, ephemeral: true });
        await updateServerStatusMessage(guild);
        return;
    }
    
    // ============ AutoMod Toggle ============
    if (commandName === 'automod') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const action = options.getString('action');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.automod = { ...newConfig.automod, enabled: action === 'on' };
        guildSettings.set(guild.id, newConfig);
        
        await interaction.reply({ content: `AutoMod turned ${action.toUpperCase()}!`, ephemeral: true });
        return;
    }
    
    // ============ Ban Command ============
    if (commandName === 'ban') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.bannable) {
            return interaction.reply({ content: 'Cannot ban this user!', ephemeral: true });
        }
        
        await targetMember.ban({ reason });
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('User Banned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Kick Command ============
    if (commandName === 'kick') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.kickable) {
            return interaction.reply({ content: 'Cannot kick this user!', ephemeral: true });
        }
        
        await targetMember.kick(reason);
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('User Kicked').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Timeout Command ============
    if (commandName === 'timeout') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const minutes = options.getInteger('minutes');
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.moderatable) {
            return interaction.reply({ content: 'Cannot timeout this user!', ephemeral: true });
        }
        
        await targetMember.timeout(minutes * 60 * 1000);
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('User Timed Out').addFields({ name: 'User', value: target.tag }, { name: 'Duration', value: `${minutes} minutes` });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Warn Command ============
    if (commandName === 'warn') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason');
        const key = `${guild.id}-${target.id}`;
        const userWarnings = warnings.get(key) || [];
        userWarnings.push({ reason, date: Date.now(), mod: interaction.user.tag });
        warnings.set(key, userWarnings);
        
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('User Warned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason }, { name: 'Total Warnings', value: `${userWarnings.length}` });
        await interaction.reply({ embeds: [embed] });
        
        if (userWarnings.length >= 3) {
            const targetMember = await guild.members.fetch(target.id);
            await targetMember.timeout(30 * 60 * 1000, '3 warnings');
            await interaction.followUp({ content: `${target.tag} was timed out for 30 minutes (3 warnings)` });
            warnings.delete(key);
        }
        return;
    }
    
    // ============ Warnings Command ============
    if (commandName === 'warnings') {
        const target = options.getUser('user') || interaction.user;
        const userWarnings = warnings.get(`${guild.id}-${target.id}`) || [];
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`${target.tag}'s Warnings`)
            .setDescription(userWarnings.length > 0 ? userWarnings.map((w, i) => `${i+1}. ${w.reason} (by ${w.mod})`).join('\n') : 'No warnings');
        
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Purge Command ============
    if (commandName === 'purge') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const amount = options.getInteger('amount');
        const messages = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(messages, true);
        await interaction.reply({ content: `Deleted ${deleted.size} messages!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
        return;
    }
    
    // ============ Lockdown Command ============
    if (commandName === 'lockdown') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        await interaction.reply({ content: `${targetChannel} locked down!`, ephemeral: true });
        return;
    }
    
    // ============ Slowmode Command ============
    if (commandName === 'slowmode') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        
        const seconds = options.getInteger('seconds');
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.setRateLimitPerUser(seconds);
        await interaction.reply({ content: `Slowmode set to ${seconds} seconds in ${targetChannel}!`, ephemeral: true });
        return;
    }
    
    // ============ Verify Command ============
    if (commandName === 'verify') {
        const config = guildSettings.get(guild.id) || defaultConfig;
        if (!config.verifyRole) {
            return interaction.reply({ content: 'Verification not setup! Ask an admin to run /setup-verify.', ephemeral: true });
        }
        
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const verifyCodes = client.verifyCodes || new Map();
        verifyCodes.set(interaction.user.id, { code, expires: Date.now() + 300000 });
        client.verifyCodes = verifyCodes;
        
        await interaction.reply({ content: `Type this code in chat: \`${code}\``, ephemeral: true });
        
        const filter = m => m.author.id === interaction.user.id && m.content === code;
        const collector = channel.createMessageCollector({ filter, time: 300000, max: 1 });
        
        collector.on('collect', async () => {
            const role = guild.roles.cache.get(config.verifyRole);
            if (role) await member.roles.add(role);
            await interaction.followUp({ content: 'Verified!', ephemeral: true });
            verifyCodes.delete(interaction.user.id);
        });
        return;
    }
    
    // ============ Voice Channel Commands ============
    if (commandName === 'vc') {
        let userChannel = null;
        let userChannelId = null;
        
        for (const [channelId, data] of tempChannels) {
            if (data.ownerId === member.id) {
                userChannelId = channelId;
                userChannel = guild.channels.cache.get(channelId);
                break;
            }
        }
        
        if (!userChannel) {
            return interaction.reply({ content: 'You do not own a temporary voice channel! Join the create channel to make one.', ephemeral: true });
        }
        
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'rename') {
            const newName = options.getString('name');
            await userChannel.setName(newName.slice(0, 32));
            await interaction.reply({ content: `Channel renamed to ${newName}`, ephemeral: true });
        }
        else if (subcommand === 'limit') {
            const limit = options.getInteger('limit');
            await userChannel.setUserLimit(limit);
            await interaction.reply({ content: `User limit set to ${limit}`, ephemeral: true });
        }
        else if (subcommand === 'lock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: false });
            await interaction.reply({ content: 'Channel locked. Only you can join.', ephemeral: true });
        }
        else if (subcommand === 'unlock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: null });
            await interaction.reply({ content: 'Channel unlocked. Everyone can join.', ephemeral: true });
        }
        else if (subcommand === 'hide') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
            await interaction.reply({ content: 'Channel hidden from member list.', ephemeral: true });
        }
        else if (subcommand === 'reveal') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
            await interaction.reply({ content: 'Channel visible to everyone.', ephemeral: true });
        }
        else if (subcommand === 'claim') {
            const owner = userChannel.members.get(tempChannels.get(userChannelId)?.ownerId);
            if (owner && owner.id !== member.id) {
                return interaction.reply({ content: 'The owner is still in the channel!', ephemeral: true });
            }
            
            const oldData = tempChannels.get(userChannelId);
            tempChannels.set(userChannelId, { ...oldData, ownerId: member.id, ownerTag: member.user.tag });
            await userChannel.permissionOverwrites.edit(member.id, { Connect: true, ManageChannels: true });
            await interaction.reply({ content: 'You are now the owner of this voice channel!', ephemeral: true });
        }
        return;
    }
});

// ============ Button Handler ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'verify_button') {
        const config = guildSettings.get(interaction.guild.id) || defaultConfig;
        if (!config.verifyRole) {
            return interaction.reply({ content: 'Verification not setup!', ephemeral: true });
        }
        
        const role = interaction.guild.roles.cache.get(config.verifyRole);
        if (!role) {
            return interaction.reply({ content: 'Verification role not found!', ephemeral: true });
        }
        
        if (interaction.member.roles.cache.has(role.id)) {
            return interaction.reply({ content: 'You are already verified!', ephemeral: true });
        }
        
        await interaction.member.roles.add(role);
        await interaction.reply({ content: 'You have been verified!', ephemeral: true });
    }
});

// ============ Express Server for Uptime ============
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Fruxty Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/api/status', (req, res) => {
    res.json({
        name: 'Fruxty Bot',
        status: 'online',
        guilds: client.guilds.cache.size,
        ping: client.ws.ping,
        uptime: client.uptime,
        commands: commands.length
    });
});

app.get('/api/guilds', (req, res) => {
    const guildList = client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL(),
        memberCount: g.memberCount,
        ownerId: g.ownerId
    }));
    res.json(guildList);
});

app.get('/api/guilds/:guildId/settings', (req, res) => {
    const config = guildSettings.get(req.params.guildId) || defaultConfig;
    res.json({
        automod: config.automod,
        voiceSetup: config.voiceSetup,
        verifyChannel: config.verifyChannel,
        verifyRole: config.verifyRole,
        welcomeChannel: config.welcomeChannel,
        goodbyeChannel: config.goodbyeChannel,
        serverStatus: config.serverStatus,
        leveling: config.leveling
    });
});

app.post('/api/guilds/:guildId/settings', (req, res) => {
    const { guildId } = req.params;
    const newSettings = req.body;
    const current = guildSettings.get(guildId) || defaultConfig;
    guildSettings.set(guildId, { ...current, ...newSettings });
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});

// ============ Login ============
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    process.exit(1);
});
