import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  private textOf(response: Anthropic.Message): string {
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  async checkRelevance(input: RelevanceInput): Promise<RelevanceResult> {
    const response = await this.client.messages.create({
      model: config.anthropicRelevanceModel,
      max_tokens: 256,
      system: RELEVANCE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildRelevanceUserPrompt(input) }],
    });
    const parsed = extractJson<{ relevant: boolean; reason: string }>(this.textOf(response));
    return { relevant: Boolean(parsed.relevant), reason: String(parsed.reason ?? '') };
  }

  async draftReply(input: DraftReplyInput): Promise<string> {
    const response = await this.client.messages.create({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: buildDraftSystemPrompt(input),
      messages: [
        {
          role: 'user',
          content: `Subreddit: r/${input.subreddit}\n\nPost title: ${input.postTitle}\n\nPost body:\n${
            input.postBody.slice(0, 6000) || '(no body text)'
          }\n\nDraft the reply.`,
        },
      ],
    });
    return this.textOf(response).trim();
  }

  async draftCompliantPost(input: DraftPostInput): Promise<CompliantPostResult> {
    const response = await this.client.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildPostDraftPrompt(input) }],
    });
    const parsed = extractJson<CompliantPostResult>(this.textOf(response));
    return {
      title: String(parsed.title ?? ''),
      body: String(parsed.body ?? ''),
      keyRulesSummary: String(parsed.keyRulesSummary ?? ''),
      unverifiedFlags: String(parsed.unverifiedFlags ?? ''),
    };
  }
}
