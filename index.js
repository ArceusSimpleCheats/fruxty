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

// ============ DATA STORAGE ============
const guildConfig = new Map();
const tempChannels = new Map();
const warnings = new Map();
const messageHistory = new Map();
const debugLogs = [];

// ============ DEFAULT CONFIG ============
const defaultConfig = {
    automod: { enabled: true, action: 'warn' },
    antiNuke: true,
    antiRaid: true,
    logChannel: null,
    verifyChannel: null,
    verifyRole: null,
    voiceCategory: null,
    voiceCreator: null,
    voiceSetup: false
};

// ============ BAD WORDS ============
const badWords = ['fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'bastard', 'nigga', 'faggot', 'retard', 'porn', 'xxx', 'nsfw', 'nude', 'sex', 'penis', 'vagina'];

// ============ LOG DEBUG ============
function addDebugLog(action, data) {
    const log = {
        id: debugLogs.length + 1,
        timestamp: Date.now(),
        timestampFormatted: new Date().toISOString(),
        action,
        data
    };
    debugLogs.unshift(log);
    if (debugLogs.length > 100) debugLogs.pop();
    console.log(`[DEBUG] ${action}:`, data);
    return log;
}

// ============ SLASH COMMANDS ============
const commands = [
    { name: 'ping', description: 'Check bot latency' },
    { name: 'serverinfo', description: 'Get server information' },
    { name: 'userinfo', description: 'Get user info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'avatar', description: 'Get user avatar', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'botinfo', description: 'Get bot statistics' },
    { name: 'setup', description: 'Setup Fruxty bot (Admin only)' },
    { name: 'setup-voice', description: 'Setup temp voice channels (Admin only)' },
    { name: 'setup-verify', description: 'Setup verification system (Admin only)', options: [{ name: 'channel', type: 7, required: true }, { name: 'role', type: 8, required: true }] },
    { name: 'automod', description: 'Toggle auto-moderation (Admin only)', options: [{ name: 'action', type: 3, required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
    { name: 'purge', description: 'Delete messages (Admin only)', options: [{ name: 'amount', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'lockdown', description: 'Lock a channel (Admin only)', options: [{ name: 'channel', type: 7, required: false }] },
    { name: 'ban', description: 'Ban a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'kick', description: 'Kick a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'timeout', description: 'Timeout a user', options: [{ name: 'user', type: 6, required: true }, { name: 'minutes', type: 4, required: true, min_value: 1, max_value: 1440 }] },
    { name: 'warn', description: 'Warn a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: true }] },
    { name: 'warnings', description: 'View user warnings', options: [{ name: 'user', type: 6, required: false }] },
    { name: 'vc', description: 'Manage your temporary voice channel', options: [
        { name: 'rename', type: 1, description: 'Rename your channel', options: [{ name: 'name', type: 3, description: 'New name', required: true }] },
        { name: 'limit', type: 1, description: 'Set user limit', options: [{ name: 'limit', type: 4, description: '1-99', required: true, min_value: 1, max_value: 99 }] },
        { name: 'lock', type: 1, description: 'Lock your channel' },
        { name: 'unlock', type: 1, description: 'Unlock your channel' },
        { name: 'hide', type: 1, description: 'Hide channel from member list' },
        { name: 'reveal', type: 1, description: 'Show channel to member list' },
        { name: 'claim', type: 1, description: 'Claim ownership (if owner left)' }
    ]},
    { name: 'verify', description: 'Verify yourself' },
    { name: 'owner', description: 'Owner only commands', options: [
        { name: 'debug', type: 1, description: 'Debug a user', options: [{ name: 'user', type: 6, description: 'User ID', required: true }] },
        { name: 'guilds', type: 1, description: 'List all guilds bot is in' },
        { name: 'leave', type: 1, description: 'Make bot leave a guild', options: [{ name: 'guildid', type: 3, description: 'Guild ID', required: true }] },
        { name: 'exec', type: 1, description: 'Execute a command in a guild', options: [{ name: 'guildid', type: 3, required: true }, { name: 'command', type: 3, required: true }] }
    ]}
];

// ============ READY EVENT ============
client.once('ready', async () => {
    console.log(`✅ Fruxty is online as ${client.user.tag}`);
    addDebugLog('BOT_START', { tag: client.user.tag, id: client.user.id, guilds: client.guilds.cache.size });
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Registered ${commands.length} commands`);
    } catch(e) { console.error(e); }
    
    updateStatus();
});

async function updateStatus() {
    const serverCount = client.guilds.cache.size;
    client.user.setPresence({
        activities: [{ name: `/help | ${serverCount} servers`, type: ActivityType.Watching }],
        status: 'online'
    });
}

setInterval(() => updateStatus(), 300000);

// ============ MESSAGE CREATE (AutoMod) ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const config = guildConfig.get(message.guild.id) || defaultConfig;
    if (!config.automod?.enabled) return;
    
    const content = message.content.toLowerCase();
    const foundBadWord = badWords.find(word => content.includes(word));
    
    if (foundBadWord) {
        await message.delete();
        addDebugLog('AUTOMOD_VIOLATION', { userId: message.author.id, guildId: message.guild.id, violation: foundBadWord });
        
        const userWarnings = warnings.get(`${message.guild.id}-${message.author.id}`) || [];
        userWarnings.push({ reason: `Bad word: ${foundBadWord}`, date: Date.now(), mod: 'AutoMod' });
        warnings.set(`${message.guild.id}-${message.author.id}`, userWarnings);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🛡️ AutoMod')
            .setDescription(`${message.author}, your message was deleted for inappropriate language.`)
            .addFields({ name: 'Warning', value: `${userWarnings.length}/3` });
        
        const warningMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => warningMsg.delete(), 5000);
        
        if (userWarnings.length >= 3) {
            await message.member.timeout(30 * 60 * 1000, '3 warnings');
            addDebugLog('AUTO_TIMEOUT', { userId: message.author.id, guildId: message.guild.id, warnings: userWarnings.length });
            warnings.delete(`${message.guild.id}-${message.author.id}`);
        }
    }
    
    // Anti-spam
    const now = Date.now();
    const userHistory = messageHistory.get(`${message.guild.id}-${message.author.id}`) || [];
    const recent = userHistory.filter(t => now - t < 5000);
    recent.push(now);
    messageHistory.set(`${message.guild.id}-${message.author.id}`, recent);
    
    if (recent.length > 5) {
        await message.delete();
        await message.member.timeout(60 * 1000, 'Spamming');
        addDebugLog('SPAM_TIMEOUT', { userId: message.author.id, guildId: message.guild.id, messages: recent.length });
        messageHistory.delete(`${message.guild.id}-${message.author.id}`);
    }
    
    setTimeout(() => {
        const current = messageHistory.get(`${message.guild.id}-${message.author.id}`) || [];
        messageHistory.set(`${message.guild.id}-${message.author.id}`, current.filter(t => now - t < 5000));
    }, 5000);
});

// ============ VOICE STATE UPDATE ============
client.on('voiceStateUpdate', async (oldState, newState) => {
    const config = guildConfig.get(newState.guild?.id) || defaultConfig;
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
        
        tempChannels.set(channel.id, { ownerId: member.id, ownerTag: member.user.tag, locked: false, hidden: false, createdAt: Date.now() });
        await member.voice.setChannel(channel);
        addDebugLog('TEMP_CHANNEL_CREATED', { userId: member.id, channelId: channel.id, channelName });
        
        try {
            await member.send(`✅ Created your temp voice channel: **${channel.name}**\nUse \`/vc rename\`, \`/vc lock\`, \`/vc limit\`, \`/vc hide\`, \`/vc claim\` to manage it.`);
        } catch(e) {}
    }
    
    if (oldState.channelId && tempChannels.has(oldState.channelId)) {
        const channel = oldState.guild.channels.cache.get(oldState.channelId);
        if (channel && channel.members.size === 0) {
            setTimeout(async () => {
                const freshChannel = oldState.guild.channels.cache.get(oldState.channelId);
                if (freshChannel && freshChannel.members.size === 0) {
                    addDebugLog('TEMP_CHANNEL_DELETED', { channelId: oldState.channelId, channelName: freshChannel.name });
                    await freshChannel.delete();
                    tempChannels.delete(oldState.channelId);
                }
            }, 10000);
        }
    }
});

// ============ COMMAND HANDLER ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, guild, member, channel } = interaction;
    const config = guildConfig.get(guild?.id) || { ...defaultConfig };
    
    addDebugLog('COMMAND_USED', { command: commandName, userId: interaction.user.id, guildId: guild?.id });
    
    // ============ OWNER COMMANDS ============
    if (commandName === 'owner') {
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: '❌ Owner only command!', ephemeral: true });
        }
        
        const subcommand = options.getSubcommand();
        
        // Debug user
        if (subcommand === 'debug') {
            const targetUser = options.getUser('user');
            await interaction.deferReply({ ephemeral: true });
            
            const debugInfo = await getUserDebugInfo(targetUser.id);
            
            const embed = new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle(`🔍 Debug: ${targetUser.tag}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 User ID', value: targetUser.id, inline: true },
                    { name: '📅 Account Age', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '🤖 Is Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                    { name: '🌍 Servers Found', value: `${debugInfo.serversFound}`, inline: true },
                    { name: '⚠️ Total Warnings', value: `${debugInfo.totalWarnings}`, inline: true },
                    { name: '🎤 Temp Channels', value: `${debugInfo.tempChannels}`, inline: true }
                )
                .setFooter({ text: `Debug by ${interaction.user.tag}` });
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // List all guilds
        else if (subcommand === 'guilds') {
            await interaction.deferReply({ ephemeral: true });
            const guildList = client.guilds.cache.map(g => `**${g.name}** - ${g.id} (${g.memberCount} members)`).join('\n');
            await interaction.editReply({ content: `**Bot is in ${client.guilds.cache.size} guilds:**\n\n${guildList}`, ephemeral: true });
        }
        
        // Leave guild
        else if (subcommand === 'leave') {
            const guildId = options.getString('guildid');
            const targetGuild = client.guilds.cache.get(guildId);
            
            if (!targetGuild) {
                return interaction.reply({ content: '❌ Guild not found or bot not in it!', ephemeral: true });
            }
            
            await targetGuild.leave();
            await interaction.reply({ content: `✅ Left guild: **${targetGuild.name}**`, ephemeral: true });
            addDebugLog('OWNER_LEFT_GUILD', { guildId, guildName: targetGuild.name });
        }
        
        // Execute command in guild
        else if (subcommand === 'exec') {
            const guildId = options.getString('guildid');
            const commandText = options.getString('command');
            const targetGuild = client.guilds.cache.get(guildId);
            
            if (!targetGuild) {
                return interaction.reply({ content: '❌ Guild not found!', ephemeral: true });
            }
            
            await interaction.reply({ content: `⏳ Executing \`${commandText}\` in **${targetGuild.name}**...`, ephemeral: true });
            addDebugLog('OWNER_EXEC', { guildId, command: commandText });
        }
    }
    
    // ============ PING ============
    else if (commandName === 'ping') {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const api = Math.round(client.ws.ping);
        const embed = new EmbedBuilder()
            .setColor(api < 200 ? 0x00FF00 : api < 500 ? 0xFFFF00 : 0xFF0000)
            .setTitle('🏓 Fruxty Ping')
            .addFields(
                { name: 'Roundtrip', value: `${roundtrip}ms`, inline: true },
                { name: 'API Latency', value: `${api}ms`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
            );
        await interaction.editReply({ content: null, embeds: [embed] });
    }
    
    // ============ SERVER INFO ============
    else if (commandName === 'serverinfo') {
        const embed = new EmbedBuilder()
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '👑 Owner', value: (await guild.fetchOwner()).user.tag, inline: true },
                { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
                { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
            );
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ USER INFO ============
    else if (commandName === 'userinfo') {
        const target = options.getUser('user') || interaction.user;
        const targetMember = await guild.members.fetch(target.id);
        const embed = new EmbedBuilder()
            .setTitle(target.tag)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🆔 ID', value: target.id, inline: true },
                { name: '📅 Joined Server', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: '📅 Joined Discord', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true }
            );
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ AVATAR ============
    else if (commandName === 'avatar') {
        const target = options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder()
            .setTitle(`${target.tag}'s Avatar`)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ BOT INFO ============
    else if (commandName === 'botinfo') {
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('🤖 Fruxty Bot')
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: '📊 Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: '👥 Users', value: `${client.users.cache.size}`, inline: true },
                { name: '🏓 Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
                { name: '⏰ Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true },
                { name: '📝 Commands', value: `${commands.length}`, inline: true }
            );
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ SETUP ============
    else if (commandName === 'setup') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        config.automod = { enabled: true, action: 'warn' };
        config.antiNuke = true;
        config.antiRaid = true;
        guildConfig.set(guild.id, config);
        addDebugLog('SETUP_COMPLETE', { guildId: guild.id, userId: interaction.user.id });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Fruxty Bot Setup Complete')
            .setDescription('Fruxty is now protecting your server!')
            .addFields(
                { name: '🛡️ AutoMod', value: 'Enabled', inline: true },
                { name: '🚨 Anti-Nuke', value: 'Enabled', inline: true },
                { name: '📊 Anti-Raid', value: 'Enabled', inline: true }
            );
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ SETUP VOICE ============
    else if (commandName === 'setup-voice') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        await interaction.reply({ content: '🔧 Setting up temp voice channels...', ephemeral: true });
        
        const category = await guild.channels.create({ name: '🎤 Temp Voice', type: ChannelType.GuildCategory });
        const creatorChannel = await guild.channels.create({ name: '➕-create-vc', type: ChannelType.GuildVoice, parent: category.id });
        
        config.voiceSetup = true;
        config.voiceCategory = category.id;
        config.voiceCreator = creatorChannel.id;
        guildConfig.set(guild.id, config);
        addDebugLog('VOICE_SETUP', { guildId: guild.id, categoryId: category.id, creatorId: creatorChannel.id });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Temp Voice Setup Complete')
            .setDescription(`Join **${creatorChannel.name}** to get your own private voice channel!`)
            .addFields(
                { name: 'Commands', value: '`/vc rename`, `/vc lock`, `/vc limit`, `/vc hide`, `/vc claim`', inline: false }
            );
        
        await interaction.editReply({ content: null, embeds: [embed] });
    }
    
    // ============ SETUP VERIFY ============
    else if (commandName === 'setup-verify') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const verifyChannel = options.getChannel('channel');
        const verifyRole = options.getRole('role');
        
        config.verifyChannel = verifyChannel.id;
        config.verifyRole = verifyRole.id;
        guildConfig.set(guild.id, config);
        addDebugLog('VERIFY_SETUP', { guildId: guild.id, channelId: verifyChannel.id, roleId: verifyRole.id });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🔐 Verification Setup')
            .setDescription(`Click the button below to get ${verifyRole}`);
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Verify Me')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        
        await verifyChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Verification setup in ${verifyChannel}!`, ephemeral: true });
    }
    
    // ============ AUTOMOD TOGGLE ============
    else if (commandName === 'automod') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const action = options.getString('action');
        config.automod = { ...config.automod, enabled: action === 'on' };
        guildConfig.set(guild.id, config);
        addDebugLog('AUTOMOD_TOGGLE', { guildId: guild.id, enabled: action === 'on' });
        await interaction.reply({ content: `✅ AutoMod turned ${action.toUpperCase()}!`, ephemeral: true });
    }
    
    // ============ PURGE ============
    else if (commandName === 'purge') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const amount = options.getInteger('amount');
        const messages = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(messages, true);
        addDebugLog('PURGE', { guildId: guild.id, channelId: channel.id, amount: deleted.size });
        await interaction.reply({ content: `✅ Deleted ${deleted.size} messages!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply(), 3000);
    }
    
    // ============ LOCKDOWN ============
    else if (commandName === 'lockdown') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        addDebugLog('LOCKDOWN', { guildId: guild.id, channelId: targetChannel.id });
        await interaction.reply({ content: `🔒 ${targetChannel} locked down!`, ephemeral: true });
    }
    
    // ============ BAN ============
    else if (commandName === 'ban') {
        if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.bannable) {
            return interaction.reply({ content: '❌ Cannot ban this user!', ephemeral: true });
        }
        
        await targetMember.ban({ reason });
        addDebugLog('BAN', { guildId: guild.id, userId: target.id, moderatorId: interaction.user.id, reason });
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('🔨 User Banned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ KICK ============
    else if (commandName === 'kick') {
        if (!member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.kickable) {
            return interaction.reply({ content: '❌ Cannot kick this user!', ephemeral: true });
        }
        
        await targetMember.kick(reason);
        addDebugLog('KICK', { guildId: guild.id, userId: target.id, moderatorId: interaction.user.id, reason });
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('👢 User Kicked').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ TIMEOUT ============
    else if (commandName === 'timeout') {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const minutes = options.getInteger('minutes');
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        
        if (!targetMember || !targetMember.moderatable) {
            return interaction.reply({ content: '❌ Cannot timeout this user!', ephemeral: true });
        }
        
        await targetMember.timeout(minutes * 60 * 1000);
        addDebugLog('TIMEOUT', { guildId: guild.id, userId: target.id, minutes });
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⏰ User Timed Out').addFields({ name: 'User', value: target.tag }, { name: 'Duration', value: `${minutes} minutes` });
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ WARN ============
    else if (commandName === 'warn') {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason');
        const key = `${guild.id}-${target.id}`;
        const userWarnings = warnings.get(key) || [];
        userWarnings.push({ reason, date: Date.now(), mod: interaction.user.tag });
        warnings.set(key, userWarnings);
        
        addDebugLog('WARN', { guildId: guild.id, userId: target.id, reason, warningCount: userWarnings.length });
        
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⚠️ User Warned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason }, { name: 'Total Warnings', value: `${userWarnings.length}` });
        await interaction.reply({ embeds: [embed] });
        
        if (userWarnings.length >= 3) {
            const targetMember = await guild.members.fetch(target.id);
            await targetMember.timeout(30 * 60 * 1000, '3 warnings');
            addDebugLog('AUTO_TIMEOUT', { userId: target.id, warnings: userWarnings.length });
            await interaction.followUp({ content: `⚠️ ${target.tag} was timed out for 30 minutes (3 warnings)` });
            warnings.delete(key);
        }
    }
    
    // ============ WARNINGS VIEW ============
    else if (commandName === 'warnings') {
        const target = options.getUser('user') || interaction.user;
        const userWarnings = warnings.get(`${guild.id}-${target.id}`) || [];
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`${target.tag}'s Warnings`)
            .setDescription(userWarnings.length > 0 ? userWarnings.map((w, i) => `${i+1}. ${w.reason} (by ${w.mod})`).join('\n') : 'No warnings');
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // ============ VERIFY ============
    else if (commandName === 'verify') {
        if (!config.verifyRole) {
            return interaction.reply({ content: '❌ Verification not setup! Ask an admin to run `/setup-verify`.', ephemeral: true });
        }
        
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const verifyCodes = client.verifyCodes || new Map();
        verifyCodes.set(interaction.user.id, { code, expires: Date.now() + 300000 });
        client.verifyCodes = verifyCodes;
        
        await interaction.reply({ content: `🔐 Type this code in chat: \`${code}\``, ephemeral: true });
        
        const filter = m => m.author.id === interaction.user.id && m.content === code;
        const collector = channel.createMessageCollector({ filter, time: 300000, max: 1 });
        
        collector.on('collect', async () => {
            const role = guild.roles.cache.get(config.verifyRole);
            if (role) await member.roles.add(role);
            await interaction.followUp({ content: '✅ Verified!', ephemeral: true });
            addDebugLog('VERIFY_SUCCESS', { userId: interaction.user.id, guildId: guild.id });
            verifyCodes.delete(interaction.user.id);
        });
    }
    
    // ============ TEMP VOICE OWNER COMMANDS ============
    else if (commandName === 'vc') {
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
            return interaction.reply({ content: '❌ You don\'t own a temporary voice channel! Join the create channel to make one.', ephemeral: true });
        }
        
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'rename') {
            const newName = options.getString('name');
            await userChannel.setName(newName.slice(0, 32));
            addDebugLog('VC_RENAME', { userId: member.id, channelId: userChannelId, newName });
            await interaction.reply({ content: `✅ Channel renamed to **${newName}**`, ephemeral: true });
        }
        else if (subcommand === 'limit') {
            const limit = options.getInteger('limit');
            await userChannel.setUserLimit(limit);
            await interaction.reply({ content: `✅ User limit set to **${limit}**`, ephemeral: true });
        }
        else if (subcommand === 'lock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: false });
            await interaction.reply({ content: '🔒 Channel locked. Only you can join.', ephemeral: true });
        }
        else if (subcommand === 'unlock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: null });
            await interaction.reply({ content: '🔓 Channel unlocked. Everyone can join.', ephemeral: true });
        }
        else if (subcommand === 'hide') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
            await interaction.reply({ content: '👻 Channel hidden from member list.', ephemeral: true });
        }
        else if (subcommand === 'reveal') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
            await interaction.reply({ content: '👁️ Channel visible to everyone.', ephemeral: true });
        }
        else if (subcommand === 'claim') {
            const owner = userChannel.members.get(tempChannels.get(userChannelId)?.ownerId);
            if (owner && owner.id !== member.id) {
                return interaction.reply({ content: '❌ The owner is still in the channel!', ephemeral: true });
            }
            
            const oldData = tempChannels.get(userChannelId);
            tempChannels.set(userChannelId, { ...oldData, ownerId: member.id, ownerTag: member.user.tag });
            await userChannel.permissionOverwrites.edit(member.id, { Connect: true, ManageChannels: true });
            addDebugLog('VC_CLAIM', { userId: member.id, channelId: userChannelId, previousOwner: oldData.ownerTag });
            await interaction.reply({ content: '✅ You are now the owner of this voice channel!', ephemeral: true });
        }
    }
});

