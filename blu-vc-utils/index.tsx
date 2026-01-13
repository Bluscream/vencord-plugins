/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Authors: Bluscream
// Created at 2026-01-10 11:03:00

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { copyWithToast } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildStore, Menu, MessageStore, React, Toasts, UserStore } from "@webpack/common";

interface VoiceChannelContextProps {
    channel: Channel;
}

const pluginName = "blu-vc-utils";
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelStatusStore = findStoreLazy("ChannelStatusStore");
const statuses: Record<string, string> = {};

// Helper function to show error toasts
function showToast(message: string, error?: any | undefined) {
    if (error) console.error(`[${pluginName}] ${message}:`, error);
    else console.log(`[${pluginName}] ${message}`);
    Toasts.show({
        message,
        id: Toasts.genId(),
        type: error ? Toasts.Type.FAILURE : Toasts.Type.MESSAGE
    });
}

function requestVoiceChannelStatus(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        if (channel?.guild_id) {
            // Dispatch event to request channel statuses for the guild
            const dispatchPayload = {
                type: "VOICE_CHANNEL_STATUS_REQUEST",
                guildId: channel.guild_id
            };
            console.log(`[${pluginName}] Dispatching status request for guild ${channel.guild_id}`, dispatchPayload);
            FluxDispatcher.dispatch(dispatchPayload);
        } else {
            console.log(`[${pluginName}] Cannot request status - no guild_id for channel ${channelId}`);
        }
    } catch (error) {
        showToast("Error requesting voice channel status", error);
    }
}

// Extract status text from UI element
function getVoiceChannelStatusFromUI(channelId: string): string | null {
    try {
        console.log(`[${pluginName}] Getting status from UI for channel: ${channelId}`);

        // Find all voice channel elements
        const voiceChannelElements = document.querySelectorAll('li[class*="voiceChannel"]');

        for (const element of voiceChannelElements) {
            // Get the React fiber to access channel props
            const fiberKey = Object.keys(element).find(key =>
                key.startsWith("__reactInternalInstance$") || key.startsWith("__reactFiber$")
            );

            if (fiberKey) {
                const fiber = (element as any)[fiberKey];
                let current = fiber;

                // Traverse up the React tree to find the component with channel prop
                while (current) {
                    if (current.memoizedProps && current.memoizedProps.channel) {
                        const { channel } = current.memoizedProps;

                        // Check if this is the channel we're looking for
                        if (channel.id === channelId) {
                            console.log(`[${pluginName}] Found channel ${channelId}`);

                            // Try to find the status span element within this channel
                            // Look for span that contains the status text (typically after the "Invite to Voice" number spans)
                            const spans = element.querySelectorAll("span");
                            for (const span of spans) {
                                const text = span.textContent?.trim();
                                if (text && text.length > 3 && !text.match(/^(Voice|Open Chat|Invite to Voice|\d{1,2}|Playing|WZDE|snus)$/)) {
                                    console.log(`[${pluginName}] Extracted status from span: "${text}"`);
                                    return text;
                                }
                            }

                            // Fallback: extract from full text using patterns
                            const text = element.textContent || "";
                            console.log(`[${pluginName}] Trying fallback extraction from full text: ${text}`);

                            const statusMatch = text.match(/Invite to Voice\d+(.+?)(?=@[A-Za-z0-9_]+|\d{1,2}:\d{2}:\d{2})/);
                            if (statusMatch) {
                                const status = statusMatch[1].trim();
                                console.log(`[${pluginName}] Extracted fallback status: "${status}"`);
                                return status;
                            }

                            const fallbackMatch = text.match(/Open Chat(.+?)(?=@[A-Za-z0-9_]+|\d{1,2}:\d{2}:\d{2})/);
                            if (fallbackMatch) {
                                const status = fallbackMatch[1].trim();
                                console.log(`[${pluginName}] Extracted Open Chat fallback status: "${status}"`);
                                return status;
                            }

                            console.log(`[${pluginName}] No status text found in UI`);
                            return null;
                        }
                        break;
                    }
                    current = current.return;
                }
            }
        }

        console.log(`[${pluginName}] Channel ${channelId} not found in UI`);
        return null;
    } catch (error) {
        console.error(`[${pluginName}] Error getting status from UI:`, error);
        return null;
    }
}

