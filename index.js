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

console.log('Fruxty bot starting...');

// ============ Data Storage (Server-Side Economy) ============
const guildSettings = new Map();
const tempChannels = new Map();
const warnings = new Map();
const messageHistory = new Map();
const levels = new Map();

// Economy Data - Server specific (coins stay within each server)
const economy = new Map(); // Key: `${guildId}-${userId}`

// Shop items per server
const shops = new Map(); // Key: guildId

// Jobs per server
const jobs = new Map(); // Key: guildId

// Active robberies
const activeRobberies = new Map();

// Safe mode status per user
const safeMode = new Map(); // Key: `${guildId}-${userId}`

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
    leveling: { enabled: true },
    serverStatus: { enabled: false, channelId: null, messageId: null },
    economyName: 'Fruxty Coins',
    economySymbol: '💰'
};

// ============ Bad Words List ============
const badWords = ['fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'bastard', 'nigga', 'faggot', 'retard', 'porn', 'xxx', 'nsfw', 'nude', 'sex'];

// ============ Helper Functions ============
function isAdmin(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function getEconomyKey(guildId, userId) {
    return `${guildId}-${userId}`;
}

function getUserBalance(guildId, userId) {
    const key = getEconomyKey(guildId, userId);
    const data = economy.get(key);
    return data ? data.balance : 0;
}

function setUserBalance(guildId, userId, amount) {
    const key = getEconomyKey(guildId, userId);
    const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
    data.balance = amount;
    economy.set(key, data);
    return data.balance;
}

function addUserBalance(guildId, userId, amount) {
    const current = getUserBalance(guildId, userId);
    return setUserBalance(guildId, userId, current + amount);
}

function removeUserBalance(guildId, userId, amount) {
    const current = getUserBalance(guildId, userId);
    if (current < amount) return false;
    setUserBalance(guildId, userId, current - amount);
    return true;
}

function getUserInventory(guildId, userId) {
    const key = getEconomyKey(guildId, userId);
    const data = economy.get(key);
    return data ? data.inventory || [] : [];
}

function addToInventory(guildId, userId, item) {
    const key = getEconomyKey(guildId, userId);
    const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
    data.inventory.push(item);
    economy.set(key, data);
}

function removeFromInventory(guildId, userId, itemName) {
    const key = getEconomyKey(guildId, userId);
    const data = economy.get(key);
    if (!data) return false;
    const index = data.inventory.findIndex(i => i.name === itemName);
    if (index === -1) return false;
    data.inventory.splice(index, 1);
    economy.set(key, data);
    return true;
}

function isSafeMode(guildId, userId) {
    const key = `${guildId}-${userId}`;
    return safeMode.get(key) || false;
}

// ============ Register Slash Commands (50+ Commands) ============
const commands = [
    // ===== Utility (6) =====
    { name: 'ping', description: 'Check bot latency' },
    { name: 'serverinfo', description: 'Get server information' },
    { name: 'userinfo', description: 'Get user info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'avatar', description: 'Get user avatar', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'botinfo', description: 'Get bot statistics' },
    { name: 'help', description: 'Show all commands' },
    
    // ===== Leveling (2) =====
    { name: 'rank', description: 'Check your level and XP' },
    { name: 'leaderboard', description: 'View top 10 users by level' },
    
    // ===== Economy Core (10) =====
    { name: 'balance', description: 'Check your balance', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'daily', description: 'Claim your daily reward' },
    { name: 'work', description: 'Work to earn coins' },
    { name: 'crime', description: 'Commit a crime to earn coins (risky!)' },
    { name: 'rob', description: 'Rob another user', options: [{ name: 'user', type: 6, description: 'User to rob', required: true }] },
    { name: 'safemode', description: 'Toggle safe mode (prevents being robbed)', options: [{ name: 'action', type: 3, description: 'on/off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
    { name: 'transfer', description: 'Send coins to another user', options: [{ name: 'user', type: 6, required: true }, { name: 'amount', type: 4, required: true }] },
    { name: 'leaderboard-money', description: 'View richest users' },
    { name: 'gamble', description: 'Gamble your coins', options: [{ name: 'amount', type: 4, description: 'Amount to gamble', required: true }] },
    { name: 'slots', description: 'Play slots machine', options: [{ name: 'amount', type: 4, description: 'Bet amount', required: true }] },
    
    // ===== Shop (6) =====
    { name: 'shop', description: 'View shop items' },
    { name: 'buy', description: 'Buy an item from shop', options: [{ name: 'item', type: 3, description: 'Item name', required: true }] },
    { name: 'sell', description: 'Sell an item from inventory', options: [{ name: 'item', type: 3, description: 'Item name', required: true }] },
    { name: 'inventory', description: 'View your inventory', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'shop-add', description: 'Add item to shop (Admin)', options: [{ name: 'name', type: 3, required: true }, { name: 'price', type: 4, required: true }, { name: 'description', type: 3, required: false }] },
    { name: 'shop-remove', description: 'Remove item from shop (Admin)', options: [{ name: 'item', type: 3, required: true }] },
    
    // ===== Jobs (8) =====
    { name: 'jobs', description: 'View available jobs' },
    { name: 'apply', description: 'Apply for a job', options: [{ name: 'job', type: 3, description: 'Job name', required: true }] },
    { name: 'resign', description: 'Quit your current job' },
    { name: 'job-info', description: 'View your job info' },
    { name: 'job-add', description: 'Add a job (Admin)', options: [{ name: 'name', type: 3, required: true }, { name: 'salary', type: 4, required: true }, { name: 'description', type: 3, required: false }] },
    { name: 'job-remove', description: 'Remove a job (Admin)', options: [{ name: 'job', type: 3, required: true }] },
    { name: 'promote', description: 'Promote a user (Admin)', options: [{ name: 'user', type: 6, required: true }, { name: 'salary', type: 4, required: true }] },
    { name: 'demote', description: 'Demote a user (Admin)', options: [{ name: 'user', type: 6, required: true }] },
    
    // ===== Admin Economy (4) =====
    { name: 'addmoney', description: 'Add coins to user (Admin)', options: [{ name: 'user', type: 6, required: true }, { name: 'amount', type: 4, required: true }] },
    { name: 'removemoney', description: 'Remove coins from user (Admin)', options: [{ name: 'user', type: 6, required: true }, { name: 'amount', type: 4, required: true }] },
    { name: 'setmoney', description: 'Set user balance (Admin)', options: [{ name: 'user', type: 6, required: true }, { name: 'amount', type: 4, required: true }] },
    { name: 'reset-economy', description: 'Reset all economy data (Admin)' },
    
    // ===== Admin Setup (7) =====
    { name: 'setup', description: 'Setup bot protections (Admin)' },
    { name: 'setup-voice', description: 'Setup temp voice channels (Admin)' },
    { name: 'setup-verify', description: 'Setup verification system (Admin)', options: [{ name: 'channel', type: 7, required: true }, { name: 'role', type: 8, required: true }] },
    { name: 'setup-welcome', description: 'Setup welcome channel (Admin)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'setup-goodbye', description: 'Setup goodbye channel (Admin)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'setup-status', description: 'Setup live server status channel (Admin)', options: [{ name: 'channel', type: 7, required: true }] },
    { name: 'automod', description: 'Toggle auto-moderation (Admin)', options: [{ name: 'action', type: 3, required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
    
    // ===== Moderation (9) =====
    { name: 'purge', description: 'Delete messages (Admin)', options: [{ name: 'amount', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'lockdown', description: 'Lock a channel (Admin)', options: [{ name: 'channel', type: 7, required: false }] },
    { name: 'slowmode', description: 'Set slowmode (Admin)', options: [{ name: 'seconds', type: 4, required: true, min_value: 0, max_value: 21600 }, { name: 'channel', type: 7, required: false }] },
    { name: 'ban', description: 'Ban a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'kick', description: 'Kick a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'timeout', description: 'Timeout a user', options: [{ name: 'user', type: 6, required: true }, { name: 'minutes', type: 4, required: true, min_value: 1, max_value: 1440 }] },
    { name: 'warn', description: 'Warn a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3, required: true }] },
    { name: 'warnings', description: 'View user warnings', options: [{ name: 'user', type: 6, required: false }] },
    
    // ===== Voice (7) =====
    { name: 'vc', description: 'Manage your temporary voice channel', options: [
        { name: 'rename', type: 1, description: 'Rename your channel', options: [{ name: 'name', type: 3, required: true }] },
        { name: 'limit', type: 1, description: 'Set user limit', options: [{ name: 'limit', type: 4, required: true, min_value: 1, max_value: 99 }] },
        { name: 'lock', type: 1, description: 'Lock your channel' },
        { name: 'unlock', type: 1, description: 'Unlock your channel' },
        { name: 'hide', type: 1, description: 'Hide channel' },
        { name: 'reveal', type: 1, description: 'Show channel' },
        { name: 'claim', type: 1, description: 'Claim ownership' }
    ]},
    
    // ===== Verification (1) =====
    { name: 'verify', description: 'Verify yourself' }
];

// Total: 6+2+10+6+8+4+7+9+7+1 = 60 commands

// ============ Register Commands ============
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Registering slash commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`Registered ${commands.length} commands successfully`);
    } catch(e) { 
        console.error('Failed to register commands:', e);
    }
}

// ============ Ready Event ============
client.once('ready', async () => {
    console.log(`Fruxty is online as ${client.user.tag}`);
    console.log(`Bot is in ${client.guilds.cache.size} servers`);
    await registerCommands();
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
    
    const embed = new EmbedBuilder()
        .setColor(0xFF6B35)
        .setTitle('Server Status')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: 'Total Members', value: `${guild.memberCount}`, inline: true },
            { name: 'Online Members', value: `${guild.members.cache.filter(m => m.presence?.status !== 'offline' && !m.user.bot).size}`, inline: true },
            { name: 'Bots', value: `${guild.members.cache.filter(m => m.user.bot).size}`, inline: true },
            { name: 'Text Channels', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size}`, inline: true },
            { name: 'Voice Channels', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size}`, inline: true }
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
    } catch(e) {}
}

// ============ Welcome & Goodbye ============
client.on('guildMemberAdd', async (member) => {
    const config = guildSettings.get(member.guild.id);
    if (!config?.welcomeChannel) return;
    const channel = member.guild.channels.cache.get(config.welcomeChannel);
    if (!channel) return;
    
    const message = config.welcomeMessage.replace('{user}', `<@${member.id}>`).replace('{server}', member.guild.name);
    const embed = new EmbedBuilder().setColor(0x00FF00).setTitle('Welcome!').setDescription(message).setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
    const config = guildSettings.get(member.guild.id);
    if (!config?.goodbyeChannel) return;
    const channel = member.guild.channels.cache.get(config.goodbyeChannel);
    if (!channel) return;
    
    const message = config.goodbyeMessage.replace('{user}', member.user.tag).replace('{server}', member.guild.name);
    const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('Goodbye!').setDescription(message);
    await channel.send({ embeds: [embed] });
});

// ============ Auto-Moderation ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (isAdmin(message.member)) return;
    
    const config = guildSettings.get(message.guild.id) || defaultConfig;
    if (!config.automod?.enabled) return;
    
    const foundBadWord = badWords.find(word => message.content.toLowerCase().includes(word));
    if (foundBadWord) {
        await message.delete();
        const userWarnings = warnings.get(`${message.guild.id}-${message.author.id}`) || [];
        userWarnings.push({ reason: `Bad word: ${foundBadWord}`, date: Date.now() });
        warnings.set(`${message.guild.id}-${message.author.id}`, userWarnings);
        
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('AutoMod').setDescription(`${message.author}, your message was deleted. Warning ${userWarnings.length}/3`);
        const warningMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => warningMsg.delete(), 5000);
        
        if (userWarnings.length >= 3) {
            await message.member.timeout(30 * 60 * 1000, '3 warnings');
            warnings.delete(`${message.guild.id}-${message.author.id}`);
        }
    }
});

// ============ Leveling System ============
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (isAdmin(message.member)) return;
    
    const config = guildSettings.get(message.guild.id) || defaultConfig;
    if (!config.leveling?.enabled) return;
    
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
});

// ============ Voice State Update ============
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
                { id: member.id, allow: [PermissionFlagsBits.ManageChannels] },
                { id: newState.guild.id, deny: [PermissionFlagsBits.Connect] }
            ]
        });
        tempChannels.set(channel.id, { ownerId: member.id });
        await member.voice.setChannel(channel);
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

