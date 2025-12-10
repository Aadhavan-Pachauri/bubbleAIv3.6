
import { GoogleGenAI } from "@google/genai";
import { AgentInput, AgentExecutionResult } from '../types';
import { getUserFriendlyError } from '../errorUtils';
import { generateImage } from '../../services/geminiService';
import { incrementThinkingCount } from '../../services/databaseService';
import { researchService } from "../../services/researchService";
import { BubbleSemanticRouter, RouterAction } from "../../services/semanticRouter";
import { Memory5Layer } from "../../services/memoryService";
import { autonomousInstruction } from './instructions';
import { runCanvasAgent } from "../canvas/handler";
import { generateFreeCompletion } from "../../services/freeLlmService";
import { 
    shouldUseExternalSearch, 
    runMcpWebSearch, 
    fetchContentsForResults,
    WebSearchResult 
} from "../../services/externalSearchService";

const formatTimestamp = () => {
    return new Date().toLocaleString(undefined, { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' 
    });
};

const isGoogleModel = (model: string) => {
    if (!model) return true; 
    const lower = model.toLowerCase();
    return lower.startsWith('gemini') || lower.startsWith('veo') || lower.includes('google');
};

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
};

const readTextFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};

const generateContentStreamWithRetry = async (
    ai: GoogleGenAI, 
    params: any, 
    retries = 3,
    onRetry?: (msg: string) => void
) => {
    if (!params.model) {
        console.warn("Model undefined in generateContent call, defaulting to gemini-2.5-flash");
        params.model = 'gemini-2.5-flash';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await ai.models.generateContentStream(params);
        } catch (error: any) {
            if (error.status === 404 || error.status === 400 || (error.message && (error.message.includes('404') || error.message.includes('not found') || error.message.includes('Requested entity was not found')))) {
                console.warn(`Model ${params.model} not found or invalid. Falling back to gemini-2.5-flash.`);
                if (onRetry) onRetry(`(Model ${params.model} unavailable. Falling back to Gemini 2.5 Flash...)`);
                
                if (params.model === 'gemini-2.5-flash') {
                     throw error;
                }

                params.model = 'gemini-2.5-flash';
                continue; 
            }

            const isQuotaError = error.status === 429 || 
                                 (error.message && error.message.includes('429')) ||
                                 (error.message && error.message.includes('quota'));
            
            if (isQuotaError && attempt < retries) {
                const delay = Math.pow(2, attempt) * 2000 + 1000; 
                console.warn(`Quota limit hit. Retrying in ${delay}ms...`);
                if (onRetry) onRetry(`(Rate limit hit. Retrying in ${Math.round(delay/1000)}s...)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error("Max retries exceeded");
};

const generateOpenRouterStream = async (
    apiKey: string,
    model: string,
    messages: any[],
    onChunk: (text: string) => void,
    signal?: AbortSignal
) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Bubble AI"
        },
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            temperature: 0.7,
        }),
        signal
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter Error ${response.status}: ${errText}`);
    }

    if (!response.body) throw new Error("No response body from OpenRouter");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
                const dataStr = trimmed.slice(6);
                if (dataStr === "[DONE]") return;
                try {
                    const json = JSON.parse(dataStr);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) onChunk(content);
                } catch (e) {
                    console.warn("Error parsing OpenRouter stream chunk", e);
                }
            }
        }
    }
};