// Voice Channel Status Functions
function getVoiceChannelStatus(channelId: string): string | null {
    try {
        console.log(`[${pluginName}] Getting status for channel: ${channelId}`);

        // Get channel info for guild_id and type
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) {
            console.log(`[${pluginName}] Channel not found: ${channelId}`);
            return null;
        }

        console.log(`[${pluginName}] Channel found: ${channel.name}, guild: ${channel.guild_id}, type: ${channel.type}`);

        // Request fresh status data first
        requestVoiceChannelStatus(channelId);

        // Get status from ChannelStatusStore with correct parameters
        let status = ChannelStatusStore.getChannelStatus(channelId, channel.guild_id, channel.type);
        console.log(`[${pluginName}] Raw status from store:`, status);

        if (status !== undefined && status !== null && status.trim() !== "") {
            console.log(`[${pluginName}] Found valid status: "${status}"`);
            return status;
        }

        status = statuses[channelId];
        if (status !== undefined && status !== null && status.trim() !== "") {
            console.log(`[${pluginName}] Found valid status in fallback: "${status}"`);
            return status;
        }

        // Try to get status from UI element as fallback
        console.log(`[${pluginName}] Trying to get status from UI element`);
        const uiStatus = getVoiceChannelStatusFromUI(channelId);
        if (uiStatus !== undefined && uiStatus !== null && uiStatus.trim() !== "") {
            console.log(`[${pluginName}] Found valid status from UI: "${uiStatus}"`);
            return uiStatus;
        }

        console.log(`[${pluginName}] No valid status found`);
        return null;
    } catch (error) {
        showToast("Error getting voice channel status", error);
        return null;
    }
}

// Helper function to extract code while ignoring specified words
function extractCodeWithIgnore(text: string, regex: RegExp, ignoredWords: string[]): string | null {
    if (!text) return null;

    const matches = text.match(regex);
    if (!matches) return null;

    // Parse ignored words from settings string
    const ignoredSet = new Set(ignoredWords.map(word => word.toLowerCase().trim()));

    // Filter out ignored words and return first valid match
    for (const match of matches) {
        if (!ignoredSet.has(match.toLowerCase())) {
            return match;
        }
    }

    return null; // All matches were ignored
}

async function extractCode(channel: Channel): Promise<string | null> {
    console.log(`[${pluginName}] extractCode called for channel: ${channel.name} (${channel.id})`);
    const regex = new RegExp(settings.store.codeRegex);
    const ignoredWords = settings.store.ignoredWords.split(",").filter(w => w.trim());
    console.log(`[${pluginName}] Using regex pattern: ${settings.store.codeRegex}`);
    console.log(`[${pluginName}] Ignored words: [${ignoredWords.join(", ")}]`);

    // Try to extract from channel status
    console.log(`[${pluginName}] Checking channel status`);
    const status = getVoiceChannelStatus(channel.id);
    if (status) {
        const statusMatch = extractCodeWithIgnore(status, regex, ignoredWords);
        if (statusMatch) {
            console.log(`[${pluginName}] Found code in channel status: ${statusMatch}`);
            return statusMatch;
        }
    }
    // Try to extract from channel topic
    console.log(`[${pluginName}] Checking channel topic: "${channel.topic}"`);
    const topicMatch = extractCodeWithIgnore(channel.topic || "", regex, ignoredWords);
    if (topicMatch) {
        console.log(`[${pluginName}] Found code in channel topic: ${topicMatch}`);
        return topicMatch;
    }
    // Try to extract from channel name
    console.log(`[${pluginName}] Checking channel name: "${channel.name}"`);
    const nameMatch = extractCodeWithIgnore(channel.name || "", regex, ignoredWords);
    if (nameMatch) {
        console.log(`[${pluginName}] Found code in channel name: ${nameMatch}`);
        return nameMatch;
    }
    // Try to extract from messages in the channel
    console.log(`[${pluginName}] Checking messages in channel...`);
    try {
        const messages = MessageStore.getMessages(channel.id);
        console.log(`[${pluginName}] Retrieved messages object:`, messages ? "found" : "null");

        if (messages && messages.toArray) {
            const messageArray = messages.toArray();
            console.log(`[${pluginName}] Processing ${messageArray.length} messages`);

            for (const message of messageArray) {
                if (message.content) {
                    const messageMatch = extractCodeWithIgnore(message.content, regex, ignoredWords);
                    if (messageMatch) {
                        console.log(`[${pluginName}] Found code in message from ${message.author?.username || "unknown"}: ${messageMatch}`);
                        return messageMatch;
                    }
                }
            }
        } else {
            console.log(`[${pluginName}] No messages found or messages.toArray not available`);
        }
    } catch (error) {
        console.error(`[${pluginName}] Error extracting code from messages:`, error);
    }

    console.log("[${pluginName}] No code found in channel");
    return null;
}