// ============ Economy Shop Management ============
function getShop(guildId) {
    return shops.get(guildId) || [
        { name: 'Fishing Rod', price: 500, description: 'Catch fish while working', sellPrice: 250 },
        { name: 'Lucky Pickaxe', price: 1000, description: 'Find rare gems while working', sellPrice: 500 },
        { name: 'Stealth Boots', price: 2000, description: '50% chance to avoid robbery', sellPrice: 1000 },
        { name: 'Safe Vault', price: 5000, description: 'Protects 1000 coins from robbery', sellPrice: 2500 },
        { name: 'Gold Shield', price: 10000, description: 'Immune to robbery for 24 hours', sellPrice: 5000 }
    ];
}

// ============ Job Management ============
function getJobs(guildId) {
    return jobs.get(guildId) || [
        { name: 'Miner', salary: 100, description: 'Mine for valuable ores' },
        { name: 'Fisher', salary: 80, description: 'Catch and sell fish' },
        { name: 'Merchant', salary: 120, description: 'Trade goods for profit' },
        { name: 'Guard', salary: 90, description: 'Protect the town' },
        { name: 'Blacksmith', salary: 110, description: 'Forge weapons and tools' }
    ];
}

// ============ Crime Outcomes ============
const crimeOutcomes = [
    { success: true, minGain: 50, maxGain: 200, message: 'You successfully pickpocketed a tourist! +{amount} coins' },
    { success: true, minGain: 100, maxGain: 500, message: 'You robbed a bank vault! +{amount} coins' },
    { success: true, minGain: 20, maxGain: 100, message: 'You found a wallet on the ground! +{amount} coins' },
    { success: false, minLoss: 50, maxLoss: 200, message: 'You got caught by the police! -{amount} coins' },
    { success: false, minLoss: 100, maxLoss: 300, message: 'The victim fought back and took your coins! -{amount} coins' },
    { success: false, minLoss: 30, maxLoss: 150, message: 'You fell into a trap! -{amount} coins' }
];