// ============ BUTTON HANDLER ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'verify_button') {
        const config = guildConfig.get(interaction.guild.id) || defaultConfig;
        if (!config.verifyRole) {
            return interaction.reply({ content: '❌ Verification not setup!', ephemeral: true });
        }
        
        const role = interaction.guild.roles.cache.get(config.verifyRole);
        if (!role) {
            return interaction.reply({ content: '❌ Verification role not found!', ephemeral: true });
        }
        
        if (interaction.member.roles.cache.has(role.id)) {
            return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
        }
        
        await interaction.member.roles.add(role);
        addDebugLog('BUTTON_VERIFY', { userId: interaction.user.id, guildId: interaction.guild.id });
        await interaction.reply({ content: '✅ You have been verified!', ephemeral: true });
    }
});

// ============ HELPER FUNCTIONS ============
async function getUserDebugInfo(userId) {
    let serversFound = 0;
    let totalWarnings = 0;
    let tempChannelsCount = 0;
    
    for (const [guildId, guild] of client.guilds.cache) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) serversFound++;
        
        const userWarnings = warnings.get(`${guildId}-${userId}`) || [];
        totalWarnings += userWarnings.length;
    }
    
    for (const [channelId, data] of tempChannels) {
        if (data.ownerId === userId) tempChannelsCount++;
    }
    
    return { serversFound, totalWarnings, tempChannels: tempChannelsCount };
}

