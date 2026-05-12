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

console.log('🚀 Fruxty Bot Starting...');

// ============ DATA STORAGE ============
const guildConfig = new Map();
const tempChannels = new Map();
const warnings = new Map();
const messageHistory = new Map();
const levels = new Map();
const giveaways = new Map();
const verifyCodes = new Map();

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
    voiceSetup: false,
    leveling: { enabled: true, channel: null }
};

// ============ BAD WORDS ============
const badWords = ['fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'bastard', 'nigga', 'faggot', 'retard', 'porn', 'xxx', 'nsfw', 'nude', 'sex'];

// ============ ALL SLASH COMMANDS (FULL LIST) ============
const commands = [
    // Information Commands
    { name: 'ping', description: 'Check bot latency' },
    { name: 'serverinfo', description: 'Get server information' },
    { name: 'userinfo', description: 'Get user info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'avatar', description: 'Get user avatar', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'botinfo', description: 'Get bot statistics' },
    { name: 'help', description: 'Show all commands' },
    
    // Leveling Commands
    { name: 'rank', description: 'Check your level and XP' },
    { name: 'leaderboard', description: 'View top 10 users by level' },
    
    // Giveaway Commands
    { name: 'giveaway', description: 'Start a giveaway (Admin only)', options: [
        { name: 'duration', type: 4, description: 'Duration in minutes', required: true },
        { name: 'prize', type: 3, description: 'What to win', required: true },
        { name: 'winners', type: 4, description: 'Number of winners', required: true }
    ]},
    
    // Setup Commands
    { name: 'setup', description: 'Setup Fruxty bot (Admin only)' },
    { name: 'setup-voice', description: 'Setup temp voice channels (Admin only)' },
    { name: 'setup-verify', description: 'Setup verification system (Admin only)', options: [
        { name: 'channel', type: 7, description: 'Verification channel', required: true },
        { name: 'role', type: 8, description: 'Role to give', required: true }
    ]},
    { name: 'automod', description: 'Toggle auto-moderation (Admin only)', options: [
        { name: 'action', type: 3, description: 'On or off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }
    ]},
    
    // Moderation Commands
    { name: 'purge', description: 'Delete messages (Admin only)', options: [
        { name: 'amount', type: 4, description: 'Number of messages (1-100)', required: true, min_value: 1, max_value: 100 }
    ]},
    { name: 'lockdown', description: 'Lock a channel (Admin only)', options: [
        { name: 'channel', type: 7, description: 'Channel to lock', required: false }
    ]},
    { name: 'ban', description: 'Ban a user', options: [
        { name: 'user', type: 6, description: 'User to ban', required: true },
        { name: 'reason', type: 3, description: 'Reason for ban', required: false }
    ]},
    { name: 'kick', description: 'Kick a user', options: [
        { name: 'user', type: 6, description: 'User to kick', required: true },
        { name: 'reason', type: 3, description: 'Reason for kick', required: false }
    ]},
    { name: 'timeout', description: 'Timeout a user', options: [
        { name: 'user', type: 6, description: 'User to timeout', required: true },
        { name: 'minutes', type: 4, description: 'Duration in minutes (1-1440)', required: true, min_value: 1, max_value: 1440 }
    ]},
    { name: 'warn', description: 'Warn a user', options: [
        { name: 'user', type: 6, description: 'User to warn', required: true },
        { name: 'reason', type: 3, description: 'Reason for warning', required: true }
    ]},
    { name: 'warnings', description: 'View user warnings', options: [
        { name: 'user', type: 6, description: 'User to check', required: false }
    ]},
    
    // Voice Commands
    { name: 'vc', description: 'Manage your temporary voice channel', options: [
        { name: 'rename', type: 1, description: 'Rename your channel', options: [{ name: 'name', type: 3, description: 'New name', required: true }] },
        { name: 'limit', type: 1, description: 'Set user limit', options: [{ name: 'limit', type: 4, description: '1-99', required: true, min_value: 1, max_value: 99 }] },
        { name: 'lock', type: 1, description: 'Lock your channel' },
        { name: 'unlock', type: 1, description: 'Unlock your channel' },
        { name: 'hide', type: 1, description: 'Hide channel from member list' },
        { name: 'reveal', type: 1, description: 'Show channel to member list' },
        { name: 'claim', type: 1, description: 'Claim ownership (if owner left)' }
    ]},
    
    // Verification Command
    { name: 'verify', description: 'Verify yourself' }
];

// ============ READY EVENT ============
client.once('ready', async () => {
    console.log(`✅ Fruxty is online as ${client.user.tag}`);
    console.log(`📊 Bot is in ${client.guilds.cache.size} servers`);
    
    // Register ALL commands with Discord
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Registered ${commands.length} commands successfully!`);
        console.log(`📝 Commands: ${commands.map(c => c.name).join(', ')}`);
    } catch(e) { 
        console.error('❌ Failed to register commands:', e);
    }
    
    // Set bot status
    client.user.setPresence({
        activities: [{ name: `/help | ${client.guilds.cache.size} servers`, type: ActivityType.Watching }],
        status: 'online'
    });
});

// ============ COMMAND HANDLER ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, guild, member, channel } = interaction;
    
    console.log(`📝 Command: ${commandName} | User: ${interaction.user.tag}`);
    
    // ============ HELP COMMAND ============
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('📚 Fruxty Bot - All Commands')
            .setDescription('Here are all my commands!')
            .addFields(
                { name: '📊 Information', value: '`/ping`, `/serverinfo`, `/userinfo`, `/avatar`, `/botinfo`', inline: false },
                { name: '📈 Leveling', value: '`/rank`, `/leaderboard`', inline: false },
                { name: '🎁 Giveaways', value: '`/giveaway` (Admin only)', inline: false },
                { name: '🛡️ Moderation', value: '`/ban`, `/kick`, `/timeout`, `/warn`, `/warnings`, `/purge`, `/lockdown`', inline: false },
                { name: '⚙️ Setup', value: '`/setup`, `/setup-voice`, `/setup-verify`, `/automod`', inline: false },
                { name: '🎤 Voice', value: '`/vc rename`, `/vc limit`, `/vc lock`, `/vc unlock`, `/vc hide`, `/vc reveal`, `/vc claim`', inline: false },
                { name: '🔐 Verification', value: '`/verify`', inline: false }
            )
            .setFooter({ text: 'Fruxty Bot - Protecting your server!' });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
    
    // ============ PING COMMAND ============
    if (commandName === 'ping') {
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
        return;
    }
    
    // ============ SERVER INFO ============
    if (commandName === 'serverinfo') {
        await interaction.deferReply();
        const fetchOwner = await guild.fetchOwner();
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '👑 Owner', value: fetchOwner.user.tag, inline: true },
                { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
                { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🔧 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ USER INFO ============
    if (commandName === 'userinfo') {
        await interaction.deferReply();
        const target = options.getUser('user') || interaction.user;
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(target.tag)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🆔 ID', value: target.id, inline: true },
                { name: '📅 Joined Server', value: targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                { name: '📅 Joined Discord', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🤖 Bot', value: target.bot ? 'Yes' : 'No', inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ AVATAR ============
    if (commandName === 'avatar') {
        const target = options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`${target.tag}'s Avatar`)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ BOT INFO ============
    if (commandName === 'botinfo') {
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
        return;
    }
    
    // ============ RANK COMMAND ============
    if (commandName === 'rank') {
        const key = `${guild.id}-${interaction.user.id}`;
        const userData = levels.get(key) || { xp: 0, level: 0, totalXP: 0 };
        
        // Get rank position
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
            .setTitle(`📊 ${interaction.user.username}'s Rank`)
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
    
    // ============ LEADERBOARD ============
    if (commandName === 'leaderboard') {
        await interaction.deferReply();
        
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
            leaderboardText += `${i+1}. **${username}** - Level ${top10[i].level} (${top10[i].totalXP} XP)\n`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`🏆 Server Leaderboard`)
            .setDescription(leaderboardText || 'No users ranked yet!')
            .setFooter({ text: 'Chat more to climb the ranks!' });
        
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ GIVEAWAY ============
    if (commandName === 'giveaway') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const duration = options.getInteger('duration');
        const prize = options.getString('prize');
        const winners = options.getInteger('winners');
        const endsAt = Date.now() + (duration * 60 * 1000);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`🎁 GIVEAWAY 🎁`)
            .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>`)
            .setFooter({ text: `React with 🎉 to enter!` });
        
        const giveawayMsg = await channel.send({ embeds: [embed] });
        await giveawayMsg.react('🎉');
        
        giveaways.set(giveawayMsg.id, {
            channelId: channel.id,
            prize: prize,
            winners: winners,
            endsAt: endsAt,
            ended: false
        });
        
        await interaction.reply({ content: `✅ Giveaway started! Ends in ${duration} minutes.`, ephemeral: true });
        return;
    }
    
    // ============ SETUP ============
    if (commandName === 'setup') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        guildConfig.set(guild.id, defaultConfig);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Fruxty Bot Setup Complete')
            .setDescription('Fruxty is now protecting your server!')
            .addFields(
                { name: '🛡️ AutoMod', value: 'Enabled', inline: true },
                { name: '📈 Leveling', value: 'Enabled', inline: true },
                { name: '🚨 Anti-Nuke', value: 'Enabled', inline: true }
            );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ SETUP VOICE ============
    if (commandName === 'setup-voice') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        await interaction.reply({ content: '🔧 Setting up temp voice channels...', ephemeral: true });
        
        const category = await guild.channels.create({ name: '🎤 Temp Voice', type: ChannelType.GuildCategory });
        const creatorChannel = await guild.channels.create({ name: '➕-create-vc', type: ChannelType.GuildVoice, parent: category.id });
        
        const config = guildConfig.get(guild.id) || defaultConfig;
        config.voiceSetup = true;
        config.voiceCategory = category.id;
        config.voiceCreator = creatorChannel.id;
        guildConfig.set(guild.id, config);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Temp Voice Setup Complete')
            .setDescription(`Join **${creatorChannel.name}** to get your own private voice channel!`)
            .addFields(
                { name: 'Commands', value: '`/vc rename`, `/vc lock`, `/vc limit`, `/vc hide`, `/vc claim`', inline: false }
            );
        
        await interaction.editReply({ content: null, embeds: [embed] });
        return;
    }
    
    // ============ SETUP VERIFY ============
    if (commandName === 'setup-verify') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const verifyChannel = options.getChannel('channel');
        const verifyRole = options.getRole('role');
        
        const config = guildConfig.get(guild.id) || defaultConfig;
        config.verifyChannel = verifyChannel.id;
        config.verifyRole = verifyRole.id;
        guildConfig.set(guild.id, config);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🔐 Verification Setup')
            .setDescription(`Click the button below to get ${verifyRole.name}`);
        
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
        return;
    }
    
// ============ AUTO-MODERATION ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // IGNORE STAFF - Admins, Mods, and anyone with moderation permissions
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    if (message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
    if (message.member.permissions.has(PermissionFlagsBits.KickMembers)) return;
    if (message.member.permissions.has(PermissionFlagsBits.BanMembers)) return;
    
    const config = guildConfig.get(message.guild.id) || defaultConfig;
    if (!config.automod?.enabled) return;
    
    // Bad words filter
    const content = message.content.toLowerCase();
    const foundBadWord = badWords.find(word => content.includes(word));
    
    if (foundBadWord) {
        await message.delete();
        
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
            warnings.delete(`${message.guild.id}-${message.author.id}`);
        }
    }
    
    // Anti-spam - Also ignore staff
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
    
    // ============ BAN ============
    if (commandName === 'ban') {
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
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('🔨 User Banned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ KICK ============
    if (commandName === 'kick') {
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
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('👢 User Kicked').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ TIMEOUT ============
    if (commandName === 'timeout') {
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
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⏰ User Timed Out').addFields({ name: 'User', value: target.tag }, { name: 'Duration', value: `${minutes} minutes` });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ WARN ============
    if (commandName === 'warn') {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ No permission!', ephemeral: true });
        }
        
        const target = options.getUser('user');
        const reason = options.getString('reason');
        const key = `${guild.id}-${target.id}`;
        const userWarnings = warnings.get(key) || [];
        userWarnings.push({ reason, date: Date.now(), mod: interaction.user.tag });
        warnings.set(key, userWarnings);
        
        const embed = new EmbedBuilder().setColor(0xFFA500).setTitle('⚠️ User Warned').addFields({ name: 'User', value: target.tag }, { name: 'Reason', value: reason }, { name: 'Total Warnings', value: `${userWarnings.length}` });
        await interaction.reply({ embeds: [embed] });
        
        if (userWarnings.length >= 3) {
            const targetMember = await guild.members.fetch(target.id);
            await targetMember.timeout(30 * 60 * 1000, '3 warnings');
            await interaction.followUp({ content: `⚠️ ${target.tag} was timed out for 30 minutes (3 warnings)` });
            warnings.delete(key);
        }
        return;
    }
    
    // ============ WARNINGS ============
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
    
    // ============ PURGE ============
    if (commandName === 'purge') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const amount = options.getInteger('amount');
        const messages = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(messages, true);
        await interaction.reply({ content: `✅ Deleted ${deleted.size} messages!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
        return;
    }
    
    // ============ LOCKDOWN ============
    if (commandName === 'lockdown') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only!', ephemeral: true });
        }
        
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        await interaction.reply({ content: `🔒 ${targetChannel} locked down!`, ephemeral: true });
        return;
    }
    
    // ============ VERIFY ============
    if (commandName === 'verify') {
        const config = guildConfig.get(guild.id) || defaultConfig;
        if (!config.verifyRole) {
            return interaction.reply({ content: '❌ Verification not setup! Ask an admin to run `/setup-verify`.', ephemeral: true });
        }
        
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        verifyCodes.set(interaction.user.id, { code, expires: Date.now() + 300000 });
        
        await interaction.reply({ content: `🔐 Type this code in chat: \`${code}\``, ephemeral: true });
        
        const filter = m => m.author.id === interaction.user.id && m.content === code;
        const collector = channel.createMessageCollector({ filter, time: 300000, max: 1 });
        
        collector.on('collect', async () => {
            const role = guild.roles.cache.get(config.verifyRole);
            if (role) await member.roles.add(role);
            await interaction.followUp({ content: '✅ Verified!', ephemeral: true });
            verifyCodes.delete(interaction.user.id);
        });
        
        collector.on('end', (collected) => {
            if (collected.size === 0) {
                interaction.followUp({ content: '❌ Verification timed out.', ephemeral: true }).catch(() => {});
                verifyCodes.delete(interaction.user.id);
            }
        });
        return;
    }
    
    // ============ VOICE CHANNEL COMMANDS ============
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
            return interaction.reply({ content: '❌ You don\'t own a temporary voice channel! Join the create channel to make one.', ephemeral: true });
        }
        
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'rename') {
            const newName = options.getString('name');
            await userChannel.setName(newName.slice(0, 32));
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
            await interaction.reply({ content: '✅ You are now the owner of this voice channel!', ephemeral: true });
        }
        return;
    }
    
    // Default response
    await interaction.reply({ content: `✅ Command ${commandName} executed!`, ephemeral: true });
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
        await interaction.reply({ content: '✅ You have been verified!', ephemeral: true });
    }
});