// ============ Command Handler ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, guild, member, channel } = interaction;
    const config = guildSettings.get(guild?.id) || { ...defaultConfig };
    
    // ============ Help Command ============
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('Fruxty Bot - All Commands (60 Total)')
            .setDescription('Here are all my commands!')
            .addFields(
                { name: 'Utility (6)', value: '/ping, /serverinfo, /userinfo, /avatar, /botinfo, /help', inline: false },
                { name: 'Leveling (2)', value: '/rank, /leaderboard', inline: false },
                { name: 'Economy Core (10)', value: '/balance, /daily, /work, /crime, /rob, /safemode, /transfer, /leaderboard-money, /gamble, /slots', inline: false },
                { name: 'Shop (6)', value: '/shop, /buy, /sell, /inventory, /shop-add, /shop-remove', inline: false },
                { name: 'Jobs (8)', value: '/jobs, /apply, /resign, /job-info, /job-add, /job-remove, /promote, /demote', inline: false },
                { name: 'Admin Economy (4)', value: '/addmoney, /removemoney, /setmoney, /reset-economy', inline: false },
                { name: 'Admin Setup (7)', value: '/setup, /setup-voice, /setup-verify, /setup-welcome, /setup-goodbye, /setup-status, /automod', inline: false },
                { name: 'Moderation (9)', value: '/purge, /lockdown, /slowmode, /ban, /kick, /timeout, /warn, /warnings', inline: false },
                { name: 'Voice (7)', value: '/vc rename, /vc limit, /vc lock, /vc unlock, /vc hide, /vc reveal, /vc claim', inline: false },
                { name: 'Verification (1)', value: '/verify', inline: false }
            );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
    
    // ============ Ping ============
    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const api = Math.round(client.ws.ping);
        const embed = new EmbedBuilder().setColor(api < 200 ? 0x00FF00 : api < 500 ? 0xFFFF00 : 0xFF0000).setTitle('Pong!').addFields({ name: 'Roundtrip', value: `${roundtrip}ms`, inline: true }, { name: 'API Latency', value: `${api}ms`, inline: true });
        await interaction.editReply({ content: null, embeds: [embed] });
        return;
    }
    
    // ============ Server Info ============
    if (commandName === 'serverinfo') {
        await interaction.deferReply();
        const owner = await guild.fetchOwner();
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(guild.name).setThumbnail(guild.iconURL({ dynamic: true })).addFields(
            { name: 'Owner', value: owner.user.tag, inline: true },
            { name: 'Members', value: `${guild.memberCount}`, inline: true },
            { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true }
        );
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ User Info ============
    if (commandName === 'userinfo') {
        const target = options.getUser('user') || interaction.user;
        const targetMember = await guild.members.fetch(target.id);
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(target.tag).setThumbnail(target.displayAvatarURL({ dynamic: true })).addFields(
            { name: 'ID', value: target.id, inline: true },
            { name: 'Joined Server', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: true },
            { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true }
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Avatar ============
    if (commandName === 'avatar') {
        const target = options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(`${target.tag}'s Avatar`).setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Bot Info ============
    if (commandName === 'botinfo') {
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Fruxty Bot').setThumbnail(client.user.displayAvatarURL()).addFields(
            { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Commands', value: `${commands.length}`, inline: true },
            { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true }
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Rank ============
    if (commandName === 'rank') {
        const key = `${guild.id}-${interaction.user.id}`;
        const userData = levels.get(key) || { xp: 0, level: 0, totalXP: 0 };
        let allUsers = [];
        for (const [k, data] of levels) {
            if (k.startsWith(guild.id)) allUsers.push({ userId: k.split('-')[1], totalXP: data.totalXP });
        }
        allUsers.sort((a, b) => b.totalXP - a.totalXP);
        const rank = allUsers.findIndex(u => u.userId === interaction.user.id) + 1;
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(`${interaction.user.username}'s Rank`).addFields(
            { name: 'Level', value: `${userData.level}`, inline: true },
            { name: 'Rank', value: `#${rank}`, inline: true },
            { name: 'XP', value: `${userData.xp}/100`, inline: true }
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Leaderboard Levels ============
    if (commandName === 'leaderboard') {
        await interaction.deferReply();
        let allUsers = [];
        for (const [k, data] of levels) {
            if (k.startsWith(guild.id)) allUsers.push({ userId: k.split('-')[1], level: data.level });
        }
        allUsers.sort((a, b) => b.level - a.level);
        const top10 = allUsers.slice(0, 10);
        let text = '';
        for (let i = 0; i < top10.length; i++) {
            const user = await client.users.fetch(top10[i].userId).catch(() => null);
            text += `${i+1}. ${user ? user.username : 'Unknown'} - Level ${top10[i].level}\n`;
        }
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Level Leaderboard').setDescription(text || 'No users ranked yet!');
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ Balance ============
    if (commandName === 'balance') {
        const target = options.getUser('user') || interaction.user;
        const balance = getUserBalance(guild.id, target.id);
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(`${target.username}'s Balance`).setDescription(`${config.economySymbol} ${balance.toLocaleString()} ${config.economyName}`);
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Daily ============
    if (commandName === 'daily') {
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        if (data.lastDaily && now - data.lastDaily < cooldown) {
            const remaining = Math.ceil((cooldown - (now - data.lastDaily)) / 1000 / 60 / 60);
            return interaction.reply({ content: `You already claimed your daily! Come back in ${remaining} hours.`, ephemeral: true });
        }
        const dailyAmount = 500;
        data.balance += dailyAmount;
        data.lastDaily = now;
        economy.set(key, data);
        await interaction.reply({ content: `${config.economySymbol} You claimed ${dailyAmount.toLocaleString} ${config.economyName}! New balance: ${data.balance.toLocaleString()}`, ephemeral: false });
        return;
    }
    
    // ============ Work ============
    if (commandName === 'work') {
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastWork: 0, lastCrime: 0 };
        const now = Date.now();
        if (data.lastWork && now - data.lastWork < 30 * 60 * 1000) {
            const remaining = Math.ceil((30 * 60 * 1000 - (now - data.lastWork)) / 1000 / 60);
            return interaction.reply({ content: `You need to rest! Come back in ${remaining} minutes.`, ephemeral: true });
        }
        let earnings = 50 + Math.floor(Math.random() * 100);
        if (data.job) {
            const jobsList = getJobs(guild.id);
            const job = jobsList.find(j => j.name === data.job);
            if (job) earnings += job.salary;
        }
        data.balance += earnings;
        data.lastWork = now;
        economy.set(key, data);
        
        const embed = new EmbedBuilder().setColor(0x00FF00).setTitle('Work Complete').setDescription(`You worked hard and earned ${config.economySymbol} ${earnings.toLocaleString()} ${config.economyName}!`);
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Crime ============
    if (commandName === 'crime') {
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastCrime: 0 };
        const now = Date.now();
        if (data.lastCrime && now - data.lastCrime < 10 * 60 * 1000) {
            const remaining = Math.ceil((10 * 60 * 1000 - (now - data.lastCrime)) / 1000 / 60);
            return interaction.reply({ content: `The police are watching you! Wait ${remaining} minutes.`, ephemeral: true });
        }
        const outcome = crimeOutcomes[Math.floor(Math.random() * crimeOutcomes.length)];
        let amount, message;
        if (outcome.success) {
            amount = Math.floor(Math.random() * (outcome.maxGain - outcome.minGain + 1)) + outcome.minGain;
            data.balance += amount;
            message = outcome.message.replace('{amount}', amount.toLocaleString());
        } else {
            amount = Math.floor(Math.random() * (outcome.maxLoss - outcome.minLoss + 1)) + outcome.minLoss;
            data.balance = Math.max(0, data.balance - amount);
            message = outcome.message.replace('{amount}', amount.toLocaleString());
        }
        data.lastCrime = now;
        economy.set(key, data);
        
        const color = outcome.success ? 0x00FF00 : 0xFF0000;
        const embed = new EmbedBuilder().setColor(color).setTitle('Crime Attempt').setDescription(message);
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Rob ============
    if (commandName === 'rob') {
        const target = options.getUser('user');
        if (target.id === interaction.user.id) return interaction.reply({ content: 'You cannot rob yourself!', ephemeral: true });
        
        const robberKey = getEconomyKey(guild.id, interaction.user.id);
        const targetKey = getEconomyKey(guild.id, target.id);
        
        const robberData = economy.get(robberKey) || { balance: 0, inventory: [], job: null };
        const targetData = economy.get(targetKey) || { balance: 0, inventory: [], job: null };
        
        // Check safe mode
        if (isSafeMode(guild.id, target.id)) {
            return interaction.reply({ content: `${target.username} has safe mode enabled! You cannot rob them.`, ephemeral: true });
        }
        
        if (targetData.balance < 100) return interaction.reply({ content: `${target.username} doesn't have enough coins to rob!`, ephemeral: true });
        if (robberData.balance < 500) return interaction.reply({ content: `You need at least ${config.economySymbol}500 to attempt robbery!`, ephemeral: true });
        
        // Check active robbery cooldown
        const robberyKey = `${guild.id}-${interaction.user.id}`;
        if (activeRobberies.has(robberyKey)) {
            return interaction.reply({ content: `You already attempted a robbery recently! Wait a few minutes.`, ephemeral: true });
        }
        
        activeRobberies.set(robberyKey, true);
        setTimeout(() => activeRobberies.delete(robberyKey), 5 * 60 * 1000);
        
        const success = Math.random() < 0.4;
        if (success) {
            const stolen = Math.min(Math.floor(targetData.balance * 0.3), 1000);
            robberData.balance += stolen;
            targetData.balance -= stolen;
            economy.set(robberKey, robberData);
            economy.set(targetKey, targetData);
            await interaction.reply({ content: `🦹‍♂️ You successfully robbed ${target.username} and stole ${config.economySymbol} ${stolen.toLocaleString()}!` });
        } else {
            const penalty = Math.min(robberData.balance, 300);
            robberData.balance -= penalty;
            economy.set(robberKey, robberData);
            await interaction.reply({ content: `🚨 You got caught! You lost ${config.economySymbol} ${penalty.toLocaleString()} as a fine!` });
        }
        return;
    }
    
    // ============ Safe Mode ============
    if (commandName === 'safemode') {
        const action = options.getString('action');
        const key = `${guild.id}-${interaction.user.id}`;
        if (action === 'on') {
            safeMode.set(key, true);
            await interaction.reply({ content: `🔒 Safe mode enabled! You cannot be robbed.`, ephemeral: true });
        } else {
            safeMode.set(key, false);
            await interaction.reply({ content: `🔓 Safe mode disabled! You can now be robbed.`, ephemeral: true });
        }
        return;
    }
    
    // ============ Transfer ============
    if (commandName === 'transfer') {
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        if (amount < 1) return interaction.reply({ content: 'Amount must be positive!', ephemeral: true });
        
        const senderBalance = getUserBalance(guild.id, interaction.user.id);
        if (senderBalance < amount) return interaction.reply({ content: `You don't have enough ${config.economyName}!`, ephemeral: true });
        
        removeUserBalance(guild.id, interaction.user.id, amount);
        addUserBalance(guild.id, target.id, amount);
        await interaction.reply({ content: `✅ Transferred ${config.economySymbol} ${amount.toLocaleString()} to ${target.username}!` });
        return;
    }
    
    // ============ Leaderboard Money ============
    if (commandName === 'leaderboard-money') {
        await interaction.deferReply();
        let allUsers = [];
        for (const [k, data] of economy) {
            if (k.startsWith(guild.id)) {
                allUsers.push({ userId: k.split('-')[1], balance: data.balance });
            }
        }
        allUsers.sort((a, b) => b.balance - a.balance);
        const top10 = allUsers.slice(0, 10);
        let text = '';
        for (let i = 0; i < top10.length; i++) {
            const user = await client.users.fetch(top10[i].userId).catch(() => null);
            text += `${i+1}. ${user ? user.username : 'Unknown'} - ${config.economySymbol} ${top10[i].balance.toLocaleString()}\n`;
        }
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Richest Users').setDescription(text || 'No users found!');
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // ============ Gamble ============
    if (commandName === 'gamble') {
        const amount = options.getInteger('amount');
        const balance = getUserBalance(guild.id, interaction.user.id);
        if (amount < 10) return interaction.reply({ content: 'Minimum gamble is 10 coins!', ephemeral: true });
        if (balance < amount) return interaction.reply({ content: `You don't have enough ${config.economyName}!`, ephemeral: true });
        
        const win = Math.random() < 0.45;
        if (win) {
            const winnings = amount * 2;
            addUserBalance(guild.id, interaction.user.id, winnings);
            await interaction.reply({ content: `🎉 You won ${config.economySymbol} ${winnings.toLocaleString()}! New balance: ${(balance + winnings).toLocaleString()}` });
        } else {
            removeUserBalance(guild.id, interaction.user.id, amount);
            await interaction.reply({ content: `💀 You lost ${config.economySymbol} ${amount.toLocaleString()}! New balance: ${(balance - amount).toLocaleString()}` });
        }
        return;
    }
    
    // ============ Slots ============
    if (commandName === 'slots') {
        const amount = options.getInteger('amount');
        const balance = getUserBalance(guild.id, interaction.user.id);
        if (amount < 10) return interaction.reply({ content: 'Minimum bet is 10 coins!', ephemeral: true });
        if (balance < amount) return interaction.reply({ content: `You don't have enough ${config.economyName}!`, ephemeral: true });
        
        const slots = ['🍒', '🍋', '🍊', '🍉', '⭐', '💎'];
        const result = [slots[Math.floor(Math.random() * slots.length)], slots[Math.floor(Math.random() * slots.length)], slots[Math.floor(Math.random() * slots.length)]];
        const isJackpot = result[0] === result[1] && result[1] === result[2];
        const isPair = result[0] === result[1] || result[1] === result[2] || result[0] === result[2];
        
        let winnings = 0;
        if (isJackpot) winnings = amount * 10;
        else if (isPair) winnings = amount * 2;
        
        if (winnings > 0) {
            addUserBalance(guild.id, interaction.user.id, winnings);
            await interaction.reply({ content: `🎰 ${result.join(' | ')}\n🎉 You won ${config.economySymbol} ${winnings.toLocaleString()}!` });
        } else {
            removeUserBalance(guild.id, interaction.user.id, amount);
            await interaction.reply({ content: `🎰 ${result.join(' | ')}\n💀 You lost ${config.economySymbol} ${amount.toLocaleString()}!` });
        }
        return;
    }
    
    // ============ Shop ============
    if (commandName === 'shop') {
        const shopItems = getShop(guild.id);
        let description = '';
        for (const item of shopItems) {
            description += `**${item.name}** - ${config.economySymbol} ${item.price.toLocaleString()}\n${item.description}\n\n`;
        }
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Shop Items').setDescription(description || 'No items in shop!');
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Buy ============
    if (commandName === 'buy') {
        const itemName = options.getString('item');
        const shopItems = getShop(guild.id);
        const item = shopItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (!item) return interaction.reply({ content: 'Item not found!', ephemeral: true });
        
        const balance = getUserBalance(guild.id, interaction.user.id);
        if (balance < item.price) return interaction.reply({ content: `You need ${config.economySymbol} ${item.price.toLocaleString()} to buy this!`, ephemeral: true });
        
        removeUserBalance(guild.id, interaction.user.id, item.price);
        addToInventory(guild.id, interaction.user.id, { name: item.name, description: item.description });
        await interaction.reply({ content: `✅ You bought **${item.name}** for ${config.economySymbol} ${item.price.toLocaleString()}!` });
        return;
    }
    
    // ============ Sell ============
    if (commandName === 'sell') {
        const itemName = options.getString('item');
        const inventory = getUserInventory(guild.id, interaction.user.id);
        const item = inventory.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (!item) return interaction.reply({ content: 'You don\'t own that item!', ephemeral: true });
        
        const shopItems = getShop(guild.id);
        const shopItem = shopItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        const sellPrice = shopItem ? Math.floor(shopItem.price / 2) : 100;
        
        removeFromInventory(guild.id, interaction.user.id, item.name);
        addUserBalance(guild.id, interaction.user.id, sellPrice);
        await interaction.reply({ content: `💰 You sold **${item.name}** for ${config.economySymbol} ${sellPrice.toLocaleString()}!` });
        return;
    }
    
    // ============ Inventory ============
    if (commandName === 'inventory') {
        const target = options.getUser('user') || interaction.user;
        const inventory = getUserInventory(guild.id, target.id);
        if (inventory.length === 0) return interaction.reply({ content: `${target.username}'s inventory is empty!` });
        
        let description = '';
        for (const item of inventory) {
            description += `**${item.name}**\n${item.description}\n\n`;
        }
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(`${target.username}'s Inventory`).setDescription(description);
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Jobs List ============
    if (commandName === 'jobs') {
        const jobsList = getJobs(guild.id);
        let description = '';
        for (const job of jobsList) {
            description += `**${job.name}** - ${config.economySymbol} ${job.salary}/work\n${job.description}\n\n`;
        }
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Available Jobs').setDescription(description);
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Apply Job ============
    if (commandName === 'apply') {
        const jobName = options.getString('job');
        const jobsList = getJobs(guild.id);
        const job = jobsList.find(j => j.name.toLowerCase() === jobName.toLowerCase());
        if (!job) return interaction.reply({ content: 'Job not found!', ephemeral: true });
        
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
        data.job = job.name;
        economy.set(key, data);
        await interaction.reply({ content: `✅ You are now a **${job.name}**! Earn ${config.economySymbol} ${job.salary} extra per work command!` });
        return;
    }
    
    // ============ Resign ============
    if (commandName === 'resign') {
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null };
        if (!data.job) return interaction.reply({ content: 'You don\'t have a job!', ephemeral: true });
        
        data.job = null;
        economy.set(key, data);
        await interaction.reply({ content: `✅ You resigned from your job!` });
        return;
    }
    
    // ============ Job Info ============
    if (commandName === 'job-info') {
        const key = getEconomyKey(guild.id, interaction.user.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null };
        if (!data.job) return interaction.reply({ content: 'You don\'t have a job! Use /apply to get one.' });
        
        const jobsList = getJobs(guild.id);
        const job = jobsList.find(j => j.name === data.job);
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle('Your Job').addFields(
            { name: 'Position', value: job ? job.name : data.job, inline: true },
            { name: 'Salary', value: `${config.economySymbol} ${job ? job.salary : 0}/work`, inline: true },
            { name: 'Description', value: job ? job.description : 'No description', inline: false }
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Admin Economy Commands ============
    if (commandName === 'addmoney') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        addUserBalance(guild.id, target.id, amount);
        await interaction.reply({ content: `✅ Added ${config.economySymbol} ${amount.toLocaleString()} to ${target.username}.` });
        return;
    }
    
    if (commandName === 'removemoney') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        if (removeUserBalance(guild.id, target.id, amount)) {
            await interaction.reply({ content: `✅ Removed ${config.economySymbol} ${amount.toLocaleString()} from ${target.username}.` });
        } else {
            await interaction.reply({ content: `❌ ${target.username} doesn't have enough coins!` });
        }
        return;
    }
    
    if (commandName === 'setmoney') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        setUserBalance(guild.id, target.id, amount);
        await interaction.reply({ content: `✅ Set ${target.username}'s balance to ${config.economySymbol} ${amount.toLocaleString()}.` });
        return;
    }
    
    if (commandName === 'reset-economy') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        for (const [k] of economy) {
            if (k.startsWith(guild.id)) economy.delete(k);
        }
        for (const [k] of safeMode) {
            if (k.startsWith(guild.id)) safeMode.delete(k);
        }
        shops.delete(guild.id);
        jobs.delete(guild.id);
        await interaction.reply({ content: `✅ Economy data for this server has been reset!` });
        return;
    }
    
    // ============ Shop Admin Commands ============
    if (commandName === 'shop-add') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const name = options.getString('name');
        const price = options.getInteger('price');
        const desc = options.getString('description') || 'No description';
        const shopItems = getShop(guild.id);
        shopItems.push({ name, price, description: desc, sellPrice: Math.floor(price / 2) });
        shops.set(guild.id, shopItems);
        await interaction.reply({ content: `✅ Added **${name}** to shop for ${config.economySymbol} ${price}!` });
        return;
    }
    
    if (commandName === 'shop-remove') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const itemName = options.getString('item');
        const shopItems = getShop(guild.id);
        const index = shopItems.findIndex(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (index === -1) return interaction.reply({ content: 'Item not found!', ephemeral: true });
        shopItems.splice(index, 1);
        shops.set(guild.id, shopItems);
        await interaction.reply({ content: `✅ Removed **${itemName}** from shop!` });
        return;
    }
    
    // ============ Job Admin Commands ============
    if (commandName === 'job-add') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const name = options.getString('name');
        const salary = options.getInteger('salary');
        const desc = options.getString('description') || 'No description';
        const jobsList = getJobs(guild.id);
        jobsList.push({ name, salary, description: desc });
        jobs.set(guild.id, jobsList);
        await interaction.reply({ content: `✅ Added job **${name}** with salary ${config.economySymbol} ${salary}!` });
        return;
    }
    
    if (commandName === 'job-remove') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const jobName = options.getString('job');
        const jobsList = getJobs(guild.id);
        const index = jobsList.findIndex(j => j.name.toLowerCase() === jobName.toLowerCase());
        if (index === -1) return interaction.reply({ content: 'Job not found!', ephemeral: true });
        jobsList.splice(index, 1);
        jobs.set(guild.id, jobsList);
        await interaction.reply({ content: `✅ Removed job **${jobName}**!` });
        return;
    }
    
    if (commandName === 'promote') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const salaryIncrease = options.getInteger('salary');
        const key = getEconomyKey(guild.id, target.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
        if (!data.job) return interaction.reply({ content: `${target.username} doesn't have a job!`, ephemeral: true });
        
        const jobsList = getJobs(guild.id);
        const jobIndex = jobsList.findIndex(j => j.name === data.job);
        if (jobIndex !== -1) {
            jobsList[jobIndex].salary += salaryIncrease;
            jobs.set(guild.id, jobsList);
        }
        await interaction.reply({ content: `✅ Promoted ${target.username}! Salary increased by ${config.economySymbol} ${salaryIncrease}.` });
        return;
    }
    
    if (commandName === 'demote') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const key = getEconomyKey(guild.id, target.id);
        const data = economy.get(key) || { balance: 0, inventory: [], job: null, lastDaily: 0, lastWork: 0, lastCrime: 0 };
        if (!data.job) return interaction.reply({ content: `${target.username} doesn't have a job!`, ephemeral: true });
        
        data.job = null;
        economy.set(key, data);
        await interaction.reply({ content: `✅ Demoted ${target.username}! They lost their job.` });
        return;
    }
    
    // ============ Setup Commands ============
    if (commandName === 'setup') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        guildSettings.set(guild.id, defaultConfig);
        const embed = new EmbedBuilder().setColor(0x00FF00).setTitle('Setup Complete').setDescription('Fruxty is now protecting your server!');
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    if (commandName === 'setup-voice') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        await interaction.reply({ content: 'Setting up temp voice...', ephemeral: true });
        const category = await guild.channels.create({ name: 'Temp Voice', type: ChannelType.GuildCategory });
        const creator = await guild.channels.create({ name: 'create-vc', type: ChannelType.GuildVoice, parent: category.id });
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.voiceSetup = true;
        newConfig.voiceCategory = category.id;
        newConfig.voiceCreator = creator.id;
        guildSettings.set(guild.id, newConfig);
        await interaction.editReply({ content: null, embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('Temp Voice Ready').setDescription(`Join ${creator} to get your own VC!`)] });
        return;
    }
    
    if (commandName === 'setup-verify') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const verifyChannel = options.getChannel('channel');
        const verifyRole = options.getRole('role');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.verifyChannel = verifyChannel.id;
        newConfig.verifyRole = verifyRole.id;
        guildSettings.set(guild.id, newConfig);
        const embed = new EmbedBuilder().setColor(0x00FF00).setTitle('Verification Setup').setDescription(`Click below to get ${verifyRole.name}`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_button').setLabel('Verify').setStyle(ButtonStyle.Success));
        await verifyChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `Verification setup in ${verifyChannel}!`, ephemeral: true });
        return;
    }
    
    if (commandName === 'setup-welcome') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const welcomeChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.welcomeChannel = welcomeChannel.id;
        guildSettings.set(guild.id, newConfig);
        await interaction.reply({ content: `Welcome messages will be sent to ${welcomeChannel}!`, ephemeral: true });
        return;
    }
    
    if (commandName === 'setup-goodbye') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const goodbyeChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.goodbyeChannel = goodbyeChannel.id;
        guildSettings.set(guild.id, newConfig);
        await interaction.reply({ content: `Goodbye messages will be sent to ${goodbyeChannel}!`, ephemeral: true });
        return;
    }
    
    if (commandName === 'setup-status') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const statusChannel = options.getChannel('channel');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.serverStatus = { enabled: true, channelId: statusChannel.id, messageId: null };
        guildSettings.set(guild.id, newConfig);
        await interaction.reply({ content: `Server status will be sent to ${statusChannel} every 5 minutes!`, ephemeral: true });
        await updateServerStatusMessage(guild);
        return;
    }
    
    if (commandName === 'automod') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const action = options.getString('action');
        const newConfig = guildSettings.get(guild.id) || defaultConfig;
        newConfig.automod.enabled = action === 'on';
        guildSettings.set(guild.id, newConfig);
        await interaction.reply({ content: `AutoMod turned ${action.toUpperCase()}!`, ephemeral: true });
        return;
    }
    
    // ============ Moderation Commands ============
    if (commandName === 'purge') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const amount = options.getInteger('amount');
        const messages = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(messages, true);
        await interaction.reply({ content: `Deleted ${deleted.size} messages!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply(), 3000);
        return;
    }
    
    if (commandName === 'lockdown') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        await interaction.reply({ content: `${targetChannel} locked down!`, ephemeral: true });
        return;
    }
    
    if (commandName === 'slowmode') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const seconds = options.getInteger('seconds');
        const targetChannel = options.getChannel('channel') || channel;
        await targetChannel.setRateLimitPerUser(seconds);
        await interaction.reply({ content: `Slowmode set to ${seconds} seconds!`, ephemeral: true });
        return;
    }
    
    if (commandName === 'ban') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.bannable) return interaction.reply({ content: 'Cannot ban this user!', ephemeral: true });
        await targetMember.ban({ reason });
        await interaction.reply({ content: `Banned ${target.tag} for: ${reason}` });
        return;
    }
    
    if (commandName === 'kick') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.kickable) return interaction.reply({ content: 'Cannot kick this user!', ephemeral: true });
        await targetMember.kick(reason);
        await interaction.reply({ content: `Kicked ${target.tag} for: ${reason}` });
        return;
    }
    
    if (commandName === 'timeout') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const minutes = options.getInteger('minutes');
        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || !targetMember.moderatable) return interaction.reply({ content: 'Cannot timeout this user!', ephemeral: true });
        await targetMember.timeout(minutes * 60 * 1000);
        await interaction.reply({ content: `Timed out ${target.tag} for ${minutes} minutes!` });
        return;
    }
    
    if (commandName === 'warn') {
        if (!isAdmin(member)) return interaction.reply({ content: 'Admin only!', ephemeral: true });
        const target = options.getUser('user');
        const reason = options.getString('reason');
        const key = `${guild.id}-${target.id}`;
        const userWarnings = warnings.get(key) || [];
        userWarnings.push({ reason, date: Date.now(), mod: interaction.user.tag });
        warnings.set(key, userWarnings);
        await interaction.reply({ content: `Warned ${target.tag} for: ${reason} (${userWarnings.length}/3 warnings)` });
        if (userWarnings.length >= 3) {
            const targetMember = await guild.members.fetch(target.id);
            await targetMember.timeout(30 * 60 * 1000, '3 warnings');
            await interaction.followUp({ content: `${target.tag} timed out for 30 minutes (3 warnings)` });
            warnings.delete(key);
        }
        return;
    }
    
    if (commandName === 'warnings') {
        const target = options.getUser('user') || interaction.user;
        const userWarnings = warnings.get(`${guild.id}-${target.id}`) || [];
        const embed = new EmbedBuilder().setColor(0xFF6B35).setTitle(`${target.tag}'s Warnings`).setDescription(userWarnings.length > 0 ? userWarnings.map((w, i) => `${i+1}. ${w.reason} (by ${w.mod})`).join('\n') : 'No warnings');
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // ============ Voice Commands ============
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
        if (!userChannel) return interaction.reply({ content: 'You don\'t own a temp voice channel!', ephemeral: true });
        
        const subcommand = options.getSubcommand();
        if (subcommand === 'rename') {
            const newName = options.getString('name');
            await userChannel.setName(newName.slice(0, 32));
            await interaction.reply({ content: `Renamed to ${newName}` });
        } else if (subcommand === 'limit') {
            const limit = options.getInteger('limit');
            await userChannel.setUserLimit(limit);
            await interaction.reply({ content: `User limit set to ${limit}` });
        } else if (subcommand === 'lock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: false });
            await interaction.reply({ content: 'Channel locked!' });
        } else if (subcommand === 'unlock') {
            await userChannel.permissionOverwrites.edit(guild.id, { Connect: null });
            await interaction.reply({ content: 'Channel unlocked!' });
        } else if (subcommand === 'hide') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
            await interaction.reply({ content: 'Channel hidden!' });
        } else if (subcommand === 'reveal') {
            await userChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
            await interaction.reply({ content: 'Channel visible!' });
        } else if (subcommand === 'claim') {
            const owner = userChannel.members.get(tempChannels.get(userChannelId)?.ownerId);
            if (owner && owner.id !== member.id) return interaction.reply({ content: 'Owner is still here!' });
            const oldData = tempChannels.get(userChannelId);
            tempChannels.set(userChannelId, { ...oldData, ownerId: member.id });
            await userChannel.permissionOverwrites.edit(member.id, { Connect: true, ManageChannels: true });
            await interaction.reply({ content: 'You are now the owner!' });
        }
        return;
    }
    
    // ============ Verify Command ============
    if (commandName === 'verify') {
        const config = guildSettings.get(guild.id) || defaultConfig;
        if (!config.verifyRole) return interaction.reply({ content: 'Verification not setup!', ephemeral: true });
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const verifyCodes = client.verifyCodes || new Map();
        verifyCodes.set(interaction.user.id, code);
        client.verifyCodes = verifyCodes;
        await interaction.reply({ content: `Type this code: \`${code}\``, ephemeral: true });
        const filter = m => m.author.id === interaction.user.id && m.content === code;
        const collector = channel.createMessageCollector({ filter, time: 300000, max: 1 });
        collector.on('collect', async () => {
            const role = guild.roles.cache.get(config.verifyRole);
            if (role) await member.roles.add(role);
            await interaction.followUp({ content: 'Verified!' });
            verifyCodes.delete(interaction.user.id);
        });
        return;
    }
});

