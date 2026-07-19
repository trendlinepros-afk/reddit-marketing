import { AiProviderName } from '../types';

/**
 * Common interface every AI provider implements. All pipeline code talks to
 * this interface only, so providers are swappable per business.
 */
export interface AiProvider {
  readonly name: AiProviderName;

  /**
   * Cheap yes/no relevance check before spending tokens on a full draft.
   * Returns true if the post looks like a genuine opportunity for the business.
   */
  checkRelevance(input: RelevanceInput): Promise<RelevanceResult>;

  /** Generate a reply draft in the business's voice. */
  draftReply(input: DraftReplyInput): Promise<string>;

  /**
   * Draft an original post for a subreddit and run a rule-compliance pass
   * against the fetched subreddit rules.
   */
  draftCompliantPost(input: DraftPostInput): Promise<CompliantPostResult>;
}

export interface RelevanceInput {
  businessName: string;
  businessDomain: string;
  voiceProfile: string;
  keyword: string;
  postTitle: string;
  postBody: string;
  subreddit: string;
}

export interface RelevanceResult {
  relevant: boolean;
  reason: string;
}

export interface DraftReplyInput {
  businessName: string;
  businessDomain: string;
  voiceProfile: string;
  postTitle: string;
  postBody: string;
  subreddit: string;
}

export interface DraftPostInput {
  businessName: string;
  businessDomain: string;
  voiceProfile: string;
  subreddit: string;
  subredditTitle: string;
  subredditDescription: string;
  submitText: string;
  rules: Array<{ short_name: string; description: string; kind: string }>;
}

export interface CompliantPostResult {
  title: string;
  body: string;
  keyRulesSummary: string;
  unverifiedFlags: string;
}

export const RELEVANCE_SYSTEM_PROMPT = `You are a strict lead-qualification filter for a business monitoring Reddit.
Decide whether a Reddit post is a genuine opportunity: the author is asking for help, advice, or recommendations in a way this business could credibly and helpfully respond to as a normal Reddit user.

Mark it NOT relevant if:
- The keyword match is incidental (different topic, different meaning)
- The post is itself promotional/spam, a news link, a meme, or a rant with no question
- Responding would be forced or off-topic

Respond with ONLY a JSON object: {"relevant": true/false, "reason": "<one short sentence>"}`;

export function buildRelevanceUserPrompt(input: RelevanceInput): string {
  return `Business: ${input.businessName} (${input.businessDomain})
What the business does / voice: ${input.voiceProfile.slice(0, 500)}
Matched keyword: "${input.keyword}"
Subreddit: r/${input.subreddit}

Post title: ${input.postTitle}
Post body:
${input.postBody.slice(0, 3000) || '(no body text)'}

Is this post a genuine opportunity for the business to reply helpfully?`;
}

export function buildDraftSystemPrompt(input: DraftReplyInput): string {
  return `You draft Reddit replies on behalf of a person who works at ${input.businessName}, but you write as a genuine Reddit user — never as a marketer.

Voice profile for this business (follow it closely):
${input.voiceProfile}

Hard rules:
- Sound like a real person on Reddit: casual, direct, specific. No corporate tone, no marketing phrases, no "As someone who...", no exclamation-heavy hype.
- Do NOT mention the business name "${input.businessName}" or its website/domain unless the voice profile explicitly permits self-promotion.
- Be short: 2-6 sentences. Answer the poster's actual question with concrete, useful advice first.
- Never fabricate personal anecdotes with specific fake details (real names, exact figures, fake credentials).
- No sign-offs, no "hope this helps!" filler, no emoji unless the voice profile calls for it.

Output ONLY the reply text, nothing else.`;
}

export function buildPostDraftPrompt(input: DraftPostInput): string {
  const rulesText = input.rules.length
    ? input.rules.map((r, i) => `${i + 1}. ${r.short_name}${r.description ? ` — ${r.description}` : ''}`).join('\n')
    : '(This subreddit exposes no rules via the API — flag that for manual review.)';

  return `Draft ONE original Reddit post for r/${input.subreddit} that a person from ${input.businessName} (${input.businessDomain}) could submit manually.

Subreddit: ${input.subredditTitle}
Description: ${input.subredditDescription.slice(0, 1000)}

Posting guidance shown on the submit page (submit_text / sidebar):
${input.submitText.slice(0, 2000) || '(none)'}

Official subreddit rules fetched from the API:
${rulesText}

Voice profile (follow it closely):
${input.voiceProfile}

Requirements:
1. Write a genuine, valuable post (a question, discussion starter, useful writeup, or lessons-learned) — NOT an advertisement. Do not mention the business or its domain unless the voice profile explicitly allows it.
2. After drafting, re-check the draft explicitly against every rule above (title format requirements, self-promotion restrictions, flair requirements, required structure, banned phrases). Revise until it complies, or note the rules it cannot satisfy automatically.
3. List anything you could NOT verify programmatically (karma/account-age gates, flair that must be set at submission time, rules that live only in stickied mod posts, manual mod approval requirements).

Respond with ONLY a JSON object:
{
  "title": "<post title>",
  "body": "<post body in Reddit markdown>",
  "keyRulesSummary": "<2-4 sentences: which rules shaped the draft and how it complies>",
  "unverifiedFlags": "<bullet-style text listing anything the human must check manually; empty string if none>"
}`;
}

/** Tolerant JSON extraction — models sometimes wrap JSON in code fences. */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in model output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