export const runAutonomousAgent = async (input: AgentInput): Promise<AgentExecutionResult> => {
    let { prompt, files, apiKey, project, chat, history, supabase, user, profile, onStreamChunk, model, thinkingMode, signal } = input;
    
    if (thinkingMode === 'instant') {
        try {
            const historyWithoutLast = history.length > 0 && history[history.length - 1].sender === 'user' ? history.slice(0, -1) : history;
            const messages = historyWithoutLast.map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text
            }));
            
            let fileContext = "";
            let imageNote = "";

            if (files && files.length > 0) {
                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        imageNote += `\n[User attached image: "${file.name}"]`;
                    } else if (file.type.startsWith('text/') || file.name.match(/\.(js|ts|tsx|jsx|json|md|html|css|py|lua)$/)) {
                        try {
                            const content = await readTextFile(file);
                            fileContext += `\n\n--- FILE: ${file.name} ---\n${content}\n--- END FILE ---\n`;
                        } catch (e) {
                            fileContext += `\n[Error reading file: ${file.name}]`;
                        }
                    }
                }
            }

            const finalPrompt = `${prompt}${imageNote}${fileContext}`;
            messages.push({ role: 'user', content: finalPrompt });

            const finalResponseText = await generateFreeCompletion(messages, onStreamChunk, signal);
            return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText }] };
        } catch (e) {
            console.error("Instant mode failed", e);
            throw new Error("Instant mode service unavailable.");
        }
    }

    if (!model || model.trim() === '') {
        model = 'gemini-2.5-flash';
    }

    let isNative = isGoogleModel(model);
    const openRouterKey = profile?.openrouter_api_key;

    if (!isNative && !openRouterKey) {
         onStreamChunk?.("\n*(OpenRouter key missing, falling back to Gemini...)*\n");
         model = 'gemini-2.5-flash';
         isNative = true;
    }

    let thinkingBudget = 0;
    
    if (thinkingMode === 'deep') {
        const preferredDeep = profile?.preferred_deep_model;
        model = preferredDeep || 'gemini-3-pro-preview';
        thinkingBudget = 8192; 
        isNative = isGoogleModel(model); 
    } else if (thinkingMode === 'think') {
        model = 'gemini-2.5-flash';
        thinkingBudget = 2048; 
        isNative = true;
    }

    if (thinkingBudget > 0 && isNative && !model.includes('gemini-2.5') && !model.includes('gemini-3')) {
        onStreamChunk?.(`\n*(Switched to Gemini 2.5 Flash for Thinking mode compatibility)*\n`);
        model = 'gemini-2.5-flash';
    }

    let finalResponseText = '';

    try {
        const modelSupportsSearch = isNative || model.includes('perplexity');
        
        const ai = new GoogleGenAI({ apiKey }); 
        const router = new BubbleSemanticRouter(supabase);
        const memory = new Memory5Layer(supabase, user.id);

        const fileCount = files ? files.length : 0;
        let routing = await router.route(prompt, user.id, apiKey, fileCount);
        
        let externalSearchContext = "";
        let externalMetadata: any[] = [];
        
        if (shouldUseExternalSearch(prompt, modelSupportsSearch, false)) {
            const searchTag = `<SEARCH>${prompt}</SEARCH>`;
            onStreamChunk?.(searchTag);
            finalResponseText += searchTag; // Prepend tag to final text for UI state logic
            
            try {
                const searchResults = await runMcpWebSearch(prompt, 15);
                if (searchResults.length > 0) {
                    const pages = await fetchContentsForResults(searchResults, 15);
                    
                    externalMetadata = pages.map(p => ({ 
                        web: { uri: p.url, title: p.title } 
                    }));

                    externalSearchContext = `
=== EXTERNAL WEB SEARCH RESULTS (JINA READER) ===
Query: "${prompt}"
${pages.map((p, i) => `
--- RESULT ${i+1} ---
Title: ${p.title}
URL: ${p.url}
Content: ${p.content || p.snippet || '(No content available)'}
`).join('\n')}
=================================================
`;
                }
            } catch (err) {
                console.warn("External search failed gracefully:", err);
            }
        }

        const memoryContext = await memory.getContext([
            'inner_personal', 'outer_personal', 'personal', 
            'interests', 'preferences', 'custom', 
            'codebase', 'aesthetic', 'project'
        ]);
        const dateTimeContext = `[CURRENT DATE & TIME]\n${formatTimestamp()}\n`;
        
        const rawModelName = model.split('/').pop() || model;
        const friendlyModelName = rawModelName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            
        let modelIdentityBlock = `You are currently running on the model: **${friendlyModelName}**.\nIf the user asks "Which AI model are you?", reply that you are Bubble, running on ${friendlyModelName}.`;
        
        if (thinkingBudget > 0) {
            modelIdentityBlock += `\n\n[THINKING ENABLED]\nBudget: ${thinkingBudget} tokens. MANDATORY: Wrap thought process in <THINK> tags.`;
        }

        const baseSystemInstruction = autonomousInstruction.replace('[MODEL_IDENTITY_BLOCK]', modelIdentityBlock);

        // Explicitly type metadataPayload to prevent 'any' implicit issues
        let metadataPayload: { groundingMetadata?: any[] } = { groundingMetadata: externalMetadata.length > 0 ? externalMetadata : undefined };
        let fallbackSearchContext = ''; 
        
        let currentAction: RouterAction = routing.action;
        let currentPrompt: string = prompt;
        let loopCount = 0;
        const MAX_LOOPS = 6; 

        while (loopCount < MAX_LOOPS) {
            if (signal?.aborted) break;
            loopCount++;

            const enrichedMemoryContext = { ...memoryContext, external_web_search: externalSearchContext };

            switch (currentAction) {
                case 'SIMPLE':
                default: {
                    const systemPrompt = `${baseSystemInstruction}\n\n[MEMORY]\n${JSON.stringify(enrichedMemoryContext)}\n\n${dateTimeContext}`;
                    const historyWithoutLast = (history.length > 0 && history[history.length - 1].sender === 'user') 
                        ? history.slice(0, -1) 
                        : history;

                    let generatedThisLoop: string = "";

                    if (isNative) {
                        const historyMessages = historyWithoutLast.map(msg => ({
                            role: msg.sender === 'user' ? 'user' : 'model' as 'user' | 'model',
                            parts: [{ text: msg.text }] 
                        })).filter(msg => msg.parts[0].text.trim() !== '');

                        const userParts: any[] = [{ text: currentPrompt }];

                        if (files && files.length > 0) {
                            for (const file of files) {
                                if (file.type.startsWith('image/')) {
                                    try {
                                        const base64Data = await fileToBase64(file);
                                        userParts.push({ inlineData: { mimeType: file.type, data: base64Data } });
                                    } catch (e) {
                                        console.error("Failed to process image attachment:", e);
                                        userParts.push({ text: `[Error attaching image: ${file.name}]` });
                                    }
                                } else if (file.type.startsWith('text/') || file.name.match(/\.(js|ts|jsx|tsx|html|css|json|md|py|lua)$/)) {
                                    try {
                                        const content = await readTextFile(file);
                                        userParts.push({ text: `\n\n--- FILE: ${file.name} ---\n${content}\n--- END FILE ---\n` });
                                    } catch (e) {
                                        userParts.push({ text: `[Error reading text file: ${file.name}]` });
                                    }
                                }
                            }
                        }

                        historyMessages.push({ role: 'user', parts: userParts } as any);

                        const contents = historyMessages.map(m => ({ role: m.role, parts: m.parts }));
                        const config: any = { systemInstruction: systemPrompt };
                        config.tools = [{ googleSearch: {} }];
                        
                        if (thinkingBudget > 0) config.thinkingConfig = { thinkingBudget: thinkingBudget };

                        const generator = await generateContentStreamWithRetry(ai, {
                            model,
                            contents,
                            config
                        }, 3, (msg) => onStreamChunk?.(msg));

                        for await (const chunk of generator) {
                            if (signal?.aborted) break;
                            if (chunk.text) {
                                generatedThisLoop += chunk.text;
                                finalResponseText += chunk.text;
                                onStreamChunk?.(chunk.text);
                                
                                const candidate = (chunk as any).candidates?.[0];
                                if (candidate?.groundingMetadata?.groundingChunks) {
                                    if (!metadataPayload.groundingMetadata) metadataPayload.groundingMetadata = [];
                                    if (metadataPayload.groundingMetadata) {
                                        metadataPayload.groundingMetadata.push(...candidate.groundingMetadata.groundingChunks);
                                    }
                                }

                                if (generatedThisLoop.includes('</CANVAS_TRIGGER>') ||
                                    generatedThisLoop.includes('</CANVASTRIGGER>') ||
                                    generatedThisLoop.includes('</SEARCH>') || 
                                    generatedThisLoop.includes('</DEEP>') || 
                                    generatedThisLoop.includes('</IMAGE>') ||
                                    generatedThisLoop.includes('</PROJECT>') ||
                                    generatedThisLoop.includes('</CANVAS>') ||
                                    generatedThisLoop.includes('</STUDY>')
                                ) {
                                    break; 
                                }
                            }
                        }

                    } else {
                        if (!openRouterKey) throw new Error("OpenRouter API Key not found.");

                        const openAiMessages = [
                            { role: 'system', content: systemPrompt },
                            ...historyWithoutLast.map(m => ({
                                role: m.sender === 'user' ? 'user' : 'assistant',
                                content: m.text
                            }))
                        ];

                        const userContent: any[] = [{ type: 'text', text: currentPrompt }];
                        
                        if (files && files.length > 0) {
                            for (const file of files) {
                                if (file.type.startsWith('image/')) {
                                    try {
                                        const base64Data = await fileToBase64(file);
                                        userContent.push({ 
                                            type: 'image_url', 
                                            image_url: { url: `data:${file.type};base64,${base64Data}` } 
                                        });
                                    } catch (e) {
                                        console.error("Failed to process image attachment for OpenRouter:", e);
                                        userContent.push({ type: 'text', text: `[Error attaching image: ${file.name}]` });
                                    }
                                } else if (file.type.startsWith('text/') || file.name.match(/\.(js|ts|jsx|tsx|html|css|json|md|py|lua)$/)) {
                                    try {
                                        const content = await readTextFile(file);
                                        userContent.push({ type: 'text', text: `\n\n--- FILE: ${file.name} ---\n${content}\n--- END FILE ---\n` });
                                    } catch (e) {
                                        userContent.push({ type: 'text', text: `[Error reading text file: ${file.name}]` });
                                    }
                                }
                            }
                        }

                        openAiMessages.push({ role: 'user', content: userContent });

                        await generateOpenRouterStream(openRouterKey, model, openAiMessages, (chunk) => {
                            if (signal?.aborted) return;
                            generatedThisLoop += chunk;
                            finalResponseText += chunk;
                            onStreamChunk?.(chunk);
                        }, signal);
                    }
                    
                    const searchMatches: RegExpMatchArray[] = Array.from(generatedThisLoop.matchAll(/<SEARCH>([\s\S]*?)<\/SEARCH>/g));
                    
                    if (searchMatches.length > 0) {
                        const queries: string[] = searchMatches.map((m: RegExpMatchArray) => m[1] ? m[1].trim() : "").filter(q => q);
                        
                        if (shouldUseExternalSearch(queries[0], modelSupportsSearch, true)) {
                             const parallelResults = await Promise.all(
                                queries.map(async (q: string) => {
                                    try {
                                        const results = await runMcpWebSearch(q, 20);
                                        const pages = await fetchContentsForResults(results, 20);
                                        return { query: q, pages };
                                    } catch (e) {
                                        return { query: q, pages: [] as WebSearchResult[] };
                                    }
                                })
                             );

                             const validResults = parallelResults.filter(r => r.pages.length > 0);
                             
                             if (validResults.length > 0) {
                                 const allNewMeta: any[] = [];
                                 let aggregatedContext = "";

                                 validResults.forEach(res => {
                                     res.pages.forEach(p => allNewMeta.push({ web: { uri: p.url, title: p.title } }));
                                     
                                     aggregatedContext += `\n\n=== WEB RESULTS FOR QUERY: "${res.query}" ===\n`;
                                     aggregatedContext += res.pages.map((p, i) => `[${i+1}] ${p.title} (${p.url}):\n${p.content}`).join('\n\n');
                                 });

                                 if (!metadataPayload.groundingMetadata) metadataPayload.groundingMetadata = [];
                                 if (metadataPayload.groundingMetadata) {
                                     metadataPayload.groundingMetadata.push(...allNewMeta);
                                 }
                                 
                                 fallbackSearchContext = aggregatedContext;
                                 
                                 const synthesisPrompt = `USER ORIGINALLY ASKED: ${prompt}\n\nI have performed the following searches based on my previous thought process:\n${queries.map(q => `- ${q}`).join('\n')}\n\nSEARCH CONTEXT:\n${fallbackSearchContext}\n\nINSTRUCTIONS: Synthesize a comprehensive answer to the user's original query using this search data. Cite sources using [1], [2] format. Do NOT repeat the <SEARCH> tags.`;
                                 
                                 currentPrompt = synthesisPrompt;
                                 currentAction = 'SIMPLE';
                                 continue;
                             }
                        }
                    }

                    const deepMatch: RegExpMatchArray | null = generatedThisLoop.match(/<DEEP>([\s\S]*?)<\/DEEP>/);
                    const imageMatch: RegExpMatchArray | null = generatedThisLoop.match(/<IMAGE>([\s\S]*?)<\/IMAGE>/);
                    const projectMatch: RegExpMatchArray | null = generatedThisLoop.match(/<PROJECT>([\s\S]*?)<\/PROJECT>/);
                    const canvasMatch: RegExpMatchArray | null = generatedThisLoop.match(/<CANVAS_TRIGGER>([\s\S]*?)<\/CANVAS_TRIGGER>/) || 
                                        generatedThisLoop.match(/<CANVAS_TRIGGER>([\s\S]*?)<\/CANVASTRIGGER>/) || 
                                        generatedThisLoop.match(/<CANVAS>([\s\S]*?)<\/CANVAS>/);
                    const studyMatch: RegExpMatchArray | null = generatedThisLoop.match(/<STUDY>([\s\S]*?)<\/STUDY>/);

                    if (deepMatch && deepMatch[1]) { currentAction = 'DEEP_SEARCH'; currentPrompt = String(deepMatch[1]); continue; }
                    
                    if (searchMatches.length === 1 && !fallbackSearchContext) { 
                        currentAction = 'SEARCH'; 
                        const match = searchMatches[0];
                        // Safety: Check match[1] exists before using it
                        currentPrompt = match && match[1] ? String(match[1]) : ""; 
                        continue; 
                    }
                    
                    if (imageMatch && imageMatch[1]) { currentAction = 'IMAGE'; currentPrompt = String(imageMatch[1]); routing.parameters = { prompt: String(imageMatch[1]) }; continue; }
                    if (projectMatch && projectMatch[1]) { currentAction = 'PROJECT'; currentPrompt = String(projectMatch[1]); continue; }
                    if (canvasMatch && canvasMatch[1]) { currentAction = 'CANVAS'; currentPrompt = String(canvasMatch[1]); continue; }
                    if (studyMatch && studyMatch[1]) { currentAction = 'STUDY'; currentPrompt = String(studyMatch[1]); continue; }
                    
                    if (!finalResponseText.trim() && fallbackSearchContext) {
                        finalResponseText = fallbackSearchContext;
                        onStreamChunk?.(fallbackSearchContext);
                    }

                    return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText, ...metadataPayload }] };
                }
            }
        }
        
        return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText, ...metadataPayload }] };

    } catch (error: any) {
        if (error.name === 'AbortError') {
            return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText || "(Generation stopped by user)" }] };
        }
        console.error("Error in runAutonomousAgent:", error);
        const errorMessage = error.message && error.message.includes("OpenRouter") ? error.message : getUserFriendlyError(error);
        return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: `An error occurred: ${errorMessage}` }] };
    }
};
