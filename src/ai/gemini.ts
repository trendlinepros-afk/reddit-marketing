import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import {
  AiProvider,
  CompliantPostResult,
  DraftPostInput,
  DraftReplyInput,
  RelevanceInput,
  RelevanceResult,
  RELEVANCE_SYSTEM_PROMPT,
  buildDraftSystemPrompt,
  buildPostDraftPrompt,
  buildRelevanceUserPrompt,
  extractJson,
} from './provider';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  private async generate(model: string, systemInstruction: string | undefined, prompt: string): Promise<string> {
    const response = await this.client.models.generateContent({
      model,
      contents: prompt,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    return response.text ?? '';
  }

  async checkRelevance(input: RelevanceInput): Promise<RelevanceResult> {
    const text = await this.generate(
      config.geminiRelevanceModel,
      RELEVANCE_SYSTEM_PROMPT,
      buildRelevanceUserPrompt(input)
    );
    const parsed = extractJson<{ relevant: boolean; reason: string }>(text);
    return { relevant: Boolean(parsed.relevant), reason: String(parsed.reason ?? '') };
  }

  async draftReply(input: DraftReplyInput): Promise<string> {
    const text = await this.generate(
      config.geminiModel,
      buildDraftSystemPrompt(input),
      `Subreddit: r/${input.subreddit}\n\nPost title: ${input.postTitle}\n\nPost body:\n${
        input.postBody.slice(0, 6000) || '(no body text)'
      }\n\nDraft the reply.`
    );
    return text.trim();
  }

  async draftCompliantPost(input: DraftPostInput): Promise<CompliantPostResult> {
    const text = await this.generate(config.geminiModel, undefined, buildPostDraftPrompt(input));
    const parsed = extractJson<CompliantPostResult>(text);
    return {
      title: String(parsed.title ?? ''),
      body: String(parsed.body ?? ''),
      keyRulesSummary: String(parsed.keyRulesSummary ?? ''),
      unverifiedFlags: String(parsed.unverifiedFlags ?? ''),
    };
  }
}
