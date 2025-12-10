
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeftOnRectangleIcon, CheckCircleIcon, KeyIcon, UserCircleIcon, CreditCardIcon, PaintBrushIcon,
    CurrencyDollarIcon, WrenchScrewdriverIcon, BoltIcon, GlobeAltIcon, DocumentMagnifyingGlassIcon, SpeakerWaveIcon, CpuChipIcon,
    EyeIcon, EyeSlashIcon, ArrowRightOnRectangleIcon
} from '@heroicons/react/24/solid';
import { useAuth } from '../../contexts/AuthContext';
import { validateApiKey } from '../../services/geminiService';
import { validateOpenRouterKey } from '../../services/openRouterService';
import { MemoryDashboard } from '../settings/MemoryDashboard';
import { BillingSettings } from '../settings/BillingSettings';
import { ModelPreferences } from '../settings/ModelPreferences';
import { useToast } from '../../hooks/useToast';
import { useLocalStorage } from '../../hooks/useLocalStorage';

type SettingsTab = 'profile' | 'account' | 'appearance' | 'memory' | 'apiKeys' | 'billing' | 'models' | 'audio';

const FALLBACK_AVATAR_SVG = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23334155'/%3E%3Cpath d='M50 42 C61.046 42 70 50.954 70 62 L30 62 C30 50.954 38.954 42 50 42 Z' fill='white'/%3E%3Ccircle cx='50' cy='30' r='10' fill='white'/%3E%3C/svg%3E`;

const Section: React.FC<{ title: string; children: React.ReactNode; description?: string }> = ({ title, children, description }) => (
    <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-text-primary">{title}</h2>
        <div className="w-24 border-b-2 border-primary-start mt-4 mb-8"></div>
        {description && <p className="text-lg text-text-secondary mb-8">{description}</p>}
        <div className="space-y-8">{children}</div>
    </div>
);

const SectionCard: React.FC<{children: React.ReactNode, className?: string}> = ({children, className=""}) => (
    <div className={`p-8 bg-bg-secondary/50 rounded-2xl border border-border-color shadow-lg ${className}`}>{children}</div>
);