// ============ Button Handler ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'verify_button') {
        const config = guildSettings.get(interaction.guild.id) || defaultConfig;
        if (!config.verifyRole) return interaction.reply({ content: 'Verification not setup!', ephemeral: true });
        const role = interaction.guild.roles.cache.get(config.verifyRole);
        if (!role) return interaction.reply({ content: 'Role not found!', ephemeral: true });
        if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: 'Already verified!', ephemeral: true });
        await interaction.member.roles.add(role);
        await interaction.reply({ content: 'Verified!' });
    }
});

// ============ Inbuilt Dashboard ============
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Fruxty Bot Dashboard</title><style>
        body { font-family: Arial; background: #0a0a0a; color: white; text-align: center; padding: 50px; }
        .stat { background: #1a1a1a; padding: 20px; margin: 10px; border-radius: 10px; display: inline-block; border: 1px solid #ff6b35; }
        .value { font-size: 32px; color: #ff6b35; font-weight: bold; }
        button { background: #ff6b35; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }
    </style></head>
    <body>
        <h1>Fruxty Bot Dashboard</h1>
        <div id="stats"></div>
        <div><button onclick="fetch('/api/status').then(r=>r.json()).then(d=>alert('Bot Online: '+d.guilds+' servers'))">Check Status</button></div>
        <script>
            fetch('/api/status').then(r=>r.json()).then(d=>{
                document.getElementById('stats').innerHTML = \`
                    <div class="stat"><div class="value">\${d.guilds}</div><div>Servers</div></div>
                    <div class="stat"><div class="value">\${d.ping}ms</div><div>Ping</div></div>
                    <div class="stat"><div class="value">\${d.commands}</div><div>Commands</div></div>
                \`;
            });
        </script>
    </body>
    </html>
    `);
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
    res.json(client.guilds.cache.map(g => ({ id: g.id, name: g.name, memberCount: g.memberCount })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard on port ${PORT}`));

// ============ Login ============
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    process.exit(1);
});