// ============ EXPRESS DASHBOARD API ============
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// Bot status
app.get('/api/status', (req, res) => {
    res.json({
        name: 'Fruxty Bot',
        status: 'online',
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        ping: client.ws.ping,
        uptime: client.uptime,
        commands: commands.length
    });
});

// Guilds list
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

// Get guild settings
app.get('/api/guilds/:guildId/settings', (req, res) => {
    const config = guildConfig.get(req.params.guildId) || defaultConfig;
    res.json(config);
});

// Save guild settings
app.post('/api/guilds/:guildId/settings', (req, res) => {
    const { guildId } = req.params;
    const newSettings = req.body;
    const current = guildConfig.get(guildId) || defaultConfig;
    guildConfig.set(guildId, { ...current, ...newSettings });
    addDebugLog('API_SETTINGS_SAVED', { guildId, settings: newSettings });
    res.json({ success: true });
});

// ============ OWNER-ONLY DEBUG API ============
function isOwner(req, res, next) {
    const authToken = req.headers.authorization || req.query.token;
    if (authToken === process.env.OWNER_ID) {
        return next();
    }
    return res.status(403).json({ error: 'Owner only', ownerId: process.env.OWNER_ID });
}

// Get full debug info for ANY user
app.get('/api/owner/debug/user/:userId', isOwner, async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = {
            userId: userId,
            discord: null,
            servers: [],
            totalWarnings: 0,
            totalTempChannels: 0
        };
        
        // Get Discord user info
        try {
            const user = await client.users.fetch(userId);
            result.discord = {
                id: user.id,
                tag: user.tag,
                username: user.username,
                avatar: user.displayAvatarURL({ dynamic: true, size: 256 }),
                createdAt: user.createdTimestamp,
                bot: user.bot
            };
        } catch (e) {
            result.discord = { error: 'User not found' };
        }
        
        // Scan all guilds
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                
                const guildInfo = {
                    guildId: guild.id,
                    guildName: guild.name,
                    isInGuild: !!member,
                    isOwner: guild.ownerId === userId,
                    nickname: member?.nickname,
                    isTimedOut: member?.isCommunicationDisabled(),
                    warnings: warnings.get(`${guildId}-${userId}`) || [],
                    hasTempChannel: false,
                    canKick: member?.kickable || false,
                    canBan: member?.bannable || false
                };
                
                result.totalWarnings += guildInfo.warnings.length;
                result.servers.push(guildInfo);
            } catch(e) {}
        }
        
        // Check temp channels
        for (const [channelId, data] of tempChannels) {
            if (data.ownerId === userId) {
                result.totalTempChannels++;
            }
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Perform action on a user across servers
app.post('/api/owner/action/:guildId/:action', isOwner, async (req, res) => {
    const { guildId, action } = req.params;
    const { userId, reason } = req.body;
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'User not in guild' });
    
    try {
        switch (action) {
            case 'kick':
                await member.kick(reason);
                res.json({ success: true, action: 'kick', message: `Kicked ${member.user.tag}` });
                break;
            case 'ban':
                await member.ban({ reason });
                res.json({ success: true, action: 'ban', message: `Banned ${member.user.tag}` });
                break;
            case 'timeout':
                await member.timeout(5 * 60 * 1000, reason);
                res.json({ success: true, action: 'timeout', message: `Timed out ${member.user.tag} for 5 minutes` });
                break;
            case 'warn':
                const key = `${guildId}-${userId}`;
                const userWarnings = warnings.get(key) || [];
                userWarnings.push({ reason, date: Date.now(), mod: 'Owner' });
                warnings.set(key, userWarnings);
                res.json({ success: true, action: 'warn', message: `Warned ${member.user.tag} (${userWarnings.length}/3)`, warningCount: userWarnings.length });
                break;
            default:
                res.status(400).json({ error: 'Invalid action' });
        }
        addDebugLog('OWNER_ACTION', { guildId, action, userId, reason });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check if logged-in user is the owner
app.get('/api/check-owner', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ isOwner: false });
    
    try {
        const userRes = await fetch('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const user = await userRes.json();
        res.json({ isOwner: user.id === process.env.OWNER_ID, userId: user.id });
    } catch (error) {
        res.json({ isOwner: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Fruxty API running on port ${PORT}`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard.html`);
    console.log(`🔧 Owner ID: ${process.env.OWNER_ID}`);
});

// ============ LOGIN ============
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    process.exit(1);
});