const ApiKeyInput: React.FC<{
    label: string;
    icon: React.ReactNode;
    value: string;
    placeholder: string;
    onSave: (key: string) => Promise<void>;
    required?: boolean;
    description?: string;
    validate?: (key: string) => Promise<{ success: boolean; message?: string }>;
}> = ({ label, icon, value, placeholder, onSave, required = false, description, validate }) => {
    const [inputValue, setInputValue] = useState('');
    const [isVisible, setIsVisible] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // If a value exists, mask it initially
    const displayValue = inputValue || (value ? (isVisible ? value : 'sk-....' + value.slice(-4)) : '');

    const handleSave = async () => {
        if (!inputValue.trim()) return;
        setIsSaving(true);
        setError(null);
        setSuccess(false);

        try {
            if (validate) {
                const result = await validate(inputValue);
                if (!result.success) throw new Error(result.message);
            }
            await onSave(inputValue);
            setSuccess(true);
            setInputValue(''); // Clear local input after save
            setTimeout(() => setSuccess(false), 3000);
        } catch (err: any) {
            setError(err.message || "Failed to save API key.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="p-6 bg-black/20 border border-white/5 rounded-xl hover:border-white/10 transition-colors">
            <div className="flex items-start gap-4 mb-4">
                <div className="p-3 bg-bg-tertiary rounded-lg text-white">
                    {icon}
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h4 className="text-lg font-bold text-white">{label}</h4>
                        {required && <span className="text-xs bg-bg-tertiary text-gray-400 px-2 py-0.5 rounded">Required</span>}
                        {!required && <span className="text-xs bg-bg-tertiary text-gray-500 px-2 py-0.5 rounded">Optional</span>}
                    </div>
                    {value ? (
                        <p className="text-sm font-mono text-gray-400 mt-1">{value.slice(0, 8)}...{value.slice(-4)}</p>
                    ) : (
                        <p className="text-sm text-gray-500 mt-1 italic">Not Set</p>
                    )}
                </div>
                <button 
                    onClick={() => navigator.clipboard.writeText(value)}
                    disabled={!value}
                    className="text-xs font-semibold bg-white/5 hover:bg-white/10 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                >
                    Copy
                </button>
                <button 
                    onClick={() => setIsVisible(!isVisible)}
                    disabled={!value}
                    className="text-xs font-semibold bg-white/5 hover:bg-white/10 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                >
                    {isVisible ? 'Hide' : 'Show'}
                </button>
            </div>
            
            <div className="space-y-2">
                <label className="text-sm text-gray-400">Update {label.split(' ')[0]} Key</label>
                <div className="flex gap-2">
                    <input 
                        type={isVisible ? "text" : "password"}
                        value={inputValue}
                        onChange={(e) => { setInputValue(e.target.value); setError(null); }}
                        placeholder={placeholder}
                        className="flex-1 bg-bg-primary border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-primary-start placeholder-gray-600 transition-all"
                    />
                    <button 
                        onClick={handleSave}
                        disabled={isSaving || !inputValue}
                        className="px-6 py-2.5 bg-primary-start text-white font-semibold rounded-lg hover:bg-primary-start/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : 'Save'}
                    </button>
                </div>
                {error && <p className="text-red-400 text-sm mt-2 flex items-center gap-1"><span className="text-lg">×</span> {error}</p>}
                {success && <p className="text-green-400 text-sm mt-2 flex items-center gap-1"><CheckCircleIcon className="w-4 h-4"/> Saved successfully</p>}
                {description && <p className="text-xs text-gray-500 mt-2">{description}</p>}
            </div>
        </div>
    );
}

const ApiKeysContent: React.FC = () => {
    const { geminiApiKey, openRouterApiKey, tavilyApiKey, scrapingAntApiKey, saveGeminiApiKey, saveOpenRouterApiKey, saveTavilyApiKey, saveScrapingAntApiKey } = useAuth();

    return (
        <Section title="API Keys" description="Manage your API keys for AI and Search services.">
            <div className="space-y-6">
                <ApiKeyInput 
                    label="Google Gemini API Key" 
                    icon={<KeyIcon className="w-6 h-6 text-yellow-400" />}
                    value={geminiApiKey || ''}
                    placeholder="Enter new Gemini API key"
                    onSave={saveGeminiApiKey}
                    required
                    validate={validateApiKey}
                    description="Used for all core chat and reasoning tasks."
                />
                
                <ApiKeyInput 
                    label="OpenRouter API Key" 
                    icon={<BoltIcon className="w-6 h-6 text-purple-400" />}
                    value={openRouterApiKey || ''}
                    placeholder="Enter new OpenRouter API key"
                    onSave={saveOpenRouterApiKey}
                    validate={validateOpenRouterKey}
                    description="Access generic models like Claude, Llama, and Mistral."
                />

                <ApiKeyInput 
                    label="Tavily API Key" 
                    icon={<GlobeAltIcon className="w-6 h-6 text-blue-400" />}
                    value={tavilyApiKey || ''}
                    placeholder="Enter new Tavily API key"
                    onSave={saveTavilyApiKey}
                    description="Enables high-quality real-time web search and grounding."
                />

                <ApiKeyInput 
                    label="ScrapingAnt API Key" 
                    icon={<DocumentMagnifyingGlassIcon className="w-6 h-6 text-orange-400" />}
                    value={scrapingAntApiKey || ''}
                    placeholder="Enter new ScrapingAnt API key"
                    onSave={saveScrapingAntApiKey}
                    description="Powers deep research scraping capabilities."
                />
            </div>
        </Section>
    );
};

const AccountSettingsContent: React.FC = () => {
    const { user, profile, signOut, linkGoogleAccount, updateUserPassword, isGuest } = useAuth();
    const { addToast } = useToast();
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [isLinking, setIsLinking] = useState(false);

    // Determine current auth methods
    const identities = user?.identities || [];
    const hasGoogle = identities.some(i => i.provider === 'google');
    const hasEmail = identities.some(i => i.provider === 'email' || i.provider === 'identity'); // 'identity' is sometimes used for email/pass

    // NOTE: In Supabase, if a user signs in with Google, they have 'google' provider.
    // If they want to "Link Email", it effectively means adding a password to the account.
    // We detect "Email Linked" if they have an email provider identity OR if they are Google-only (we can prompt to add password).
    // Actually, checking if they have a 'password' is hard via client API directly without trying to update it.
    // Simplifying assumption: If provider is 'email', they have password. If 'google' only, they don't.

    const handleLinkGoogle = async () => {
        setIsLinking(true);
        try {
            await linkGoogleAccount();
        } catch (e: any) {
            if (e.message?.includes("already has been used")) {
                addToast("This Google account is already linked to another user. Please log in with it directly.", "error");
            } else {
                addToast(`Error linking Google: ${e.message}`, "error");
            }
        } finally {
            setIsLinking(false);
        }
    };

    const handleSetPassword = async () => {
        if (!newPassword || newPassword.length < 6) {
            addToast("Password must be at least 6 characters.", "error");
            return;
        }
        setIsLinking(true);
        try {
            await updateUserPassword(newPassword);
            setIsPasswordModalOpen(false);
            setNewPassword('');
        } catch (e: any) {
            addToast(`Error setting password: ${e.message}`, "error");
        } finally {
            setIsLinking(false);
        }
    };

    return (
        <Section title="Account" description="Manage your linked accounts and session information.">
            <SectionCard className="mb-8">
                <h3 className="text-xl font-bold text-white mb-6">Linked Accounts</h3>
                <div className="space-y-2">
                    
                    {/* Email Row */}
                    <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-gray-700 rounded-full">
                                <UserCircleIcon className="w-6 h-6 text-gray-300" />
                            </div>
                            <span className="font-semibold text-white">Email & Password</span>
                        </div>
                        {hasEmail ? (
                            <span className="px-3 py-1 bg-green-500/10 text-green-400 text-sm font-bold rounded-lg border border-green-500/20">
                                Primary
                            </span>
                        ) : (
                            <button 
                                onClick={() => setIsPasswordModalOpen(true)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold rounded-lg transition-colors border border-white/10"
                            >
                                Create Password
                            </button>
                        )}
                    </div>

                    {/* Google Row */}
                    <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-white rounded-full">
                                <svg className="w-6 h-6" viewBox="0 0 48 48">
                                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C43.021,36.251,44,30.686,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                </svg>
                            </div>
                            <span className="font-semibold text-white">Google</span>
                        </div>
                        {hasGoogle ? (
                            <span className="px-3 py-1 bg-green-500/10 text-green-400 text-sm font-bold rounded-lg border border-green-500/20">
                                Linked
                            </span>
                        ) : (
                            <button 
                                onClick={handleLinkGoogle}
                                disabled={isLinking}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold rounded-lg transition-colors border border-white/10"
                            >
                                {isLinking ? 'Linking...' : 'Link Account'}
                            </button>
                        )}
                    </div>

                    {/* Roblox Row */}
                    <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5 opacity-60">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-black rounded-full border border-white/10">
                                {/* Simple Roblox-like shape */}
                                <div className="w-6 h-6 border-4 border-white/80 rounded-sm transform rotate-12"></div>
                            </div>
                            <span className="font-semibold text-white">Roblox</span>
                        </div>
                        <span className="px-3 py-1 bg-blue-500/10 text-blue-400 text-sm font-bold rounded-lg border border-blue-500/20">
                            SOON
                        </span>
                    </div>
                </div>
            </SectionCard>

            <SectionCard>
                <h3 className="text-lg font-bold text-white mb-2">Logout</h3>
                <p className="text-gray-400 mb-6 text-sm">This will log you out of your account on this browser.</p>
                <button 
                    onClick={signOut}
                    className="flex items-center gap-2 px-6 py-3 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg font-bold transition-colors border border-red-500/20"
                >
                    <ArrowRightOnRectangleIcon className="w-5 h-5" /> Logout
                </button>
            </SectionCard>

            {/* Password Modal */}
            <AnimatePresence>
                {isPasswordModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-bg-secondary border border-white/10 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
                        >
                            <h3 className="text-xl font-bold text-white mb-4">Set Password</h3>
                            <p className="text-gray-400 text-sm mb-4">Enter a password to enable email login for this account.</p>
                            <input 
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="New Password"
                                className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-lg text-white mb-4 focus:ring-1 focus:ring-primary-start focus:outline-none"
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsPasswordModalOpen(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                                <button 
                                    onClick={handleSetPassword}
                                    disabled={isLinking || !newPassword}
                                    className="px-4 py-2 bg-primary-start text-white rounded-lg font-semibold hover:bg-primary-start/80 disabled:opacity-50"
                                >
                                    {isLinking ? 'Saving...' : 'Set Password'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </Section>
    );
};

const AudioSettingsContent: React.FC = () => {
    const { addToast } = useToast();
    const [ttsVoice, setTtsVoice] = useLocalStorage('bubble_tts_voice', 'Puck');
    const [ttsSpeed, setTtsSpeed] = useLocalStorage('bubble_tts_speed', 1);
    
    const VOICES = [
        { id: 'Puck', name: 'Puck (Energetic)', desc: 'Great for lively conversation.' },
        { id: 'Charon', name: 'Charon (Deep)', desc: 'Authoritative and calm.' },
        { id: 'Kore', name: 'Kore (Balanced)', desc: 'Natural and friendly.' },
        { id: 'Fenrir', name: 'Fenrir (Strong)', desc: 'Clear and distinct.' },
        { id: 'Aoede', name: 'Aoede (Soft)', desc: 'Gentle and soothing.' },
    ];

    const handleSave = () => {
        addToast("Audio settings saved!", "success");
    }

    return (
        <Section title="Voice & Audio" description="Customize how Bubble sounds when using Text-to-Speech or Live Mode.">
            <SectionCard>
                <h3 className="text-xl font-bold text-white mb-6">Text-to-Speech Voice</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {VOICES.map(voice => (
                        <button
                            key={voice.id}
                            onClick={() => { setTtsVoice(voice.id); handleSave(); }}
                            className={`p-4 rounded-xl border text-left transition-all ${ttsVoice === voice.id ? 'bg-primary-start/10 border-primary-start ring-1 ring-primary-start' : 'bg-black/20 border-white/10 hover:border-white/30'}`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-white">{voice.name}</span>
                                {ttsVoice === voice.id && <CheckCircleIcon className="w-5 h-5 text-primary-start" />}
                            </div>
                            <p className="text-sm text-gray-400">{voice.desc}</p>
                        </button>
                    ))}
                </div>
            </SectionCard>
            
            <SectionCard>
                <h3 className="text-xl font-bold text-white mb-6">Speaking Rate</h3>
                <div className="space-y-4">
                    <div className="flex justify-between text-sm text-gray-400">
                        <span>Slow</span>
                        <span>Normal</span>
                        <span>Fast</span>
                    </div>
                    <input 
                        type="range" 
                        min="0.5" 
                        max="2" 
                        step="0.1" 
                        value={ttsSpeed} 
                        onChange={(e) => { setTtsSpeed(parseFloat(e.target.value)); }}
                        onMouseUp={handleSave}
                        onTouchEnd={handleSave}
                        className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-primary-start"
                    />
                    <p className="text-center text-white font-mono">{ttsSpeed}x</p>
                </div>
            </SectionCard>
        </Section>
    );
};

const ProfileContent: React.FC = () => {
    const { profile, updateUserProfile, isGuest } = useAuth();
    const [displayName, setDisplayName] = useState('');
    
    useEffect(() => { if (profile) setDisplayName(profile.roblox_username || ''); }, [profile]);

    const handleSave = async () => {
        if (!displayName.trim() || isGuest) return;
        await updateUserProfile({ roblox_username: displayName.trim() });
    };
    
    return (
        <Section title="Public Profile">
             <SectionCard>
                <div className="space-y-6">
                    <div>
                        <label className="block text-lg font-medium text-text-secondary mb-2">Display Name</label>
                        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={isGuest} className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-lg text-white focus:ring-2 focus:ring-primary-start" />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handleSave} disabled={isGuest} className="px-6 py-3 bg-primary-start text-white rounded-xl font-bold hover:bg-primary-start/80 transition-colors disabled:opacity-50">Save Changes</button>
                    </div>
                </div>
            </SectionCard>
        </Section>
    )
}

export const SettingsPage: React.FC<{onBack: () => void}> = ({ onBack }) => {
    const { profile, isGuest } = useAuth();
    const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

    // UNHIDE API KEYS AND APPEARANCE FOR GUESTS
    const navItems = [
        { id: 'profile', label: 'Public Profile', icon: UserCircleIcon },
        { id: 'account', label: 'Account', icon: CreditCardIcon, hidden: isGuest },
        { id: 'billing', label: 'Billing & Usage', icon: CurrencyDollarIcon, hidden: isGuest },
        { id: 'models', label: 'Model Preferences', icon: WrenchScrewdriverIcon },
        { id: 'audio', label: 'Voice & Audio', icon: SpeakerWaveIcon },
        { id: 'apiKeys', label: 'API Keys', icon: KeyIcon },
        { id: 'memory', label: 'Memory', icon: CpuChipIcon },
        { id: 'appearance', label: 'Appearance', icon: PaintBrushIcon },
    ].filter(item => !item.hidden) as any;

    const renderContent = () => {
        switch(activeTab) {
            case 'profile': return <ProfileContent />;
            case 'account': return <AccountSettingsContent />;
            case 'billing': return <BillingSettings />;
            case 'models': return <ModelPreferences />;
            case 'audio': return <AudioSettingsContent />;
            case 'apiKeys': return <ApiKeysContent />;
            case 'memory': return <MemoryDashboard />;
            case 'appearance': return (
                <Section title="Appearance">
                    <SectionCard>
                        <p className="text-gray-400">Dark mode is currently enforced for the best experience.</p>
                    </SectionCard>
                </Section>
            );
            default: return null;
        }
    }

    return (
        <div className="flex h-[calc(100vh-4rem)] bg-bg-primary">
            <aside className="w-80 flex-shrink-0 p-6 border-r border-border-color overflow-y-auto bg-bg-secondary">
                <div className="flex items-center gap-4 mb-10 px-2">
                    <img src={profile?.avatar_url || FALLBACK_AVATAR_SVG} alt="Avatar" className="w-16 h-16 rounded-full bg-bg-tertiary" />
                    <div className="min-w-0">
                        <p className="font-bold text-xl text-text-primary truncate">{profile?.roblox_username}</p>
                        <p className="text-sm text-text-secondary">{isGuest ? 'Guest Account' : 'Personal Account'}</p>
                    </div>
                </div>
                <nav className="space-y-2">
                    {navItems.map((item: any) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full flex items-center gap-4 px-4 py-4 text-base font-medium rounded-xl transition-all text-left ${
                                activeTab === item.id ? 'bg-primary-start text-white shadow-lg' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                            }`}
                        >
                            <item.icon className={`w-6 h-6 ${activeTab === item.id ? 'text-white' : 'text-gray-500'}`} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
            </aside>
            <main className="flex-1 p-12 overflow-y-auto bg-bg-primary">
                 <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="h-full"
                    >
                       {renderContent()}
                    </motion.div>
                </AnimatePresence>
            </main>
        </div>
    );
};