// Voice Channel Context Menu
const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: VoiceChannelContextProps) => {
    // only for voice and stage channels
    if (channel.type !== 2 && channel.type !== 13) return children;

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            label={pluginName}
            key="voice-tools2"
            id="voice-tools2"
        >
            <Menu.MenuItem
                key="voice-tools-copy-info"
                id="voice-tools-copy-info"
                label="Copy Info"
                action={() => {
                    try {
                        console.log(`[${pluginName}] Starting copy info for channel: ${channel.name}`);

                        let guild;
                        try {
                            guild = GuildStore.getGuild(channel.guild_id);
                        } catch (error) {
                            console.error(`[${pluginName}] Error getting guild:`, error);
                        }

                        let status;
                        try {
                            status = getVoiceChannelStatus(channel.id);
                        } catch (error) {
                            console.error(`[${pluginName}] Error getting status:`, error);
                        }

                        let users = "";
                        try {
                            const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channel.id) as Record<string, any>;
                            users = Object.values(voiceStates || {}).map(state => {
                                const user = UserStore.getUser(state.userId);
                                return user ? `\\@${user.username}` : null;
                            }).filter(Boolean).join(", ");
                        } catch (error) {
                            console.error(`[${pluginName}] Error getting voice states:`, error);
                        }

                        let messageCount = 0;
                        let lastMessage: Message | null = null;
                        try {
                            const messages = MessageStore.getMessages(channel.id);
                            console.log(`[${pluginName}] Raw messages result:`, messages);
                            messageCount = messages && messages.toArray ? messages.toArray().length : 0;
                            lastMessage = messages && messages.toArray ? messages.toArray()[0] : null;
                            console.log(`[${pluginName}] Processed - Count: ${messageCount}, Last message:`, lastMessage);
                        } catch (error) {
                            console.error(`[${pluginName}] Error getting messages:`, error);
                        }

                        let info = `https://discord.com/channels/${channel.guild_id}/${channel.id}`;
                        if (lastMessage)
                            info += `/${lastMessage.id}`;
                        if (guild)
                            info += `\nGuild: \`${guild.name}\``;
                        if (channel?.name)
                            info += `\nName: \`${channel.name}\``;
                        if (channel?.topic)
                            info += `\nTopic: \`${channel.topic}\``;
                        if (status)
                            info += `\nStatus: \`${status}\``;
                        if (users)
                            info += `\nUsers: ${users}`;
                        if (messageCount > 0)
                            info += `\nMessages: ${messageCount}`;

                        console.log(`[${pluginName}] Final info:`, info);
                        copyWithToast(info.trim());
                    } catch (error) {
                        console.error(`[${pluginName}] Critical error in copy info:`, error);
                        showToast("Error copying info", error);
                    }
                }}
            />

            <Menu.MenuItem
                key="voice-tools-copy-code"
                id="voice-tools-copy-code"
                label="Copy Code"
                action={async () => {
                    try {
                        const code = await extractCode(channel);
                        if (code) {
                            copyWithToast(code, `Code ${code} copied to clipboard`);
                        } else {
                            showToast("No code found");
                        }
                    } catch (error) {
                        showToast("Error extracting code", error);
                    }
                }}
            />
        </Menu.MenuItem>
    );

    return children;
};

const settings = definePluginSettings({
    fallbackDict: {
        type: OptionType.BOOLEAN,
        description: "Use fallback dictionary for channel statuses",
        default: true
    },
    codeRegex: {
        type: OptionType.STRING,
        description: "Regex pattern to match codes",
        default: "\\b([a-z0-9]{5}|[A-Z0-9]{5})\\b"
    },
    ignoredWords: {
        type: OptionType.STRING,
        description: "Whitelisted words to ignore in status extraction",
        default: "camos,grind"
    },
    autoExtractServers: {
        type: OptionType.STRING,
        description: "Servers to auto extract codes from when joining a voice channel",
        default: "500074231544152074,687345074627149873"
    }
});

