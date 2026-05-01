const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
require('dotenv').config();

const PREFIX = 'R!';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Queue system: Map of guildId -> queue object
const queues = new Map();

class MusicQueue {
    constructor(guildId, textChannel) {
        this.guildId = guildId;
        this.textChannel = textChannel;
        this.songs = [];
        this.currentSong = null;
        this.player = createAudioPlayer();
        this.connection = null;
        this.isPlaying = false;
        this.isPaused = false;
        
        this.setupPlayerEvents();
    }
    
    setupPlayerEvents() {
        this.player.on(AudioPlayerStatus.Idle, () => {
            this.isPlaying = false;
            this.isPaused = false;
            this.playNext();
        });
        
        this.player.on(AudioPlayerStatus.Playing, () => {
            this.isPlaying = true;
            this.isPaused = false;
        });
        
        this.player.on(AudioPlayerStatus.Paused, () => {
            this.isPaused = true;
        });
        
        this.player.on('error', error => {
            console.error('Player error:', error);
            this.textChannel.send('❌ An error occurred while playing the audio.');
            this.playNext();
        });
    }
    
    async playNext() {
        if (this.songs.length === 0) {
            this.isPlaying = false;
            this.currentSong = null;
            if (this.connection) {
                this.connection.destroy();
                this.connection = null;
            }
            return;
        }
        
        const song = this.songs.shift();
        this.currentSong = song;
        
        try {
            const stream = ytdl(song.url, { 
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25
            });
            
            const resource = createAudioResource(stream);
            this.player.play(resource);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🎵 Now Playing')
                .setDescription(`[${song.title}](${song.url})`)
                .addFields(
                    { name: 'Duration', value: song.duration, inline: true },
                    { name: 'Requested by', value: song.requestedBy, inline: true }
                )
                .setFooter({ text: `Queue: ${this.songs.length} song(s) remaining` });
            
            this.textChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error playing song:', error);
            this.textChannel.send(`❌ Failed to play: ${song.title}`);
            this.playNext();
        }
    }
    
    async addSong(song, requestedBy) {
        const songInfo = {
            title: song.title,
            url: song.url,
            duration: song.duration.timestamp || 'Live',
            requestedBy: requestedBy
        };
        
        this.songs.push(songInfo);
        
        if (!this.isPlaying && !this.isPaused) {
            this.playNext();
        } else {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📥 Added to Queue')
                .setDescription(`[${song.title}](${song.url})`)
                .addFields(
                    { name: 'Position', value: `${this.songs.length}`, inline: true },
                    { name: 'Duration', value: songInfo.duration, inline: true },
                    { name: 'Requested by', value: requestedBy, inline: true }
                );
            this.textChannel.send({ embeds: [embed] });
        }
    }
    
    skip() {
        if (this.isPlaying) {
            this.player.stop();
            return true;
        }
        return false;
    }
    
    stop() {
        this.songs = [];
        this.currentSong = null;
        if (this.isPlaying) {
            this.player.stop();
        }
        if (this.connection) {
            this.connection.destroy();
            this.connection = null;
        }
        this.isPlaying = false;
        this.isPaused = false;
    }
    
    pause() {
        if (this.isPlaying && !this.isPaused) {
            this.player.pause();
            return true;
        }
        return false;
    }
    
    resume() {
        if (this.isPaused) {
            this.player.unpause();
            return true;
        }
        return false;
    }
    
    getQueue() {
        return this.songs;
    }
    
    async joinVoiceChannel(voiceChannel, textChannel) {
        this.textChannel = textChannel;
        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });
        
        this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            this.stop();
            queues.delete(this.guildId);
        });
        
        const subscription = this.connection.subscribe(this.player);
        return subscription;
    }
}

