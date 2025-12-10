
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlobeAltIcon, ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface SearchStatusProps {
    isSearching: boolean; // Not used in this new implementation for the button alone, but kept for interface compat
    query?: string | string[] | null;
    sources?: Array<{ web: { uri: string; title: string } }>;
}

const getFaviconUrl = (url: string) => {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return '';
    }
};

const getDomain = (url: string) => {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return url;
    }
};

export const SearchStatus: React.FC<SearchStatusProps> = ({ sources, query }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Deduplicate sources based on URL safely
    const uniqueSources = (sources || []).filter((v, i, a) => 
        a.findIndex(t => (t.web?.uri === v.web?.uri)) === i
    );

    // If query exists (search happened) but no sources, show "0 Sources" instead of hiding
    if (!sources && !query) return null;
    
    return (
        <div className="relative">
            <button 
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
                title="View Sources"
            >
                <GlobeAltIcon className="w-4 h-4 text-primary-start" />
                <span>{uniqueSources.length} {uniqueSources.length === 1 ? 'Source' : 'Sources'}</span>
            </button>

            <AnimatePresence>
                {isExpanded && (
                    <>
                        <div className="fixed inset-0 z-20" onClick={() => setIsExpanded(false)} />
                        <motion.div 
                            initial={{ opacity: 0, y: 5, scale: 0.95 }} 
                            animate={{ opacity: 1, y: 0, scale: 1 }} 
                            exit={{ opacity: 0, y: 5, scale: 0.95 }}
                            className="absolute left-0 bottom-full mb-2 w-64 bg-bg-tertiary border border-border-color rounded-lg shadow-xl z-30 p-2 overflow-hidden"
                        >
                            <div className="flex items-center justify-between px-2 pb-2 border-b border-white/5 mb-1">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Citations</span>
                                <span className="text-xs text-primary-start">{uniqueSources.length} found</span>
                            </div>
                            {uniqueSources.length > 0 ? (
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                    {uniqueSources.map((source, idx) => (
                                        <a
                                            key={idx}
                                            href={source.web.uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-md group transition-colors"
                                        >
                                            <img 
                                                src={getFaviconUrl(source.web.uri)} 
                                                alt="" 
                                                className="w-3.5 h-3.5 rounded-sm opacity-70 group-hover:opacity-100"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs text-gray-300 truncate group-hover:text-white">{source.web.title || "Web Result"}</p>
                                                <p className="text-[10px] text-gray-500 truncate">{getDomain(source.web.uri)}</p>
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-3 text-center text-xs text-gray-500">
                                    No sources returned for this search.
                                </div>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