// Auto extract code when joining voice channels in specified servers
async function handleVoiceStateUpdate(voiceState: any) {
    console.log(`[${pluginName}] VOICE_STATE_UPDATE received:`, {
        channelId: voiceState.channelId,
        userId: voiceState.userId,
        currentUserId: UserStore.getCurrentUser().id,
        isCurrentUser: voiceState.userId === UserStore.getCurrentUser().id,
        hasChannelId: !!voiceState.channelId
    });

    try {
        // Only proceed when user is joining a voice channel
        if (!voiceState.channelId) {
            console.log(`[${pluginName}] Skipping - no channelId`);
            return;
        }

        if (voiceState.userId !== UserStore.getCurrentUser().id) {
            console.log(`[${pluginName}] Skipping - not current user`);
            return;
        }

        const channel = ChannelStore.getChannel(voiceState.channelId);
        if (!channel) {
            console.log(`[${pluginName}] Skipping - channel not found: ${voiceState.channelId}`);
            return;
        }

        if (channel.type !== 2 && channel.type !== 13) {
            console.log(`[${pluginName}] Skipping - not voice/stage channel (type: ${channel.type})`);
            return; // Not a voice/stage channel
        }

        // Check if this server is in the auto-extract list
        const autoExtractServers = settings.store.autoExtractServers.split(",").map(id => id.trim()).filter(Boolean);
        const serverInList = autoExtractServers.includes(channel.guild_id);

        console.log(`[${pluginName}] Auto-extract check:`, {
            channelName: channel.name,
            guildId: channel.guild_id,
            autoExtractServers,
            serverInList
        });

        if (!serverInList) {
            console.log(`[${pluginName}] Skipping - server not in auto-extract list`);
            return;
        }

        console.log(`[${pluginName}] ✅ Auto-extracting code for channel ${channel.name} in server ${channel.guild_id}`);

        // Extract and copy the code
        const code = await extractCode(channel);
        if (code) {
            console.log(`[${pluginName}] ✅ Auto-extracted code ${code} - copying to clipboard`);
            copyWithToast(code, `Auto-extracted code ${code} copied to clipboard`);
        } else {
            console.log(`[${pluginName}] ❌ No code found for auto-extraction`);
        }
    } catch (error) {
        console.error(`[${pluginName}] ❌ Error in auto-extract:`, error);
    }
}

// Handle auto-extraction when voice channel status updates
async function handleVoiceChannelStatusUpdate(channelId: string, guildId: string) {
    try {
        // Check if current user is in this voice channel
        const currentVoiceState = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id);
        if (!currentVoiceState || currentVoiceState.channelId !== channelId) {
            console.log(`[${pluginName}] Status update - user not in channel ${channelId}`);
            return;
        }

        const channel = ChannelStore.getChannel(channelId);
        if (!channel) {
            console.log(`[${pluginName}] Status update - channel not found: ${channelId}`);
            return;
        }

        // Check if this server is in the auto-extract list
        const autoExtractServers = settings.store.autoExtractServers.split(",").map(id => id.trim()).filter(Boolean);
        const serverInList = autoExtractServers.includes(guildId);

        console.log(`[${pluginName}] Status update auto-extract check:`, {
            channelName: channel.name,
            guildId: guildId,
            autoExtractServers,
            serverInList,
            userInChannel: currentVoiceState.channelId === channelId
        });

        if (!serverInList) {
            console.log(`[${pluginName}] Status update - server not in auto-extract list`);
            return;
        }

        console.log(`[${pluginName}] ✅ Status update - Auto-extracting code for channel ${channel.name} in server ${guildId}`);

        // Extract and copy the code
        const code = await extractCode(channel);
        if (code) {
            console.log(`[${pluginName}] ✅ Status update - Auto-extracted code ${code} - copying to clipboard`);
            copyWithToast(code, `Auto-extracted code ${code} copied to clipboard`);
        } else {
            console.log(`[${pluginName}] ❌ Status update - No code found for auto-extraction`);
        }
    } catch (error) {
        console.error(`[${pluginName}] ❌ Error in status update auto-extract:`, error);
    }
}

export default definePlugin({
    name: pluginName,
    description: "Voice channel copy utilities (name, status, code)",
    authors: [
        { name: "Bluscream", id: 467777925790564352n },
        { name: "Cursor.AI", id: 0n }],
    contextMenus: {
        "channel-context": VoiceChannelContext
    },
    settings,
    flux: {
        VOICE_CHANNEL_STATUS_UPDATE({
            type,
            id,
            guildId,
            status,
        }: {
            type: string;
            id: string;
            guildId: string;
            status: string;
        }) {
            console.log(`${type};${guildId}/${id};"${status}"`);
            if (settings.store.fallbackDict) {
                statuses[id] = status;
            }
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            console.log(`[${pluginName}] 🎯 VOICE_STATE_UPDATES flux event received:`, voiceStates.length, "states");
            const myId = UserStore.getCurrentUser().id;

            for (const voiceState of voiceStates) {
                if (voiceState.userId === myId) {
                    console.log(`[${pluginName}] 🎯 Processing my voice state update:`, voiceState);
                    handleVoiceStateUpdate(voiceState);
                    break; // Only process our own voice state
                }
            }
        },
        VOICE_STATE_CONNECT(voiceState: any) {
            console.log(`[${pluginName}] 🎤 VOICE_STATE_CONNECT event received:`, voiceState);
            handleVoiceStateUpdate(voiceState);
        },
        VOICE_STATE_DISCONNECT(voiceState: any) {
            console.log(`[${pluginName}] 🎤 VOICE_STATE_DISCONNECT event received:`, voiceState);
        }
    },
    start() {
        console.log(`[${pluginName}] 🚀 Plugin started - auto-extract servers: ${settings.store.autoExtractServers}`);
        console.log(`[${pluginName}] 🎤 Current voice state:`, VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id));
    }
});
