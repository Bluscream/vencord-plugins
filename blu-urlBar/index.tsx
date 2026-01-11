/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Windsurf and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, React, useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

const NavigationStore = findStoreLazy("NavigationStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const GuildStore = findStoreLazy("GuildStore");

interface NavHistory {
    url: string;
    title: string;
    timestamp: number;
}

const settings = definePluginSettings({
    position: {
        type: OptionType.SELECT,
        description: "Position of the navigation bar",
        options: [
            { label: "Top", value: "top", default: true },
            { label: "Bottom", value: "bottom" },
            { label: "Floating", value: "floating" }
        ]
    },
    showHistory: {
        type: OptionType.BOOLEAN,
        description: "Show navigation history buttons",
        default: true
    },
    showRefresh: {
        type: OptionType.BOOLEAN,
        description: "Show refresh button",
        default: true
    },
    showHome: {
        type: OptionType.BOOLEAN,
        description: "Show home button",
        default: true
    },
    maxHeight: {
        type: OptionType.SLIDER,
        description: "Maximum height of the navigation bar",
        default: 40,
        markers: [30, 40, 50, 60]
    }
});

export default definePlugin({
    name: "URL Bar",
    description: "Adds a full navigation bar to Discord with URL input, history, and navigation controls",
    authors: [
        { name: "Windsurf", id: 0n },
        { name: "Bluscream", id: 467777925790564352n }
    ],
    settings,

    render() {
        return <URLBar />;
    }
});

function URLBar() {
    const [currentUrl, setCurrentUrl] = useState("");
    const [history, setHistory] = useState<NavHistory[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initialize current URL
    useEffect(() => {
        updateCurrentUrl();

        // Listen for navigation changes
        const handleNavigation = () => {
            updateCurrentUrl();
        };

        // Subscribe to Discord navigation events
        FluxDispatcher.subscribe("TRANSITION_START", handleNavigation);
        FluxDispatcher.subscribe("CHANNEL_SELECT", handleNavigation);
        FluxDispatcher.subscribe("GUILD_SELECT", handleNavigation);

        return () => {
            FluxDispatcher.unsubscribe("TRANSITION_START", handleNavigation);
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleNavigation);
            FluxDispatcher.unsubscribe("GUILD_SELECT", handleNavigation);
        };
    }, []);

    const updateCurrentUrl = () => {
        const url = getCurrentDiscordUrl();
        setCurrentUrl(url);

        // Add to history if different from last
        if (history.length === 0 || history[history.length - 1]?.url !== url) {
            const newHistory = [...history.slice(-49), { url, title: getPageTitle(url), timestamp: Date.now() }];
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
        }
    };

    const getCurrentDiscordUrl = () => {
        try {
            const { getGuildId, getVoiceChannelId, getChannelId } = SelectedChannelStore;
            const guildId = getGuildId();
            const channelId = getVoiceChannelId() || getChannelId();

            if (channelId) {
                const guild = GuildStore.getGuild(guildId);
                const channel = SelectedChannelStore.getChannel(channelId);

                if (guild && channel) {
                    return `https://discord.com/channels/${guildId}/${channelId}`;
                }
            }

            if (guildId) {
                return `https://discord.com/channels/${guildId}`;
            }

            return "https://discord.com/@me";
        } catch (error) {
            return "https://discord.com";
        }
    };

    const getPageTitle = (url: string) => {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split("/").filter(Boolean);

            if (pathParts[0] === "channels") {
                const guildId = pathParts[1];
                const channelId = pathParts[2];

                if (guildId && channelId) {
                    const guild = GuildStore.getGuild(guildId);
                    const channel = SelectedChannelStore.getChannel(channelId);
                    return `${guild?.name || "Unknown Server"} - ${channel?.name || "Unknown Channel"}`;
                } else if (guildId) {
                    const guild = GuildStore.getGuild(guildId);
                    return guild?.name || "Unknown Server";
                }
            }

            if (pathParts[0] === "@me") {
                return "Direct Messages";
            }

            return "Discord";
        } catch (error) {
            return "Discord";
        }
    };

    const navigateToUrl = (url: string) => {
        try {
            const urlObj = new URL(url);

            if (urlObj.hostname === "discord.com") {
                const pathParts = urlObj.pathname.split("/").filter(Boolean);

                if (pathParts[0] === "channels") {
                    const guildId = pathParts[1];
                    const channelId = pathParts[2];

                    if (guildId && channelId) {
                        FluxDispatcher.dispatch({
                            type: "CHANNEL_SELECT",
                            guildId,
                            channelId
                        });
                    } else if (guildId) {
                        FluxDispatcher.dispatch({
                            type: "GUILD_SELECT",
                            guildId
                        });
                    }
                } else if (pathParts[0] === "@me") {
                    FluxDispatcher.dispatch({
                        type: "CHANNEL_SELECT",
                        guildId: null
                    });
                }

                setCurrentUrl(url);
                setShowSuggestions(false);
            } else {
                window.open(url, "_blank");
            }
        } catch (error) {
            console.error("Invalid URL:", url);
        }
    };

    const goBack = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            navigateToUrl(history[newIndex].url);
        }
    };

    const goForward = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            navigateToUrl(history[newIndex].url);
        }
    };

    const refresh = () => {
        // Force refresh current view
        window.location.reload();
    };

    const goHome = () => {
        navigateToUrl("https://discord.com/@me");
    };

    const handleInputChange = value => {
        setCurrentUrl(value);

        // Generate suggestions
        if (value.length > 0) {
            const filteredHistory = history
                .filter(item => item.url.toLowerCase().includes(value.toLowerCase()) ||
                               item.title.toLowerCase().includes(value.toLowerCase()))
                .slice(0, 5)
                .map(item => item.url);

            const commonUrls = [
                "https://discord.com/@me",
                "https://discord.com/channels",
                "https://discord.com/settings",
                "https://discord.com/invite"
            ].filter(url => url.toLowerCase().includes(value.toLowerCase()));

            setSuggestions([...new Set([...filteredHistory, ...commonUrls])]);
            setShowSuggestions(true);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
        }
    };

    const handleInputKeyDown = e => {
        if (e.key === "Enter") {
            navigateToUrl(currentUrl);
        } else if (e.key === "Escape") {
            setShowSuggestions(false);
        }
    };

    const { position } = settings.store;
    const { maxHeight } = settings.store;

    const barStyle: React.CSSProperties = {
        position: position === "floating" ? "fixed" : "relative",
        top: position === "top" || position === "floating" ? "0" : "auto",
        bottom: position === "bottom" ? "0" : "auto",
        left: position === "floating" ? "50%" : "0",
        transform: position === "floating" ? "translateX(-50%)" : "none",
        width: position === "floating" ? "600px" : "100%",
        height: `${maxHeight}px`,
        backgroundColor: "#2f3136",
        borderBottom: position === "top" ? "1px solid #202225" : "none",
        borderTop: position === "bottom" ? "1px solid #202225" : "none",
        border: position === "floating" ? "1px solid #202225" : "none",
        borderRadius: position === "floating" ? "8px" : "0",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: "8px"
    };

    return (
        <div style={barStyle}>
            {/* Navigation Buttons */}
            {settings.store.showHistory && (
                <>
                    <NavButton onClick={goBack} disabled={historyIndex <= 0} title="Back">
                        ←
                    </NavButton>
                    <NavButton onClick={goForward} disabled={historyIndex >= history.length - 1} title="Forward">
                        →
                    </NavButton>
                </>
            )}

            {settings.store.showRefresh && (
                <NavButton onClick={refresh} title="Refresh">
                    ↻
                </NavButton>
            )}

            {settings.store.showHome && (
                <NavButton onClick={goHome} title="Home">
                    🏠
                </NavButton>
            )}

            {/* URL Input */}
            <div style={{ flex: 1, position: "relative" }}>
                <input
                    ref={inputRef}
                    type="text"
                    value={currentUrl}
                onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onFocus={() => setShowSuggestions(suggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="Enter URL or search..."
                    style={{
                        width: "100%",
                        height: `${maxHeight - 8}px`,
                        backgroundColor: "#40444b",
                        border: "1px solid #202225",
                        borderRadius: "4px",
                        color: "#dcddde",
                        padding: "0 12px",
                        fontSize: "14px",
                        outline: "none"
                    }}
                />

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div style={{
                        position: "absolute",
                        top: "100%",
                        left: "0",
                        right: "0",
                        backgroundColor: "#2f3136",
                        border: "1px solid #202225",
                        borderTop: "none",
                        borderRadius: "0 0 4px 4px",
                        maxHeight: "200px",
                        overflowY: "auto",
                        zIndex: 1001
                    }}>
                        {suggestions.map((suggestion, index) => (
                            <div
                                key={index}
                                onClick={() => {
                                    setCurrentUrl(suggestion);
                                    navigateToUrl(suggestion);
                                }}
                                style={{
                                    padding: "8px 12px",
                                    cursor: "pointer",
                                    borderBottom: index < suggestions.length - 1 ? "1px solid #40444b" : "none",
                                    fontSize: "14px"
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#40444b"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                            >
                                {suggestion}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function NavButton({ onClick, disabled, title, children }: {
    onClick: () => void;
    disabled?: boolean;
    title: string;
    children: ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                backgroundColor: disabled ? "#202225" : "#40444b",
                border: "1px solid #202225",
                borderRadius: "4px",
                color: disabled ? "#72767d" : "#dcddde",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: "16px",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color 0.2s"
            }}
            onMouseEnter={e => !disabled && (e.currentTarget.style.backgroundColor = "#4f545c")}
            onMouseLeave={e => !disabled && (e.currentTarget.style.backgroundColor = "#40444b")}
        >
            {children}
        </button>
    );
}