// ============ AUTO-MODERATION ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const config = guildConfig.get(message.guild.id) || defaultConfig;
    if (!config.automod?.enabled) return;
    
    // Bad words filter
    const content = message.content.toLowerCase();
    const foundBadWord = badWords.find(word => content.includes(word));
    
    if (foundBadWord) {
        await message.delete();
        
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
        messageHistory.delete(`${message.guild.id}-${message.author.id}`);
    }
    
    setTimeout(() => {
        const current = messageHistory.get(`${message.guild.id}-${message.author.id}`) || [];
        messageHistory.set(`${message.guild.id}-${message.author.id}`, current.filter(t => now - t < 5000));
    }, 5000);
});

// ============ LEVELING SYSTEM (XP GAIN) ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const config = guildConfig.get(message.guild.id) || defaultConfig;
    if (!config.leveling?.enabled) return;
    
    const key = `${message.guild.id}-${message.author.id}`;
    let userData = levels.get(key) || { xp: 0, level: 0, totalXP: 0 };
    
    const xpGain = Math.floor(Math.random() * 10) + 5;
    userData.xp += xpGain;
    userData.totalXP += xpGain;
    
    if (userData.xp >= 100) {
        userData.level++;
        userData.xp = 0;
        message.channel.send(`🎉 ${message.author} reached Level ${userData.level}!`);
        
        // Give role rewards at certain levels
        if (userData.level === 5) {
            let role = message.guild.roles.cache.find(r => r.name === 'Level 5');
            if (!role) {
                role = await message.guild.roles.create({ name: 'Level 5', color: 0x00FF00 });
            }
            await message.member.roles.add(role);
            await message.channel.send(`🎁 ${message.author} got the **Level 5** role!`);
        } else if (userData.level === 10) {
            let role = message.guild.roles.cache.find(r => r.name === 'Level 10');
            if (!role) {
                role = await message.guild.roles.create({ name: 'Level 10', color: 0x00AAFF });
            }
            await message.member.roles.add(role);
            await message.channel.send(`🎁 ${message.author} got the **Level 10** role!`);
        }
    }
    
    levels.set(key, userData);
});