// Helper function to search YouTube
async function searchYouTube(query) {
    const result = await ytSearch(query);
    return result.videos.length > 0 ? result.videos[0] : null;
}

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity('R!p <song>', { type: 'LISTENING' });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Get or create queue for this guild
    let queue = queues.get(message.guild.id);
    
    // PLAY command (R!p or R!play)
    if (command === 'p' || command === 'play') {
        const query = args.join(' ');
        if (!query) {
            return message.reply('❌ Please provide a song name or YouTube URL!\nExample: `R!p Never Gonna Give You Up`');
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ You need to be in a voice channel to play music!');
        }
        
        // Check bot permissions
        if (!voiceChannel.joinable) {
            return message.reply('❌ I don\'t have permission to join your voice channel!');
        }
        
        if (!voiceChannel.speakable) {
            return message.reply('❌ I don\'t have permission to speak in your voice channel!');
        }
        
        // Search for song
        let song;
        if (ytdl.validateURL(query)) {
            try {
                const songInfo = await ytdl.getInfo(query);
                song = {
                    title: songInfo.videoDetails.title,
                    url: songInfo.videoDetails.video_url,
                    duration: { timestamp: songInfo.videoDetails.lengthSeconds ? formatDuration(songInfo.videoDetails.lengthSeconds) : 'Live' }
                };
            } catch (error) {
                return message.reply('❌ Invalid YouTube URL or unable to fetch video.');
            }
        } else {
            const searchResult = await searchYouTube(query);
            if (!searchResult) {
                return message.reply('❌ No results found for your query.');
            }
            song = searchResult;
        }
        
        // Create queue if doesn't exist
        if (!queue) {
            queue = new MusicQueue(message.guild.id, message.channel);
            queues.set(message.guild.id, queue);
            await queue.joinVoiceChannel(voiceChannel, message.channel);
        } else if (!queue.connection) {
            await queue.joinVoiceChannel(voiceChannel, message.channel);
        } else if (queue.connection.joinConfig.channelId !== voiceChannel.id) {
            // Bot is in a different voice channel
            return message.reply(`❌ I'm already playing music in <#${queue.connection.joinConfig.channelId}>. Use \`${PREFIX}stop\` first if you want me to switch channels.`);
        }
        
        await queue.addSong(song, message.author.tag);
    }
    
    // SKIP command
    else if (command === 'skip') {
        if (!queue || !queue.isPlaying) {
            return message.reply('❌ No music is currently playing!');
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel || queue.connection?.joinConfig.channelId !== voiceChannel.id) {
            return message.reply('❌ You need to be in the same voice channel as the bot to skip!');
        }
        
        const skipped = queue.skip();
        if (skipped) {
            message.reply('⏭️ Skipped the current song!');
        } else {
            message.reply('❌ Unable to skip at this moment.');
        }
    }
    
    // STOP command (clears queue and leaves)
    else if (command === 'stop') {
        if (!queue) {
            return message.reply('❌ No music is currently playing!');
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel || queue.connection?.joinConfig.channelId !== voiceChannel.id) {
            return message.reply('❌ You need to be in the same voice channel as the bot to stop!');
        }
        
        queue.stop();
        queues.delete(message.guild.id);
        message.reply('⏹️ Stopped the music and cleared the queue!');
    }
    
    // QUEUE command
    else if (command === 'queue' || command === 'q') {
        if (!queue || queue.getQueue().length === 0) {
            return message.reply('📭 The queue is empty!');
        }
        
        const songList = queue.getQueue();
        let queueText = '';
        for (let i = 0; i < Math.min(songList.length, 10); i++) {
            queueText += `${i + 1}. [${songList[i].title}](${songList[i].url}) - ${songList[i].duration} (Requested by: ${songList[i].requestedBy})\n`;
        }
        
        if (songList.length > 10) {
            queueText += `\n... and ${songList.length - 10} more songs.`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📋 Music Queue')
            .setDescription(queueText)
            .setFooter({ text: `Total: ${songList.length} song(s)` });
        
        if (queue.currentSong) {
            embed.addFields({ name: '🎶 Currently Playing', value: `[${queue.currentSong.title}](${queue.currentSong.url})` });
        }
        
        message.channel.send({ embeds: [embed] });
    }
    
    // PAUSE command
    else if (command === 'pause') {
        if (!queue || !queue.isPlaying) {
            return message.reply('❌ No music is currently playing!');
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel || queue.connection?.joinConfig.channelId !== voiceChannel.id) {
            return message.reply('❌ You need to be in the same voice channel as the bot to pause!');
        }
        
        const paused = queue.pause();
        if (paused) {
            message.reply('⏸️ Paused the music. Use `R!resume` to continue.');
        } else {
            message.reply('❌ Music is already paused or not playing.');
        }
    }
    
    // RESUME command
    else if (command === 'resume') {
        if (!queue || !queue.isPaused) {
            return message.reply('❌ No paused music to resume!');
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel || queue.connection?.joinConfig.channelId !== voiceChannel.id) {
            return message.reply('❌ You need to be in the same voice channel as the bot to resume!');
        }
        
        const resumed = queue.resume();
        if (resumed) {
            message.reply('▶️ Resumed the music!');
        } else {
            message.reply('❌ Unable to resume music.');
        }
    }
    
    // HELP command
    else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🎵 Music Bot Commands')
            .setDescription('Here are all the available commands:')
            .addFields(
                { name: `${PREFIX}play / ${PREFIX}p <song>`, value: 'Play a song from YouTube (name or URL)', inline: false },
                { name: `${PREFIX}skip`, value: 'Skip the current song', inline: true },
                { name: `${PREFIX}stop`, value: 'Stop playback and clear queue', inline: true },
                { name: `${PREFIX}queue / ${PREFIX}q`, value: 'Show the current queue', inline: true },
                { name: `${PREFIX}pause`, value: 'Pause the current song', inline: true },
                { name: `${PREFIX}resume`, value: 'Resume paused song', inline: true },
                { name: `${PREFIX}help`, value: 'Show this help message', inline: true }
            )
            .setFooter({ text: 'Need help? Make sure the bot has voice permissions!' });
        
        message.channel.send({ embeds: [embed] });
    }
});

// Helper function to format duration in seconds to MM:SS
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