// ============ VOICE STATE UPDATE (Temp Channels) ============
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild) return;
    
    const config = guildConfig.get(newState.guild.id) || defaultConfig;
    if (!config.voiceSetup) return;
    
    // Create temp channel when joining creator channel
    if (newState.channelId === config.voiceCreator && !oldState.channelId) {
        const member = newState.member;
        
        // Check if user already has a temp channel
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
        
        try {
            await member.send(`✅ Created your temp voice channel: **${channel.name}**\nUse \`/vc rename\`, \`/vc lock\`, \`/vc limit\`, \`/vc hide\`, \`/vc claim\` to manage it.`);
        } catch(e) {}
    }
    
    // Delete empty temp channels
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

// ============ GIVEAWAY CHECKER ============
setInterval(async () => {
    const now = Date.now();
    for (const [messageId, giveaway] of giveaways) {
        if (giveaway.endsAt <= now && !giveaway.ended) {
            try {
                const channel = await client.channels.fetch(giveaway.channelId);
                const message = await channel.messages.fetch(messageId);
                
                // Get participants
                const participants = [];
                const reaction = message.reactions.cache.get('🎉');
                if (reaction) {
                    const users = await reaction.users.fetch();
                    users.forEach(user => {
                        if (!user.bot) participants.push(user);
                    });
                }
                
                const winners = [];
                if (participants.length > 0) {
                    for (let i = 0; i < Math.min(giveaway.winners, participants.length); i++) {
                        const randomIndex = Math.floor(Math.random() * participants.length);
                        winners.push(participants[randomIndex]);
                        participants.splice(randomIndex, 1);
                    }
                }
                
                const winnerText = winners.length > 0 ? winners.map(w => `<@${w.id}>`).join(', ') : 'No valid participants';
                
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle(`🎁 GIVEAWAY ENDED 🎁`)
                    .setDescription(`**Prize:** ${giveaway.prize}\n**Winners:** ${winnerText}`)
                    .setTimestamp();
                
                await message.edit({ embeds: [embed] });
                await channel.send(`🎉 Congratulations ${winnerText}! You won **${giveaway.prize}**!`);
                
                giveaway.ended = true;
                giveaways.set(messageId, giveaway);
            } catch (error) {
                console.error('Giveaway ending error:', error);
            }
        }
    }
}, 10000);

// ============ EXPRESS SERVER (for Render/UptimeRobot) ============
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Fruxty Bot is running! 🚀');
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
        commands: commands.length,
        uptime: client.uptime
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 API server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// ============ LOGIN ============
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
